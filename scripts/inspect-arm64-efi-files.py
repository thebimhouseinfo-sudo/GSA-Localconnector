#!/usr/bin/env python3
"""Read-only FAT32 ESP bootloader inventory. No mounts, writes, or external tools."""
import json
import hashlib
import os
import struct
import uuid
from pathlib import Path

IMAGE = Path.home() / "Library/Application Support/GSA-Localconnector/images/ubuntu-24.04-arm64-converted.raw"
SIZE = 3758096384
ESP_GUID = bytes.fromhex("28732ac11ff8d211ba4b00a0c93ec93b")  # GPT little-endian
TARGETS = (
    "EFI/BOOT/BOOTAA64.EFI", "EFI/BOOT/grubaa64.efi",
    "EFI/BOOT/grub.cfg", "EFI/BOOT/fbaa64.efi", "EFI/BOOT/mmaa64.efi",
    "EFI/ubuntu/grubaa64.efi", "EFI/ubuntu/shimaa64.efi",
    "EFI/ubuntu/grub.cfg",
)
def u16(b,n): return struct.unpack_from("<H",b,n)[0]
def u32(b,n): return struct.unpack_from("<I",b,n)[0]
def result(**kw):
    print(json.dumps(kw,sort_keys=True))
    return 2 if kw.get("state") == "BLOCKED" else 0

def read_fat_file(item, cluster_size, max_cluster, cluster_bytes, next_cluster):
    """Read one FAT32 file with a size-derived bound, detecting genuine cycles.

    A 2.8 MiB EFI binary occupies more than 4096 FAT entries with 512-byte
    clusters; treating that count as a loop produces false corruption alarms.
    """
    size = item["size"]
    if item["directory"] or size < 0 or size > 8 * 1024 * 1024:
        raise ValueError("EFI_FILE_SIZE_INVALID")
    expected_clusters = (size + cluster_size - 1) // cluster_size
    if cluster_size <= 0 or expected_clusters > max_cluster - 1:
        raise ValueError("EFI_FILE_CHAIN_BOUNDS")
    remain = size
    cluster = item["cluster"]
    seen = set()
    chunks = []
    while remain:
        if cluster in seen:
            raise ValueError("EFI_FILE_CHAIN_LOOP")
        if cluster < 2 or cluster > max_cluster:
            raise ValueError("EFI_FILE_CLUSTER_BOUNDS")
        if len(seen) >= expected_clusters:
            raise ValueError("EFI_FILE_CHAIN_OVERRUN")
        seen.add(cluster)
        block = cluster_bytes(cluster)
        if len(block) != cluster_size:
            raise ValueError("EFI_FILE_SHORT_READ")
        take = min(remain, cluster_size)
        chunks.append(block[:take])
        remain -= take
        if remain:
            cluster = next_cluster(cluster)
            if cluster >= 0x0ffffff8:
                raise ValueError("EFI_FILE_CHAIN_TRUNCATED")
    return b"".join(chunks)
def ext_filesystem_uuid(f, first_lba, last_lba, disk_size):
    """Read ext2/3/4 superblock UUID only; never mounts or modifies a volume."""
    if first_lba < 0 or last_lba <= first_lba:
        return None
    sb_offset = first_lba * 512 + 1024
    if sb_offset + 1024 > disk_size or sb_offset + 1024 > (last_lba + 1) * 512:
        return None
    f.seek(sb_offset)
    sb = f.read(1024)
    if len(sb) != 1024 or sb[56:58] != bytes((0x53,0xef)):
        return None
    raw_uuid = sb[104:120]
    if raw_uuid == bytes(16):
        return None
    return str(uuid.UUID(bytes=raw_uuid))

def grub_target_uuid(config_text):
    if not isinstance(config_text,str):
        return None
    for line in config_text.splitlines():
        parts=line.strip().split()
        if len(parts)>=2 and parts[0]=="search.fs_uuid":
            try:
                return str(uuid.UUID(parts[1]))
            except ValueError:
                return None
    return None

def main():
    if IMAGE.is_symlink() or not IMAGE.is_file() or IMAGE.stat().st_size != SIZE:
        return result(state="BLOCKED",reason="IMAGE_IDENTITY")
    fd=os.open(IMAGE,os.O_RDONLY|getattr(os,"O_NOFOLLOW",0))
    try:
        with os.fdopen(fd,"rb") as f:
            f.seek(512)
            hdr=f.read(512)
            if hdr[:8]!=b"EFI PART": return result(state="BLOCKED",reason="NO_GPT")
            ent_lba=struct.unpack_from("<Q",hdr,72)[0]
            count,esz=struct.unpack_from("<II",hdr,80)
            if count>256 or esz<128 or esz>512: return result(state="BLOCKED",reason="INVALID_GPT")
            esp=None
            candidates=[]
            for i in range(count):
                at=ent_lba*512+i*esz
                if at+esz>SIZE:break
                f.seek(at);e=f.read(esz)
                if e[:16]==bytes(16): continue
                first,last=struct.unpack_from("<QQ",e,32)
                if first >= last or last*512 >= SIZE:
                    return result(state="BLOCKED",reason="GPT_PARTITION_BOUNDS")
                if e[:16] == ESP_GUID:
                    if esp is not None:
                        return result(state="BLOCKED",reason="MULTIPLE_ESP")
                    esp=(first*512,(last-first+1)*512)
                else:
                    candidates.append((i+1,first,last))
            if esp is None:return result(state="BLOCKED",reason="NO_ESP")
            base,extent=esp
            f.seek(base);v=f.read(512)
            bps=u16(v,11);spc=v[13];reserved=u16(v,14);nfats=v[16]
            fatsz=u32(v,36);root=u32(v,44);total=u32(v,32)
            if not (v[510:512]==bytes.fromhex("55aa") and bps==512 and spc in (1,2,4,8,16,32,64,128)
                    and nfats in (1,2) and reserved>0 and fatsz>0 and total*bps<=extent):
                return result(state="BLOCKED",reason="INVALID_FAT32_BPB")
            data_start=base+(reserved+nfats*fatsz)*bps
            cluster_size=bps*spc
            max_cluster=(total-reserved-nfats*fatsz)//spc+1
            def cluster_bytes(num):
                if num<2 or num>max_cluster:raise ValueError("CLUSTER_BOUNDS")
                offset=data_start+(num-2)*cluster_size
                if offset+cluster_size>base+extent:raise ValueError("CLUSTER_OUTSIDE_ESP")
                f.seek(offset);return f.read(cluster_size)
            def next_cluster(num):
                f.seek(base+reserved*bps+num*4)
                return u32(f.read(4),0)&0x0fffffff
            def directory(num):
                out={}
                visited=set()
                while 2<=num<0x0ffffff8:
                    if num in visited or len(visited)>4096:raise ValueError("FAT_LOOP")
                    visited.add(num)
                    data=cluster_bytes(num)
                    for pos in range(0,len(data),32):
                        e=data[pos:pos+32]
                        if e[0]==0:return out
                        if e[0]==0xe5 or e[11]==0x0f or e[11]&0x08:continue
                        name=e[0:8].decode("ascii","replace").rstrip()
                        ext=e[8:11].decode("ascii","replace").rstrip()
                        key=(name+("." + ext if ext else "")).casefold()
                        out[key]={"cluster":(u16(e,20)<<16)|u16(e,26),
                                  "size":u32(e,28),"directory":bool(e[11]&0x10)}
                    num=next_cluster(num)
                return out
            found={}
            for target in TARGETS:
                cur=root;item=None
                try:
                    for i,part in enumerate(target.split("/")):
                        entries=directory(cur)
                        item=entries.get(part.casefold())
                        if not item:break
                        if i<len(target.split("/"))-1:
                            if not item["directory"]: item=None;break
                            cur=item["cluster"]
                    info={"exists":item is not None,
                          "bytes":item["size"] if item is not None else None}
                    if item is not None and not item["directory"]:
                        data=read_fat_file(item,cluster_size,max_cluster,cluster_bytes,next_cluster)
                        info["sha256"]=hashlib.sha256(data).hexdigest()
                        if target.lower().endswith(".efi"):
                            peoffset=u32(data,0x3c) if len(data)>=0x40 and data[:2]==b"MZ" else -1
                            machine=u16(data,peoffset+4) if peoffset>=0 and peoffset+6<=len(data) and data[peoffset:peoffset+4]==bytes((80,69,0,0)) else None
                            info["peMachine"]=("ARM64" if machine==0xaa64 else
                                                "OTHER" if machine is not None else "INVALID_PE")
                            info["peMachineHex"]=hex(machine) if machine is not None else None
                        elif target.lower().endswith(".cfg"):
                            excerpt=data[:1500].decode("utf-8","replace")
                            info["configExcerpt"]="".join(
                                c if c.isprintable() or c in (chr(10),chr(9)) else " "
                                for c in excerpt
                            )
                    found[target]=info
                except ValueError as ex:
                    return result(state="BLOCKED",reason=str(ex))
            boot=found.get("EFI/BOOT/BOOTAA64.EFI",{})
            shim=found.get("EFI/ubuntu/shimaa64.efi",{})
            grub=found.get("EFI/BOOT/grubaa64.efi",{})
            cfg=found.get("EFI/ubuntu/grub.cfg",{})
            target_uuid=grub_target_uuid(cfg.get("configExcerpt"))
            filesystems=[]
            for index,first,last in candidates:
                fs_uuid=ext_filesystem_uuid(f,first,last,SIZE)
                if fs_uuid is not None:
                    filesystems.append({"partition":index,"extFilesystemUUID":fs_uuid,
                                        "matchesGrubConfig":fs_uuid==target_uuid if target_uuid else None})
            matched=any(x["matchesGrubConfig"] for x in filesystems)
            return result(
                state="ESP_FILES_INSPECTED",espBytes=extent,clusterBytes=cluster_size,paths=found,
                fallbackIsUbuntuShim=bool(boot.get("sha256") and boot.get("sha256")==shim.get("sha256")),
                fallbackSiblingGrubPresent=bool(grub.get("exists")),
                fallbackSiblingGrubMissingCandidate=bool(boot.get("exists") and not grub.get("exists")),
                grubConfigTargetUUID=target_uuid,
                extFilesystems=filesystems,
                grubConfigUUIDMatched=matched if target_uuid else None,
                bootVerified=False,executionAuthorized=False
            )
    except (OSError,ValueError,struct.error) as ex:
        return result(state="BLOCKED",reason=type(ex).__name__)
if __name__=="__main__":
    raise SystemExit(main())
