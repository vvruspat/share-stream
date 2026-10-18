#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p "$HOME/Library/Audio/Plug-Ins/VST3" "$HOME/Library/Audio/Plug-Ins/Components" "$HOME/Applications"
ditto "Share Stream.vst3" "$HOME/Library/Audio/Plug-Ins/VST3/Share Stream.vst3"
ditto "Share Stream.component" "$HOME/Library/Audio/Plug-Ins/Components/Share Stream.component"
ditto "Share Stream.app" "$HOME/Applications/Share Stream.app"
printf 'Installed. Restart your DAW to discover Share Stream.\nReceiver: open ~/Applications/Share Stream.app\n'
