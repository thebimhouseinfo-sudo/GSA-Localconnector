#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "$(uname -s)" != "Darwin" ]]; then echo "macOS required" >&2; exit 2; fi
binary="$(mktemp -d)/gsa-efi-preflight"
trap 'rm -rf "$(dirname "$binary")"' EXIT
swiftc -framework Virtualization native/macos-vm/EFIBootConfigurationPreflight.swift -o "$binary"
codesign --force --sign - --entitlements native/macos-vm/Virtualization.entitlements "$binary"
codesign --verify --strict --verbose=2 "$binary" >&2
codesign -d --entitlements - "$binary" >&2
image="$HOME/Library/Application Support/GSA-Localconnector/images/ubuntu-24.04-arm64-converted.raw"
if [[ ! -f "$image" ]]; then echo "RAW image not present" >&2; exit 2; fi
printf '{"protocolVersion":"gsa-vm-efi-config-v1","rawImagePath":"%s","expectedBytes":3758096384}' "$image" | "$binary"
