#!/usr/bin/env python3
"""Exercise the actual signed macOS recovery broker candidate, not a mock.

This is an additional native prerequisite for C-A.  It deliberately does NOT
replace the production owner-interruption/physical-stop/no-replay gate.
"""
import hashlib
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "native/macos-files/recovery-broker.swift"
FIXTURE = ROOT / "native/macos-files/test-recovery-broker.py"
CANDIDATE = Path("/private/tmp/gsa-recovery-broker-candidate")
PINNED_SOURCE_SHA256 = "d31392926056ce369999ee48ccc4c3ce47a715a25e3db972da015b496407e14f"


def run():
    if sys.platform != "darwin" or os.uname().machine != "arm64":
        raise RuntimeError("BLOCKED C-A recovery candidate: native macOS ARM64 required")
    if hashlib.sha256(SOURCE.read_bytes()).hexdigest() != PINNED_SOURCE_SHA256:
        raise RuntimeError("BLOCKED C-A recovery source differs from reviewed pinned source")
    if CANDIDATE.exists() or CANDIDATE.is_symlink():
        raise RuntimeError("BLOCKED C-A candidate path already occupied; refuse overwrite")
    # Explicit, exclusive ownership of the disposable candidate path.  The
    # test-broker harness uses this fixed legacy location; never share a runner.
    fd = os.open(CANDIDATE, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o700)
    os.close(fd)
    initial = os.lstat(CANDIDATE)
    try:
        subprocess.run(
            ["/usr/bin/swiftc", str(SOURCE), "-o", str(CANDIDATE)],
            cwd=ROOT, check=True, timeout=120,
        )
        compiled = os.lstat(CANDIDATE)
        if not CANDIDATE.is_file() or compiled.st_uid != os.getuid():
            raise RuntimeError("BLOCKED C-A compiled candidate has invalid owner/type")
        # Verify the real broker's signed sandbox/container interactions.
        result = subprocess.run(
            [sys.executable, str(FIXTURE)], cwd=ROOT,
            text=True, capture_output=True, timeout=180,
        )
        print(result.stdout[-16000:])
        print(result.stderr[-16000:], file=sys.stderr)
        if result.returncode != 0 or "FAILED" in result.stderr or "OK" not in result.stderr:
            raise RuntimeError("FAIL C-A signed recovery candidate native suite")
        if "skipped=" in result.stderr:
            raise RuntimeError("BLOCKED C-A signed recovery candidate suite skipped tests")
        print("PASS C-A signed recovery broker candidate; production owner recovery still PENDING")
    finally:
        # Verify the exact candidate name remains a regular single-link file
        # owned by this runner; never clean up a replaced foreign path.
        try:
            after = os.lstat(CANDIDATE)
        except FileNotFoundError:
            pass
        else:
            if (after.st_uid == os.getuid() and
                after.st_nlink == 1 and CANDIDATE.is_file() and
                after.st_dev == initial.st_dev):
                CANDIDATE.unlink()
            else:
                raise RuntimeError("BLOCKED C-A candidate cleanup identity changed; preserved")


if __name__ == "__main__":
    run()
