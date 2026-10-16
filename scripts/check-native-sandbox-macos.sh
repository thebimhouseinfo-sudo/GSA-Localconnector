#!/bin/sh
# Read-only native confinement capability probe. No local workspace mutation.
set -eu
printf '%s\n' 'GSA Localconnector — macOS sandbox preflight (read-only)'
printf 'macOS version: '; sw_vers -productVersion
printf 'Architecture: '; uname -m
for p in /usr/bin/sandbox-exec /usr/bin/codesign /usr/bin/xcrun; do
 if [ -x "$p" ]; then printf 'Executable %s: yes\n' "$p"; else printf 'Executable %s: no\n' "$p"; fi
done
printf 'SIP status: '
if command -v csrutil >/dev/null 2>&1; then csrutil status || true; else printf 'unavailable\n'; fi
printf '%s\n' 'NOTE: Preflight is not proof of sandbox confinement or nested subprocess isolation.'
printf '%s\n' 'No install, permission change, or build process was performed.'
