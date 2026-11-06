#!/usr/bin/env python3
"""Stage the real upstream 0.0.14 Darwin ARM64 tunnel client for hosted CI only.

The download is pinned by GitHub release tag AND published asset SHA-256.
Never install, launch a user's tunnel, or use secrets in this CI preparation.
"""
import hashlib
import os
from pathlib import Path
import stat
import sys
import tempfile
import urllib.request
import zipfile

URL = ("https://github.com/openai/tunnel-client/releases/download/v0.0.14/"
       "tunnel-client-v0.0.14-darwin-arm64.zip")
SHA256 = "b540493c5bdbcdbb755700c8e2e16597e28b1569e425007e0f73111047bd6a64"
MAX_ARCHIVE = 40 * 1024 * 1024
MAX_EXPANDED = 150 * 1024 * 1024
MAX_ENTRIES = 256


def stage():
    if sys.platform != "darwin" or os.uname().machine != "arm64":
        raise RuntimeError("BLOCKED: staging requires GitHub-hosted macOS arm64")
    root = Path(__file__).resolve().parents[1]
    destination = root / "bin" / "tunnel-client"
    if destination.exists() or destination.is_symlink():
        raise RuntimeError("BLOCKED: refuse to replace pre-existing tunnel-client")
    with tempfile.TemporaryDirectory(prefix="gsa-ci-real-tunnel-") as tmp:
        archive = Path(tmp) / "source.zip"
        with urllib.request.urlopen(URL, timeout=90) as response, archive.open("xb") as out:
            if response.status != 200:
                raise RuntimeError("upstream release HTTP failure")
            digest = hashlib.sha256()
            total = 0
            while chunk := response.read(1024 * 1024):
                total += len(chunk)
                if total > MAX_ARCHIVE:
                    raise RuntimeError("upstream archive exceeds pinned size budget")
                digest.update(chunk)
                out.write(chunk)
        if digest.hexdigest() != SHA256:
            raise RuntimeError("BLOCKED: upstream release artifact SHA256 mismatch")
        with zipfile.ZipFile(archive) as z:
            entries = z.infolist()
            if not entries or len(entries) > MAX_ENTRIES:
                raise RuntimeError("BLOCKED: release archive entry budget")
            if sum(e.file_size for e in entries) > MAX_EXPANDED:
                raise RuntimeError("BLOCKED: release archive expanded size budget")
            candidates = []
            for entry in entries:
                name = entry.filename
                parts = name.split("/")
                # No archive extraction: inspect and copy only the single binary.
                if (name.startswith("/") or "\\" in name or
                    any(part in ("", ".", "..") for part in parts[:-1]) or
                    parts[-1] in (".", "..") or "\x00" in name):
                    raise RuntimeError("BLOCKED: unsafe release archive path")
                mode = entry.external_attr >> 16
                kind = stat.S_IFMT(mode)
                if kind not in (0, stat.S_IFDIR, stat.S_IFREG):
                    raise RuntimeError("BLOCKED: release contains symlink or special file")
                if not entry.is_dir() and parts[-1] == "tunnel-client":
                    candidates.append(entry)
            if len(candidates) != 1:
                raise RuntimeError("BLOCKED: expected one authentic tunnel-client executable")
            client = candidates[0]
            if not 1_000_000 <= client.file_size <= MAX_EXPANDED:
                raise RuntimeError("BLOCKED: unexpected executable size")
            destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o700)
            try:
                with os.fdopen(fd, "wb") as out, z.open(client) as src:
                    n = 0
                    while chunk := src.read(1024 * 1024):
                        n += len(chunk)
                        if n > MAX_EXPANDED:
                            raise RuntimeError("BLOCKED: extracted client too large")
                        out.write(chunk)
                    if n != client.file_size:
                        raise RuntimeError("BLOCKED: extracted client size mismatch")
            except BaseException:
                destination.unlink(missing_ok=True)
                raise
    print("Verified official tunnel-client v0.0.14 Darwin ARM64 artifact:", SHA256)
    print("Staged one executable for disposable C-G3 package proof; no live installation")


if __name__ == "__main__":
    stage()
