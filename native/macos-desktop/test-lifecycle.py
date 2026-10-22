#!/usr/bin/env python3
"""Run the actual private AppKit/Node installer fixture; no live credentials."""
import pathlib
import subprocess
import sys

root = pathlib.Path(__file__).resolve().parents[2]
raise SystemExit(subprocess.run([
    "node", str(root / "scripts/test-desktop-install-native.mjs"), *sys.argv[1:]
], cwd=root, check=False).returncode)
