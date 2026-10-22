#!/bin/bash
set -eu
project_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
if ! command -v node >/dev/null 2>&1; then
  printf 'GSA Local Connector requires an existing Node.js 20+ installation.\n' >&2
  exit 1
fi
exec node "$project_dir/scripts/desktop-install.mjs" "$@"
