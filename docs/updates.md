# Native installation and updates

All installers include the standalone receiver and VST3. The macOS installer also includes AU. The standalone remains an output-only listener and does not request microphone permission.

| Platform | Installer | Destinations |
| --- | --- | --- |
| macOS 12+ universal | `ShareStream-Setup-macOS.zip` → `Share Stream Setup.app` | `~/Applications/Share Stream.app`, `~/Library/Audio/Plug-Ins/{VST3,Components}` |
| Windows 10/11 x64 | `ShareStream-Setup-Windows-x64.exe` | `%LOCALAPPDATA%\Programs\Share Stream`, `%LOCALAPPDATA%\Programs\Common\VST3` |
| Ubuntu 24.04+ x86_64 | `ShareStream-Ubuntu-amd64.deb` | `/opt/share-stream`, `/usr/lib/vst3`, system desktop launcher |
| Fedora 44+ x86_64 | `ShareStream-Fedora-x86_64.rpm` | `/opt/share-stream`, `/usr/lib/vst3`, system desktop launcher |

Windows hosts that do not scan per-user VST3 locations need that path added in their plug-in settings. Windows Setup uses a static C++ runtime and includes an uninstaller in Windows Installed Apps and the Start menu. It is currently unsigned; there is no Windows signing credential in CI. macOS Setup uses the existing Developer ID Application identity; an additional Developer ID Installer certificate is not required.

## Updating

0.3.1 predates the updater. Install the latest combined installer once. Afterwards the button at the bottom of either the plug-in or receiver checks GitHub Releases in the background, at most once per day per user. It uses only the latest published stable release from `vvruspat/share-stream`. No invitation, audio, room code or device information is sent to GitHub.

When a newer version is available, choose **Download and install update**. The download, progress, checksum validation and installer launch happen inside Share Stream. You can check manually or disable daily checks in the same menu. Checks and downloads run on a low-priority background thread, independently from the audio callback. Multiple plug-in windows share one updater, with an interprocess lock for downloads/checks.

Save your work before installing. When an update is started from the macOS/Windows standalone, it exits and Setup reopens the new version after success. Restart the DAW after a plug-in update; Linux receivers need a restart after the package transaction. macOS stages every bundle and verifies the owner’s signature before replacing any destination. Replacement uses new files and renames, so loaded binaries stay intact; it never kills an application. Previous bundles are retained under `~/Library/Application Support/Share Stream/Previous installs/`. A failed replacement restores the previous set. Windows Setup never closes the DAW automatically; close the DAW/receiver if files are in use, then retry. Linux updates launch apt/dnf through Polkit: approve the system authentication dialog. The package manager resolves dependencies and retains ownership of system files. A cancelled or failed package transaction is reported in the update button.

## Trust and failure handling

The updater queries `https://api.github.com/repos/vvruspat/share-stream/releases/latest` over system HTTPS. It accepts strict stable semantic versions greater than the running binary, an exact platform asset name, an exact download URL bound to that repository and tag, a bounded size, and GitHub’s SHA-256 digest. Partial or mismatching downloads are never executed. Rate limits and offline errors leave audio and the installed version usable. Cached files live in the user’s Share Stream application-data directory under `Updates/<version>`.

On macOS, the downloaded installer additionally must satisfy an Apple signing requirement for team `3WKK5AGY66` and bundle identifier `audio.sharestream.installer`. Its sealed resources contain already signed and stapled bundles. Archive traversal, absolute paths, symbolic links and oversized payloads are rejected before extraction. The macOS extractor preserves executable permissions and notarization metadata.

GitHub Releases and the repository’s release permissions are the update trust root. The release workflow uploads a draft, compares the server-reported SHA-256 for every installer, and only then marks the complete release public/latest. There is no separate unsigned custom update feed and no user-supplied download URL.

## Uninstall or rollback

- macOS: quit the receiver/DAW and remove the three destinations listed above. For rollback, restore all three bundles from one `Previous installs` directory. Settings are separate and preserved.
- Windows: **Settings → Apps → Share Stream → Uninstall**, or the Start menu uninstaller.
- Ubuntu: `sudo apt remove share-stream`.
- Fedora: `sudo dnf remove share-stream`.

To downgrade deliberately, download a previous trusted release’s installer. The automatic checker never downgrades.
