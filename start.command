#!/bin/zsh
# Compatibility entrypoint: installed native app owns the background runtime.
set -eu
app="$HOME/Applications/GSA Local Connector.app"
if [[ -d "$app" ]]; then
  exec /usr/bin/open "$app"
fi
project_dir="${0:A:h}"
exec /bin/bash "$project_dir/install.sh"
