#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "Requires macOS ARM64" >&2; exit 2
fi
mode="${1:-}"
if [[ "$#" -gt 1 || ( -n "$mode" && "$mode" != "--fallback-candidate" && "$mode" != "--offline-smoke" ) ]]; then
  echo "Usage: bash scripts/test-macos-vm-boot.sh [--fallback-candidate|--offline-smoke]" >&2
  exit 2
fi
temp_dir="$(mktemp -d)"
trap 'rm -rf "$temp_dir"' EXIT
bundle="$temp_dir/GSAProbe.app"
mkdir -p "$bundle/Contents/MacOS"
cat > "$bundle/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>local.gsa.vm-boot-probe</string>
<key>CFBundleName</key><string>GSA VM Boot Probe</string>
<key>CFBundleExecutable</key><string>gsa-vm-boot-probe</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
binary="$bundle/Contents/MacOS/gsa-vm-boot-probe"
swiftc -g -framework Virtualization -framework AppKit native/macos-vm/BootProbe.swift -o "$binary"
codesign --force --sign - --entitlements native/macos-vm/Virtualization.entitlements "$bundle"
codesign --verify --strict "$bundle"
echo "GSA_VM_APP_BUNDLE=$bundle" >&2
image="$HOME/Library/Application Support/GSA-Localconnector/images/ubuntu-24.04-arm64-converted.raw"
digest="384f7eb9976ad155812b48efb1b780024c0748e35b5c3161c82c797578168e7e"
if [[ "$mode" == "--fallback-candidate" || "$mode" == "--offline-smoke" ]]; then
  image="$HOME/Library/Application Support/GSA-Localconnector/images/ubuntu-24.04-arm64-efi-fallback-candidate.raw"
  manifest="$HOME/Library/Application Support/GSA-Localconnector/images/ubuntu-24.04-arm64-efi-fallback-candidate.json"
  if [[ ! -f "$manifest" || ! -f "$image" || -L "$image" || -L "$manifest" ]]; then
    echo "Missing or unsafe fallback candidate/manifest. Prepare offline candidate first." >&2
    exit 2
  fi
  digest="$(python3 - "$manifest" "$image" <<'PY'
import json, re, sys
with open(sys.argv[1],encoding="utf-8") as f: m=json.load(f)
expected_base="384f7eb9976ad155812b48efb1b780024c0748e35b5c3161c82c797578168e7e"
def require(condition):
    if not condition:raise SystemExit("INVALID_FALLBACK_MANIFEST")
require(m.get("state")=="OFFLINE_FALLBACK_CANDIDATE")
require(m.get("baseSHA256")==expected_base)
require(m.get("imagePath")==sys.argv[2])
require(m.get("expectedBytes")==3758096384)
require(m.get("bootVerified") is False)
require(m.get("securityVerified") is False)
require(m.get("executionAuthorized") is False)
sha=m.get("imageSHA256","")
require(re.fullmatch(r"[0-9a-f]{64}",sha) and sha != expected_base)
print(sha)
PY
)"
  echo "Using patched COPY-ON-WRITE candidate; original RAW untouched." >&2

fi
if [[ ! -f "$image" ]]; then echo "RAW image missing" >&2; exit 2; fi
request="$(python3 - "$image" "$digest" "$mode" "$temp_dir" <<'PY'
import importlib.util,json,pathlib,secrets,sys
request={"protocolVersion":"gsa-vm-boot-probe-v1","imagePath":sys.argv[1],"expectedSHA256":sys.argv[2],"expectedBytes":3758096384,"timeoutSeconds":30}
if sys.argv[3]=="--offline-smoke":
    spec=importlib.util.spec_from_file_location("seed",pathlib.Path("scripts/prepare-vm-smoke-seed.py"))
    seed=importlib.util.module_from_spec(spec);spec.loader.exec_module(seed)
    request.update(seed.prepare(pathlib.Path(sys.argv[4])/"seed",secrets.token_hex(32)))
    request.update(diskMode="disposable-clone",timeoutSeconds=120)
print(json.dumps(request))
PY
)"
echo "Experimental VM probe. No SEC01 proof, host shares or network." >&2
if [[ "$mode" == "--offline-smoke" ]]; then
  echo "Offline workload: writable private APFS clone + read-only NoCloud seed; source images immutable." >&2
fi
set +e
printf '%s\n' "$request" | "$binary"
rc=$?
set -e
if [[ "$mode" == "--offline-smoke" ]]; then
  python3 - "$image" "$digest" <<'PY'
import hashlib,pathlib,sys
images=pathlib.Path.home()/"Library/Application Support/GSA-Localconnector/images"
for file,want in [(images/"ubuntu-24.04-arm64-converted.raw","384f7eb9976ad155812b48efb1b780024c0748e35b5c3161c82c797578168e7e"),(pathlib.Path(sys.argv[1]),sys.argv[2])]:
    h=hashlib.sha256()
    with file.open("rb") as f:
        for chunk in iter(lambda:f.read(1024*1024),b""):h.update(chunk)
    if h.hexdigest()!=want:raise SystemExit("SOURCE_IMAGE_CHANGED: "+str(file))
print("GSA_VM_BASE_IMAGES_UNCHANGED",file=sys.stderr)
PY
fi
if [[ "$rc" -ne 0 ]]; then
  echo "BOOT_PROBE_FAILED exit=$rc (review last GSA_VM_PHASE above)" >&2
  echo "Recent macOS crash reports (read-only inspection):" >&2
  find "$HOME/Library/Logs/DiagnosticReports" -maxdepth 1 -type f \( -name "*gsa-vm-boot-probe*" -o -name "*gsa-vm-boot-probe*.ips" \) -print 2>/dev/null | tail -5 >&2 || true
fi
exit "$rc"
