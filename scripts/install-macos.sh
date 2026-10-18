#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p "$HOME/Library/Audio/Plug-Ins/VST3" "$HOME/Library/Audio/Plug-Ins/Components" "$HOME/Applications"
# Replace bundles by rename, so a running DAW keeps its old mapped executable
# intact until it is restarted. Keep the old signed bundles for rollback.
backup_base="$HOME/Library/Application Support/Share Stream/Previous installs"
mkdir -p "$backup_base"
backup_dir="$(mktemp -d "$backup_base/install.XXXXXX")"
install_bundle() {
  local bundle="$1" destination="$2" staging
  staging="$(mktemp -d "$(dirname "$destination")/.share-stream-install.XXXXXX")"
  ditto "$bundle" "$staging/$bundle"
  codesign --verify --deep --strict "$staging/$bundle"
  if [ -e "$destination" ]; then mv "$destination" "$backup_dir/$bundle"; fi
  if ! mv "$staging/$bundle" "$destination"; then
    if [ -e "$backup_dir/$bundle" ]; then mv "$backup_dir/$bundle" "$destination"; fi
    return 1
  fi
  rmdir "$staging"
}
install_bundle "Share Stream.vst3" "$HOME/Library/Audio/Plug-Ins/VST3/Share Stream.vst3"
install_bundle "Share Stream.component" "$HOME/Library/Audio/Plug-Ins/Components/Share Stream.component"
install_bundle "Share Stream.app" "$HOME/Applications/Share Stream.app"
printf 'Installed. Restart your DAW to discover Share Stream.\nReceiver: open ~/Applications/Share Stream.app\n'
