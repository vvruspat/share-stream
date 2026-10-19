Music, voice and screen in one private session, now on macOS, Windows and Linux.

- Built-in daily GitHub Releases checks in the plug-in and standalone. Use the update button to download, verify and launch the installer. Automatic checks can be disabled.
- One macOS installer installs the standalone receiver, VST3 and Audio Unit for this user. Signed with Aleksandr Kolesov’s Developer ID and notarized by Apple. It stages all components, keeps previous versions and rolls back a failed replacement.
- Windows x64 Setup installs the receiver and VST3 together, with Start menu shortcuts and an uninstaller.
- Native Ubuntu 24.04+ DEB and Fedora 44+ RPM packages include the receiver, VST3 and desktop launcher. Updates use apt/dnf with the system’s authentication dialog.
- Release downloads are checked against GitHub’s SHA-256 asset digests; macOS also requires the owner’s Apple signature before launching the installer.
- Existing encrypted audio and the shared invitation for music, voice and screen are preserved.

| Platform | Download |
| --- | --- |
| macOS 12+, Apple Silicon + Intel | **ShareStream-Setup-macOS.zip** — open **Share Stream Setup.app** |
| Windows 10/11 x64 | **ShareStream-Setup-Windows-x64.exe** |
| Ubuntu 24.04+ x86_64 | **ShareStream-Ubuntu-amd64.deb** |
| Fedora 44+ x86_64 | **ShareStream-Fedora-x86_64.rpm** |

The two original macOS ZIPs remain available. AU is available on macOS; all platforms include VST3.

**First update:** 0.3.1 has no updater. Install 0.4.1 once using the new installer; future releases appear inside Share Stream. Save your session before updating. Restart the standalone and DAW after installation. On Windows, close both before the installer replaces files.

Windows Setup is currently unsigned (no Windows code-signing certificate is configured). macOS binaries and Setup use only the owner’s Apple Developer ID and notarization. Checksums for every platform are in `SHA256SUMS.txt`; Apple’s report is in `NOTARIZATION.json`.
