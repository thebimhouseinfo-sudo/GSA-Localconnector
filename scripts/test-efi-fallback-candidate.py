#!/usr/bin/env python3
"""Synthetic FAT32 EFI patch regression; creates no VM or real guest image."""
import hashlib
import importlib.util
import os
import shutil
import struct
import tempfile
import unittest
from pathlib import Path

p=Path(__file__).with_name("prepare-arm64-efi-fallback-candidate.py")
spec=importlib.util.spec_from_file_location("fallback_candidate",p)
tool=importlib.util.module_from_spec(spec)
spec.loader.exec_module(tool)

class CandidateTests(unittest.TestCase):
    def test_synthetic_fat32_copy_only(self):
        with tempfile.TemporaryDirectory(prefix="gsa-efi-fixture-") as d:
            base=Path(d)/"base.img"
            clone=Path(d)/"clone.img"
            size=8*1024*1024
            esp=2048*512
            fatstart=esp+32*512
            fatsize=80*512
            datastart=fatstart+2*fatsize
            contents=bytearray(1600)
            contents[:2]=b"MZ"
            struct.pack_into("<I",contents,0x3c,128)
            contents[128:132]=bytes((80,69,0,0))
            struct.pack_into("<H",contents,132,0xaa64)
            grub=bytes(contents)
            cfg=b"search.fs_uuid 5b886046-3262-4eca-a390-4cd88779a3c7 root\nconfigfile /grub/grub.cfg\n"
            def entry(name,first,length=0,directory=False):
                e=bytearray(32)
                assert len(name)==11
                e[:11]=name
                e[11]=0x10 if directory else 0x20
                struct.pack_into("<H",e,20,first>>16)
                struct.pack_into("<H",e,26,first & 0xffff)
                struct.pack_into("<I",e,28,length)
                return e
            with base.open("w+b") as f:
                f.truncate(size)
                header=bytearray(512)
                header[:8]=b"EFI PART"
                struct.pack_into("<Q",header,72,2)
                struct.pack_into("<I",header,80,128)
                struct.pack_into("<I",header,84,128)
                f.seek(512);f.write(header)
                partition=bytearray(128)
                partition[:16]=tool.ESP_GUID
                struct.pack_into("<QQ",partition,32,2048,12047)
                f.seek(1024);f.write(partition)
                bpb=bytearray(512)
                bpb[11:13]=(512).to_bytes(2,"little")
                bpb[13]=1
                struct.pack_into("<H",bpb,14,32)
                bpb[16]=2
                struct.pack_into("<I",bpb,32,10000)
                struct.pack_into("<I",bpb,36,80)
                struct.pack_into("<I",bpb,44,2)
                bpb[510:512]=bytes((0x55,0xaa))
                f.seek(esp);f.write(bpb)
                fat=bytearray(fatsize)
                for cluster,nxt in {0:0x0ffffff8,1:0xffffffff,
                                    2:0x0fffffff,3:0x0fffffff,
                                    4:0x0fffffff,5:0x0fffffff,
                                    6:7,7:8,8:9,9:0x0fffffff,
                                    10:0x0fffffff,11:0x0fffffff}.items():
                    struct.pack_into("<I",fat,cluster*4,nxt)
                f.seek(fatstart);f.write(fat)
                f.seek(fatstart+fatsize);f.write(fat)
                f.seek(datastart);f.write(entry(b"EFI        ",3,directory=True))
                f.seek(datastart+512);f.write(
                    entry(b"BOOT       ",4,directory=True)+
                    entry(b"UBUNTU     ",5,directory=True))
                f.seek(datastart+1024);f.write(entry(b"BOOTAA64EFI",10,512))
                f.seek(datastart+1536);f.write(entry(b"GRUBAA64EFI",6,len(grub))+entry(b"GRUB    CFG",11,len(cfg)))
                for i in range(4):
                    f.seek(datastart+(6-2+i)*512)
                    f.write(grub[i*512:(i+1)*512].ljust(512,b"\x00"))
                f.seek(datastart+(11-2)*512)
                f.write(cfg.ljust(512,bytes((0,))))
            base_digest=tool.sha256(base)
            shutil.copyfile(base,clone)
            fd=os.open(clone,os.O_RDWR)
            try:
                result=tool.patch_esp(fd,expected_bytes=size,
                                      grub_digest=hashlib.sha256(grub).hexdigest(),
                                      cfg_digest=hashlib.sha256(cfg).hexdigest())
                self.assertEqual(result["addedBytes"],1600+len(cfg))
                self.assertEqual(result["allocatedClusters"],5)
                with self.assertRaisesRegex(ValueError,"FALLBACK_TARGET_ALREADY_PRESENT"):
                    tool.patch_esp(fd,expected_bytes=size,
                                   grub_digest=hashlib.sha256(grub).hexdigest())
            finally:
                os.close(fd)
            self.assertEqual(tool.sha256(base),base_digest)
            self.assertNotEqual(tool.sha256(clone),base_digest)
            with clone.open("rb") as f:
                f.seek(datastart+1024+32)
                e=f.read(32)
                self.assertEqual(e[:11],b"GRUBAA64EFI")
                self.assertEqual(struct.unpack_from("<I",e,28)[0],1600)
                f.seek(datastart+1024+64)
                cfg_e=f.read(32)
                self.assertEqual(cfg_e[:11],b"GRUB    CFG")
                self.assertEqual(struct.unpack_from("<I",cfg_e,28)[0],len(cfg))
                f.seek(fatstart);a=f.read(fatsize)
                f.seek(fatstart+fatsize);b=f.read(fatsize)
                self.assertEqual(a,b)

if __name__=="__main__":
    unittest.main()
