#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "Requires macOS ARM64" >&2; exit 2
fi
temp_dir="$(mktemp -d)"
trap 'rm -rf "$temp_dir"' EXIT
binary="$temp_dir/gsa-vm-boot-probe"
swiftc -g -framework Virtualization -framework AppKit native/macos-vm/BootProbe.swift -o "$binary"
codesign --force --sign - --entitlements native/macos-vm/Virtualization.entitlements "$binary"
codesign --verify --strict "$binary"
image="$HOME/Library/Application Support/GSA-Localconnector/images/ubuntu-24.04-arm64-converted.raw"
if [[ ! -f "$image" ]]; then echo "RAW image missing" >&2; exit 2; fi
echo "Experimental VM start only. No Linux userspace/SEC01 proof. No host shares or network." >&2
set +e
printf '{"protocolVersion":"gsa-vm-boot-probe-v1","imagePath":"%s","expectedSHA256":"384f7eb9976ad155812b48efb1b780024c0748e35b5c3161c82c797578168e7e","expectedBytes":3758096384,"timeoutSeconds":30}' "$image" | "$binary"
rc=$?
set -e
if [[ "$rc" -ne 0 ]]; then
  echo "BOOT_PROBE_FAILED exit=$rc (review last GSA_VM_PHASE above)" >&2
  echo "Recent macOS crash reports (read-only inspection):" >&2
  find "$HOME/Library/Logs/DiagnosticReports" -maxdepth 1 -type f \( -name "*gsa-vm-boot-probe*" -o -name "*gsa-vm-boot-probe*.ips" \) -print 2>/dev/null | tail -5 >&2 || true
fi
exit "$rc"
