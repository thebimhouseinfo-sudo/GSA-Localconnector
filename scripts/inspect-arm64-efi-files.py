#!/usr/bin/env python3
"""Read-only FAT32 ESP bootloader inventory. No mounts, writes, or external tools."""
import json
import os
import struct
from pathlib import Path

IMAGE = Path.home() / "Library/Application Support/GSA-Localconnector/images/ubuntu-24.04-arm64-converted.raw"
SIZE = 3758096384
ESP_GUID = bytes.fromhex("28732ac11ff8d211ba4b00a0c93ec93b")  # GPT little-endian
TARGETS = ("EFI/BOOT/BOOTAA64.EFI", "EFI/ubuntu/grubaa64.efi", "EFI/ubuntu/shimaa64.efi")
def u16(b,n): return struct.unpack_from("<H",b,n)[0]
def u32(b,n): return struct.unpack_from("<I",b,n)[0]
def result(**kw): print(json.dumps(kw,sort_keys=True)); return 0
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
            for i in range(count):
                at=ent_lba*512+i*esz
                if at+esz>SIZE:break
                f.seek(at);e=f.read(esz)
                if e[:16]==ESP_GUID:
                    first,last=struct.unpack_from("<QQ",e,32)
                    if first>=last or last*512>=SIZE: return result(state="BLOCKED",reason="ESP_BOUNDS")
                    esp=(first*512,(last-first+1)*512)
                    break
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
                    found[target]={"exists":item is not None,
                                   "bytes":item["size"] if item is not None else None}
                except ValueError as ex:
                    return result(state="BLOCKED",reason=str(ex))
            return result(state="ESP_FILES_INSPECTED",espBytes=extent,paths=found,
                          bootVerified=False,executionAuthorized=False)
    except (OSError,ValueError,struct.error) as ex:
        return result(state="BLOCKED",reason=type(ex).__name__)
if __name__=="__main__":
    raise SystemExit(main())
