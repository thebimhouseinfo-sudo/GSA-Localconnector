#!/usr/bin/env python3
"""Hermetic FAT32 file-chain regression tests; never touches a real image."""
import importlib.util
import io
import unittest
import uuid
from pathlib import Path

script = Path(__file__).resolve().with_name("inspect-arm64-efi-files.py")
spec = importlib.util.spec_from_file_location("efi_inspector", script)
inspector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inspector)

class TestFAT32Chains(unittest.TestCase):
    def test_legitimate_grub_file_over_4096_clusters(self):
        size = 2_799_496  # Real guest grubaa64.efi size observed on Mac
        cluster_size = 512
        max_cluster = 50_000
        def cluster_bytes(cluster):
            self.assertTrue(2 <= cluster <= max_cluster)
            return bytes((cluster % 251,)) * cluster_size
        out = inspector.read_fat_file(
            {"size": size, "cluster": 2, "directory": False},
            cluster_size, max_cluster, cluster_bytes, lambda c: c + 1,
        )
        self.assertEqual(len(out), size)
        self.assertEqual(out[:512], bytes((2,)) * 512)
        self.assertEqual(out[512:1024], bytes((3,)) * 512)

    def test_genuine_cycle_is_rejected(self):
        def next_cluster(c): return 3 if c == 2 else 2
        with self.assertRaisesRegex(ValueError, "EFI_FILE_CHAIN_LOOP"):
            inspector.read_fat_file(
                {"size": 2048, "cluster": 2, "directory": False},
                512, 100, lambda _: bytes(512), next_cluster,
            )

    def test_premature_end_of_chain_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "EFI_FILE_CHAIN_TRUNCATED"):
            inspector.read_fat_file(
                {"size": 1024, "cluster": 2, "directory": False},
                512, 100, lambda _: bytes(512), lambda _: 0x0fffffff,
            )

    def test_cluster_bounds_are_enforced(self):
        with self.assertRaisesRegex(ValueError, "EFI_FILE_CLUSTER_BOUNDS"):
            inspector.read_fat_file(
                {"size": 512, "cluster": 101, "directory": False},
                512, 100, lambda _: bytes(512), lambda c: c + 1,
            )

    def test_size_requires_more_clusters_than_volume(self):
        with self.assertRaisesRegex(ValueError, "EFI_FILE_CHAIN_BOUNDS"):
            inspector.read_fat_file(
                {"size": 51_200, "cluster": 2, "directory": False},
                512, 10, lambda _: bytes(512), lambda c: c + 1,
            )

    def test_grub_uuid_from_ubuntu_config(self):
        config = "search.fs_uuid 5b886046-3262-4eca-a390-4cd88779a3c7 root \\nset prefix=($root)'/grub'\\n"
        self.assertEqual(inspector.grub_target_uuid(config),
                         "5b886046-3262-4eca-a390-4cd88779a3c7")
        self.assertIsNone(inspector.grub_target_uuid("search --label ubuntu root"))

    def test_read_only_ext_uuid_at_partition_superblock(self):
        raw = bytearray(16384)
        partition_first = 8
        sb = partition_first * 512 + 1024
        raw[sb+56:sb+58] = bytes((0x53, 0xef))
        expected = uuid.UUID("5b886046-3262-4eca-a390-4cd88779a3c7")
        raw[sb+104:sb+120] = expected.bytes
        self.assertEqual(inspector.ext_filesystem_uuid(
            io.BytesIO(raw),partition_first,31,len(raw)),str(expected))
        raw[sb+56:sb+58] = bytes(2)
        self.assertIsNone(inspector.ext_filesystem_uuid(
            io.BytesIO(raw),partition_first,31,len(raw)))

    def test_zero_byte_file(self):
        out = inspector.read_fat_file(
            {"size": 0, "cluster": 0, "directory": False},
            512, 100, lambda _: self.fail("empty file should not read"),
            lambda _: self.fail("empty file should not advance"),
        )
        self.assertEqual(out, b"")

if __name__ == "__main__":
    unittest.main()
