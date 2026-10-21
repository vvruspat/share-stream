Share Stream 0.4.4 brings the native Local monitor fader to browser voice playback.

- Browser voice now uses a real Web Audio gain stage before playback. Gain changes affect the output samples, including exact mute, and use the same 20 ms smoothing as the native music monitor.
- Both faders use **-60 to +6 dB**, **0.1 dB steps**, **Mute** at the minimum and **double-click to return to 0 dB**. The browser now matches the native two-track L/R meter, narrow thumb and peak readout. Meter bars show the actual post-gain signal independently of the gain thumb.
- Browser Local monitor remains visible outside the collapsed voice settings. It changes the partner’s received voice; the native Local monitor changes the music output. Local gain does not change what the partner receives.
- The selected voice output, explicit Play button for blocked autoplay, mute and gain survive playback recovery and track replacement. Leaving stops the playback graph and clears its meters. Opening voice still does not capture microphone or screen automatically.
- Shared gain fixtures and tests exercise native fader actions against real stereo samples; browser tests measure the processed PCM arriving at the output rather than only checking an HTML volume property.

All v0.4.3 chat invitation compatibility and earlier streaming, participant and quality controls are retained.

| Platform | Combined installer |
| --- | --- |
| macOS 12+, Apple Silicon + Intel | **ShareStream-Setup-macOS.zip** — open **Share Stream Setup.app** |
| Windows 10/11 x64 | **ShareStream-Setup-Windows-x64.exe** |
| Ubuntu 24.04+ x86_64 | **ShareStream-Ubuntu-amd64.deb** |
| Fedora 44+ x86_64 | **ShareStream-Fedora-x86_64.rpm** |

Each installer includes the receiver and VST3; macOS also includes AU. macOS binaries and Setup use the owner’s Apple Developer ID signature and Apple notarization. Windows Setup is currently unsigned. The original macOS ZIP downloads remain available.

Use the built-in updater or download the installer. Save your session before installing and restart the standalone/DAW afterwards. Refresh or reopen the browser chat to load its updated controls. Checksums are in `SHA256SUMS.txt`; Apple’s report is in `NOTARIZATION.json`.
