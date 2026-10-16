#!/usr/bin/env python3
"""Read-only offline GPT/EFI inspection of an ARM64 RAW disk image. Never mounts it."""
import json
import os
import struct
import sys
import uuid
from pathlib import Path

EXPECTED_SIZE = 3758096384
EXPECTED_IMAGE = "ubuntu-24.04-arm64-converted.raw"
EFI_GUID = "c12a7328-f81f-11d2-ba4b-00a0c93ec93b"
def main():
    p = Path.home() / "Library/Application Support/GSA-Localconnector/images" / EXPECTED_IMAGE
    if not p.is_file() or p.is_symlink() or p.stat().st_size != EXPECTED_SIZE:
        print(json.dumps({"state":"BLOCKED","error":"IMAGE_IDENTITY"})); return 2
    with p.open("rb") as f:
        mbr = f.read(512)
        f.seek(512); hdr = f.read(512)
        if hdr[:8] != b"EFI PART":
            print(json.dumps({"state":"NO_GPT","mbrSignature":mbr[510:512].hex(),
                              "sector0Prefix":mbr[:16].hex(),"efiBootVerified":False}))
            return 0
        entry_lba = struct.unpack_from("<Q",hdr,72)[0]
        count, entry_size = struct.unpack_from("<II",hdr,80)
        if entry_lba > (EXPECTED_SIZE//512) or count > 256 or not 128 <= entry_size <= 512:
            print(json.dumps({"state":"BLOCKED","error":"GPT_BOUNDS"}));return 2
        partitions = []
        for i in range(count):
            offset = entry_lba*512 + i*entry_size
            if offset+entry_size > EXPECTED_SIZE: break
            f.seek(offset); ent=f.read(entry_size)
            if len(ent)<128 or ent[:16] == bytes(16):continue
            typ=str(uuid.UUID(bytes_le=ent[:16]))
            first,last=struct.unpack_from("<QQ",ent,32)
            if last < first or last*512 >= EXPECTED_SIZE: continue
            name=ent[56:128].decode("utf-16-le","replace").rstrip("\x00")
            parts={"index":i+1,"typeGUID":typ,"firstLBA":first,"lastLBA":last,"name":name}
            if typ == EFI_GUID:
                f.seek(first*512); b=f.read(512)
                parts["fatBootSectorSignature"]=b[510:512].hex()
                parts["fatTypeField"]=b[82:90].decode("ascii","replace").strip()
                parts["bootLoaderFileVerified"]=False
            partitions.append(parts)
        print(json.dumps({"state":"GPT_INSPECTED","partitions":partitions,
                          "efiPartitionFound":any(x["typeGUID"]==EFI_GUID for x in partitions),
                          "efiBootVerified":False},ensure_ascii=False))
    return 0
if __name__=="__main__":sys.exit(main())
