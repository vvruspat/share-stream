Share Stream 0.4.3 fixes opening voice and screen chat from the plug-in and standalone receiver.

- **Voice & screen** now preserves the invitation fragment exactly when opening the browser. Room, relay, port, auto-join and the private participant binding arrive correctly.
- The browser and native Paste invite also accept existing invitations whose whole fragment was escaped once or twice by earlier clients. Once this web update is deployed, links opened by v0.4.2 clients work without reinstalling them.
- Native and browser presence still represent the same participant. The private binding is consumed into this tab’s session storage and removed from the shareable URL. Microphone and screen capture remain off until explicitly enabled.
- Canonical invitations remain unchanged. Duplicate parameters and encoded field values cannot introduce extra invitation fields.

All v0.4.2 session controls, streaming qualities, monitoring, participant names and domain-based connections are retained.

| Platform | Combined installer |
| --- | --- |
| macOS 12+, Apple Silicon + Intel | **ShareStream-Setup-macOS.zip** — open **Share Stream Setup.app** |
| Windows 10/11 x64 | **ShareStream-Setup-Windows-x64.exe** |
| Ubuntu 24.04+ x86_64 | **ShareStream-Ubuntu-amd64.deb** |
| Fedora 44+ x86_64 | **ShareStream-Fedora-x86_64.rpm** |

Each installer includes the receiver and VST3; macOS also includes AU. macOS binaries and Setup use the owner’s Apple Developer ID signature and Apple notarization. Windows Setup is currently unsigned. The original macOS ZIP downloads remain available.

Use the built-in updater or download the installer. Save your session before installing and restart the standalone/DAW afterwards. Version 0.3.1 predates the updater and needs a manual installation. Checksums are in `SHA256SUMS.txt`; Apple’s report is in `NOTARIZATION.json`.
