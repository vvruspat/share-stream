Share Stream 0.4.5 fixes chat rooms filling up when one participant opens another browser tab.

- Opening **Voice & screen** again replaces your previous browser connection instead of taking the partner's place. The old tab stops its microphone and screen capture and does not reconnect automatically.
- Native music and browser chat use the same private participant credential. The browser remembers it per room, so reopening an ordinary room link in the same browser restores that identity. A fresh link from your own plugin or standalone takes precedence over the saved identity.
- Two people can each stream/listen to music and join voice and screen in the same room. The two-person limit still rejects a third person. Shared invitations never include your private participant credential.
- Each new browser page still gets a fresh public signaling ID, preserving encryption replay protection across replacement. Regression tests cover two native presence records, repeated chat launches, received voice, decoded screen frames, and rejection of unauthenticated replacement.

All v0.4.4 monitor controls, invitation compatibility and earlier streaming, participant and quality controls are retained. Refresh the chat on both sides once after deployment so older tabs use the new participant binding.

| Platform | Combined installer |
| --- | --- |
| macOS 12+, Apple Silicon + Intel | **ShareStream-Setup-macOS.zip** — open **Share Stream Setup.app** |
| Windows 10/11 x64 | **ShareStream-Setup-Windows-x64.exe** |
| Ubuntu 24.04+ x86_64 | **ShareStream-Ubuntu-amd64.deb** |
| Fedora 44+ x86_64 | **ShareStream-Fedora-x86_64.rpm** |

Each installer includes the receiver and VST3; macOS also includes AU. macOS binaries and Setup use the owner’s Apple Developer ID signature and Apple notarization. Windows Setup is currently unsigned. The original macOS ZIP downloads remain available.

Use the built-in updater or download the installer. Save your session before installing and restart the standalone/DAW afterwards. Refresh or reopen the browser chat to load its updated controls. Checksums are in `SHA256SUMS.txt`; Apple’s report is in `NOTARIZATION.json`.
