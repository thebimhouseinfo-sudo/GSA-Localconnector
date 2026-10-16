#!/usr/bin/env python3
"""Explicit opt-in FAT32 EFI fallback repair on an APFS copy-on-write clone only.

Not a production FAT writer. No mount, downloads, elevation or original RAW writes.
Refuses existing output, unsupported FAT metadata and unexpected canonical hashes.
"""
import argparse
import hashlib
import json
import os
import stat
import struct
import subprocess
import tempfile
from pathlib import Path

IMAGES = Path.home() / "Library/Application Support/GSA-Localconnector/images"
SOURCE = IMAGES / "ubuntu-24.04-arm64-converted.raw"
TARGET = IMAGES / "ubuntu-24.04-arm64-efi-fallback-candidate.raw"
MANIFEST = IMAGES / "ubuntu-24.04-arm64-efi-fallback-candidate.json"
SOURCE_BYTES = 3758096384
SOURCE_SHA256 = "384f7eb9976ad155812b48efb1b780024c0748e35b5c3161c82c797578168e7e"
GRUB_SHA256 = "b9d9dd81845d68a1f1867b5bcf26393908a9a349e749ce8ea944a1066d9abfcc"
ESP_GUID = bytes.fromhex("28732ac11ff8d211ba4b00a0c93ec93b")
NAME = b"GRUBAA64EFI"

def require(condition, message):
    if not condition:
        raise ValueError(message)

def u16(buf, off):
    return struct.unpack_from("<H", buf, off)[0]

def u32(buf, off):
    return struct.unpack_from("<I", buf, off)[0]

def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb", buffering=0) as f:
        while True:
            chunk = f.read(1024*1024)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()

def patch_esp(fd):
    """Modify only a disposable clone; verify expected signed Ubuntu GRUB bytes."""
    def read_at(off, size):
        require(off >= 0 and size >= 0 and off + size <= SOURCE_BYTES, "READ_BOUNDS")
        data = os.pread(fd, size, off)
        require(len(data) == size, "SHORT_READ")
        return data

    def write_at(off, buf):
        require(esp_start <= off and off + len(buf) <= esp_end, "WRITE_OUTSIDE_ESP")
        require(os.pwrite(fd, buf, off) == len(buf), "SHORT_WRITE")

    hdr = read_at(512,512)
    require(hdr[:8] == b"EFI PART", "NO_GPT")
    lba = struct.unpack_from("<Q", hdr, 72)[0]
    count, entry_size = struct.unpack_from("<II", hdr, 80)
    require(1 <= count <= 256 and 128 <= entry_size <= 512, "INVALID_GPT")
    esps=[]
    for i in range(count):
        ent = read_at(lba*512 + i*entry_size,entry_size)
        if ent[:16] == ESP_GUID:
            first,last=struct.unpack_from("<QQ",ent,32)
            require(0 < first <= last and (last+1)*512 <= SOURCE_BYTES, "INVALID_ESP")
            esps.append((first*512,(last+1)*512))
    require(len(esps) == 1, "ESP_NOT_UNIQUE")
    esp_start,esp_end=esps[0]
    bpb = read_at(esp_start,512)
    bps=u16(bpb,11); spc=bpb[13]; reserved=u16(bpb,14)
    nfats=bpb[16]; total=u32(bpb,32); fatsz=u32(bpb,36); root=u32(bpb,44)
    require(bpb[510:512] == bytes((0x55,0xaa)), "INVALID_BOOT_SIGNATURE")
    require(bps == 512 and spc in (1,2,4,8,16,32,64,128) and
            reserved > 0 and nfats == 2 and fatsz > 0 and total*bps <= esp_end-esp_start,
            "UNSUPPORTED_FAT32")
    cluster_bytes=spc*bps
    clusters=(total-reserved-nfats*fatsz)//spc
    max_cluster=clusters+1
    fat_bytes=fatsz*bps
    require(2 <= root <= max_cluster and (max_cluster+1)*4 <= fat_bytes, "FAT_BOUNDS")
    fat_off=esp_start+reserved*bps
    data_off=fat_off+nfats*fat_bytes
    require(data_off+clusters*cluster_bytes <= esp_end, "FAT_DATA_BOUNDS")
    fat=bytearray(read_at(fat_off,fat_bytes))
    require(fat == read_at(fat_off+fat_bytes,fat_bytes), "FAT_COPIES_DIFFER")

    def fat_next(c):
        return u32(fat,c*4)&0x0fffffff

    def cluster_off(c):
        require(2 <= c <= max_cluster, "CLUSTER_BOUNDS")
        off=data_off+(c-2)*cluster_bytes
        require(off+cluster_bytes <= esp_end, "CLUSTER_OUTSIDE_ESP")
        return off

    def chain(start,byte_count):
        expected=(byte_count+cluster_bytes-1)//cluster_bytes
        require(0 <= expected <= clusters, "CHAIN_LENGTH_INVALID")
        seen=set()
        curr=start
        for i in range(expected):
            require(2 <= curr <= max_cluster and curr not in seen, "CHAIN_INVALID")
            seen.add(curr)
            yield curr
            nxt=fat_next(curr)
            if i+1<expected:
                require(2 <= nxt <= max_cluster, "CHAIN_EARLY_END")
                curr=nxt
            else:
                require(nxt >= 0x0ffffff8, "CHAIN_SIZE_INCONSISTENT")

    def directory(start):
        require(2 <= start <= max_cluster, "DIR_CLUSTER_INVALID")
        seen=set()
        current=start
        for _ in range(clusters):
            require(current not in seen and 2 <= current <= max_cluster, "DIR_CHAIN_LOOP")
            seen.add(current)
            off=cluster_off(current)
            contents=read_at(off,cluster_bytes)
            for pos in range(0,cluster_bytes,32):
                e=contents[pos:pos+32]
                if e[0] == 0:
                    yield off+pos,e,True
                    return
                if e[0] == 0xe5:
                    yield off+pos,e,False
                elif e[11] != 0x0f and not (e[11]&0x08):
                    yield off+pos,e,False
            nxt=fat_next(current)
            if nxt >= 0x0ffffff8:
                return
            require(2 <= nxt <= max_cluster, "DIR_EARLY_END")
            current=nxt
        raise ValueError("DIR_TOO_LONG")

    def get(parent,name,expect_directory):
        for off,e,end in directory(parent):
            if end:
                break
            if e[:11] == name:
                require(bool(e[11]&0x10) == expect_directory, "FILE_TYPE_MISMATCH")
                return ((u16(e,20)<<16)|u16(e,26),u32(e,28))
        raise ValueError("REQUIRED_ENTRY_MISSING:"+name.decode("ascii"))

    efi,_=get(root,b"EFI        ",True)
    boot,_=get(efi,b"BOOT       ",True)
    ubuntu,_=get(efi,b"UBUNTU     ",True)
    grub_start,grub_size=get(ubuntu,NAME,False)
    require(0 < grub_size <= 8*1024*1024, "GRUB_SIZE_INVALID")
    grub=bytearray()
    for c in chain(grub_start,grub_size):
        grub.extend(read_at(cluster_off(c),cluster_bytes))
    grub=bytes(grub[:grub_size])
    require(hashlib.sha256(grub).hexdigest() == GRUB_SHA256, "GRUB_DIGEST_MISMATCH")
    pe=u32(grub,0x3c)
    require(grub[:2] == b"MZ" and grub[pe:pe+4] == bytes((80,69,0,0)) and
            u16(grub,pe+4) == 0xaa64, "GRUB_NOT_ARM64")

    free_slot=None
    for off,e,end in directory(boot):
        require(e[:11] != NAME, "FALLBACK_GRUB_ALREADY_EXISTS")
        if (end or e[0] == 0xe5) and free_slot is None:
            free_slot=(off,end)
    require(free_slot is not None, "NO_FREE_BOOT_DIRECTORY_ENTRY")
    slot,end_marker=free_slot
    if end_marker:
        # Preserve directory EOF after new entry (fail if no subsequent slot).
        require((slot-cluster_off_for_slot(slot,data_off,cluster_bytes)) + 64 <= cluster_bytes,
                "DIRECTORY_END_SLOT_NOT_SAFE")
        require(read_at(slot+32,1) == bytes((0,)), "DIRECTORY_END_NOT_ZERO")

    count_needed=(grub_size+cluster_bytes-1)//cluster_bytes
    available=[]
    for c in range(2,max_cluster+1):
        if fat_next(c) == 0:
            available.append(c)
            if len(available) == count_needed:
                break
    require(len(available) == count_needed, "NOT_ENOUGH_FREE_CLUSTERS")
    for i,c in enumerate(available):
        chunk=grub[i*cluster_bytes:(i+1)*cluster_bytes]
        write_at(cluster_off(c),chunk.ljust(cluster_bytes,bytes((0,))))
        old=u32(fat,c*4)
        next_value=available[i+1] if i+1<len(available) else 0x0fffffff
        struct.pack_into("<I",fat,c*4,(old&0xf0000000)|next_value)
    write_at(fat_off,bytes(fat))
    write_at(fat_off+fat_bytes,bytes(fat))
    first=available[0]
    entry=bytearray(32)
    entry[:11]=NAME
    entry[11]=0x20  # regular archive file
    struct.pack_into("<H",entry,20,(first>>16)&0xffff)
    struct.pack_into("<H",entry,26,first&0xffff)
    struct.pack_into("<I",entry,28,grub_size)
    write_at(slot,entry)
    os.fsync(fd)
    return {"addedEFIPath":"EFI/BOOT/grubaa64.efi",
            "addedBytes":grub_size,"grubSHA256":GRUB_SHA256,
            "allocatedClusters":count_needed,"clusterBytes":cluster_bytes}

def cluster_off_for_slot(slot,data_off,cluster_bytes):
    return data_off+((slot-data_off)//cluster_bytes)*cluster_bytes

def main():
    arg=argparse.ArgumentParser(description=__doc__)
    arg.add_argument("--prepare",action="store_true",help="Explicit consent to create a patched, disposable APFS cloned RAW")
    args=arg.parse_args()
    if not args.prepare:
        arg.error("must explicitly pass --prepare; the original RAW is never altered")
    try:
        require(os.uname().sysname == "Darwin", "MACOS_ONLY")
        require(not SOURCE.is_symlink() and SOURCE.is_file(), "ORIGINAL_NOT_REGULAR")
        st=SOURCE.stat()
        require(stat.S_ISREG(st.st_mode) and st.st_size==SOURCE_BYTES,"ORIGINAL_SIZE")
        require(not TARGET.exists() and not TARGET.is_symlink() and not MANIFEST.exists() and not MANIFEST.is_symlink(),
                "CANDIDATE_ALREADY_EXISTS")
        require(sha256(SOURCE)==SOURCE_SHA256,"ORIGINAL_SHA_MISMATCH")
        with tempfile.TemporaryDirectory(prefix=".gsa-fallback-work-",dir=IMAGES) as tempdir:
            stage=Path(tempdir)/"candidate.raw"
            # -c is clonefile(2), COW APFS; refuse fallback to a full overwrite/copy.
            cp=subprocess.run(("/bin/cp","-c",str(SOURCE),str(stage)),
                              stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,text=True)
            require(cp.returncode==0,"APFS_CLONE_FAILED")
            clonestat=stage.stat()
            require(clonestat.st_size==SOURCE_BYTES and
                    (clonestat.st_dev,clonestat.st_ino)!=(st.st_dev,st.st_ino),"CLONE_NOT_INDEPENDENT")
            require(sha256(stage)==SOURCE_SHA256,"CLONE_DIGEST_MISMATCH")
            fd=os.open(stage,os.O_RDWR|getattr(os,"O_NOFOLLOW",0))
            try:
                patch=patch_esp(fd)
            finally:
                os.close(fd)
            candidate_hash=sha256(stage)
            require(candidate_hash!=SOURCE_SHA256,"NO_CANDIDATE_CHANGES")
            require(sha256(SOURCE)==SOURCE_SHA256,"ORIGINAL_CHANGED")
            manifest={
                "state":"OFFLINE_FALLBACK_CANDIDATE","imagePath":str(TARGET),
                "expectedBytes":SOURCE_BYTES,"imageSHA256":candidate_hash,
                "baseSHA256":SOURCE_SHA256,"bootVerified":False,
                "securityVerified":False,"executionAuthorized":False,**patch,
            }
            # Atomic non-overwrite publication; no VM boot or disk mounts.
            stage_manifest=Path(tempdir)/"candidate.json"
            stage_manifest.write_text(json.dumps(manifest,sort_keys=True,indent=2)+"\n")
            os.chmod(stage,0o600)
            os.chmod(stage_manifest,0o600)
            os.link(stage,TARGET,follow_symlinks=False)
            try:
                os.link(stage_manifest,MANIFEST,follow_symlinks=False)
            except Exception:
                TARGET.unlink()
                raise
            print(json.dumps(manifest,sort_keys=True))
            return 0
    except (OSError,ValueError,subprocess.SubprocessError) as error:
        print(json.dumps({"state":"BLOCKED","reason":str(error)[:200],
                          "sourceModifiedByTool":False},sort_keys=True))
        return 2

if __name__=="__main__":
    raise SystemExit(main())
