#!/bin/sh
# Read-only native macOS sandbox availability probe.
# No admin, filesystem mutations, Docker, or user secrets.
set -u
VERSION="$(/usr/bin/sw_vers -productVersion 2>/dev/null || printf unknown)"
ARCH="$(/usr/bin/uname -m 2>/dev/null || printf unknown)"
SANDBOX=false
BASELINE=false
if [ -x /usr/bin/sandbox-exec ]; then
  SANDBOX=true
  if /usr/bin/sandbox-exec -p '(version 1)(allow default)' /usr/bin/true >/dev/null 2>&1; then
    BASELINE=true
  fi
fi
# Baseline operation does NOT prove Workspace-only filesystem enforcement.
printf '{ "platform":"macos", "version":"%s", "architecture":"%s", "sandbox_exec_present":%s, "baseline_runs":%s, "security_verified":false }\n' "$VERSION" "$ARCH" "$SANDBOX" "$BASELINE"
