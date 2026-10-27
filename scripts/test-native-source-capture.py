#!/usr/bin/env python3
"""Read-only Darwin snapshot fixtures; all source content lives in temporary roots."""
import base64
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

REPO = Path(__file__).resolve().parents[1]


class CaptureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.build = tempfile.TemporaryDirectory(prefix="gsa-capture-build-")
        cls.binary = Path(cls.build.name) / "source-capture"
        source = REPO / "native/macos-vm/SourceCapture.swift"
        assert source.exists(), "descriptor-relative source capture helper is missing"
        subprocess.run(["swiftc", str(source), "-o", str(cls.binary)], check=True)

    @classmethod
    def tearDownClass(cls):
        cls.build.cleanup()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="gsa-capture-fixture-")
        self.root = Path(self.temp.name).resolve()

    def tearDown(self):
        self.temp.cleanup()

    def capture(self, **options):
        request = dict(protocolVersion="gsa-source-capture-v1", canonicalRoot=str(self.root), **options)
        result = subprocess.run([str(self.binary)], input=json.dumps(request).encode(), capture_output=True, timeout=10)
        self.assertEqual(result.stderr, b"")
        return result.returncode, json.loads(result.stdout)

    def blocked(self, **options):
        status, result = self.capture(**options)
        self.assertEqual(status, 2)
        self.assertEqual(result["state"], "BLOCKED")
        self.assertNotIn("files", result)
        self.assertFalse(result["securityVerified"])

    def test_sorted_binary_capture_does_not_change_source(self):
        (self.root / "z").mkdir()
        (self.root / "z/b.bin").write_bytes(b"\x00\xff\x01")
        (self.root / "a.txt").write_bytes(b"hello\n")
        before = {str(p): (p.stat().st_ino, p.stat().st_mode, p.stat().st_mtime_ns, p.stat().st_ctime_ns) for p in self.root.rglob("*")}
        status, result = self.capture()
        self.assertEqual(status, 0)
        self.assertEqual(result["state"], "CAPTURED")
        self.assertEqual(result["canonicalRoot"], str(self.root))
        self.assertFalse(result["securityVerified"])
        self.assertEqual([f["path"] for f in result["files"]], ["a.txt", "z/b.bin"])
        self.assertEqual(result["totalBytes"], 9)
        self.assertEqual(result["rootIdentity"], {"device": self.root.stat().st_dev, "inode": self.root.stat().st_ino})
        for entry, expected in zip(result["files"], [b"hello\n", b"\x00\xff\x01"]):
            self.assertEqual(base64.b64decode(entry["base64"]), expected)
            self.assertEqual(entry["sha256"], hashlib.sha256(expected).hexdigest())
            self.assertEqual(entry["size"], len(expected))
        self.assertEqual(before, {str(p): (p.stat().st_ino, p.stat().st_mode, p.stat().st_mtime_ns, p.stat().st_ctime_ns) for p in self.root.rglob("*")})

    def test_symlinks_even_inside_root_block(self):
        (self.root / "real").write_text("private")
        (self.root / "alias").symlink_to("real")
        self.blocked()

    def test_directory_symlink_blocks(self):
        (self.root / "real").mkdir()
        (self.root / "alias").symlink_to("real", target_is_directory=True)
        self.blocked()

    def test_hardlink_blocks(self):
        (self.root / "real").write_text("private")
        os.link(self.root / "real", self.root / "alias")
        self.blocked()

    def test_fifo_blocks_without_opening(self):
        os.mkfifo(self.root / "pipe")
        self.blocked()

    def test_portable_segment_rejections(self):
        for name in ["CON", "lpt1.txt", "trailing.", "trailing ", "a:b", "a\\b", "control\x01"]:
            with self.subTest(name=name):
                path = self.root / name
                path.write_text("x")
                self.blocked()
                path.unlink()

    def test_caps_and_invalid_bounds(self):
        (self.root / "a").write_bytes(b"abc")
        (self.root / "b").write_bytes(b"d")
        self.blocked(maxBytes=3)
        self.blocked(maxFiles=1)
        self.blocked(maxBytes=33554433)
        self.blocked(maxFiles=2001)
        self.blocked(maxFiles=True)
        self.assertEqual(self.capture(maxBytes=4, maxFiles=2)[0], 0)

    def test_explicit_exclusions_and_provenance(self):
        (self.root / ".git").mkdir()
        (self.root / ".git/config").write_text("metadata")
        (self.root / "node_modules").mkdir()
        (self.root / "keep").write_text("source")
        status, result = self.capture()
        self.assertEqual(status, 0)
        self.assertEqual(result["excludedNames"], [".git", "node_modules"])
        self.assertEqual([f["path"] for f in result["files"]], ["keep"])
        self.assertEqual([f["path"] for f in self.capture(excludeNames=[])[1]["files"]], [".git/config", "keep"])
        self.blocked(excludeNames=["../escape"])

    def test_preserves_executable_intent_without_mutating_permissions(self):
        (self.root / "tool").write_text("#!/bin/sh\nexit 0\n")
        (self.root / "tool").chmod(0o750)
        (self.root / "data").write_text("data")
        (self.root / "data").chmod(0o640)
        status, result = self.capture()
        self.assertEqual(status, 0)
        self.assertEqual([(f["path"], f["executable"]) for f in result["files"]], [("data", False), ("tool", True)])
        self.assertEqual((self.root / "tool").stat().st_mode & 0o777, 0o750)
        self.assertEqual((self.root / "data").stat().st_mode & 0o777, 0o640)

    def test_root_must_be_canonical_and_not_symlink(self):
        request = {"protocolVersion": "gsa-source-capture-v1", "canonicalRoot": str(self.root) + "/../" + self.root.name}
        result = subprocess.run([str(self.binary)], input=json.dumps(request).encode(), capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 2)

    def test_root_with_symlink_ancestor_is_rejected(self):
        (self.root / "real").mkdir()
        (self.root / "real/project").mkdir()
        (self.root / "alias").symlink_to("real", target_is_directory=True)
        request = {"protocolVersion": "gsa-source-capture-v1", "canonicalRoot": str(self.root / "alias/project")}
        result = subprocess.run([str(self.binary)], input=json.dumps(request).encode(), capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 2)

    def test_oversized_and_malformed_input(self):
        for request in [b" " * 8193, b"{}", b"[]", b"not-json"]:
            result = subprocess.run([str(self.binary)], input=request, capture_output=True, timeout=10)
            self.assertEqual(result.returncode, 2)
            self.assertEqual(json.loads(result.stdout)["state"], "BLOCKED")


if __name__ == "__main__":
    unittest.main(verbosity=2)
