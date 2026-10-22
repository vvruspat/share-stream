Share Stream 0.5.0 adds persistent rooms, group sessions and a simpler interface across the plugin, receiver and browser.

**The 0.5.0 rollout is complete.** The native applications and production server
are now on 0.5.0, with persistent room storage enabled. Refresh existing browser
tabs to load the new interface.

- Create an account with a username and password, keep multiple accounts signed in, and switch from the profile menu. Named rooms remain in your list after everyone leaves and after a server restart. Room creators can rename rooms and invite registered users; invitation links still work for guests.
- Connect up to eight people: one sends music and up to seven listen. Each listener uses its own direct P2P connection with targeted relay fallback. Everyone can speak and share a screen; when several screens are shared, choose which one to watch.
- Use a compact native room picker and account menu, or the browser room sidebar. Creation, invitation, rename and sign-in fields open in focused dialogs. Microphone, screen, audio and leave controls stay easy to reach on desktop and mobile.
- **Voice & screen** opens the browser in the app's selected account and room without another password prompt. First-time linking or changing accounts asks **Continue as @username**. The browser uses a separate HttpOnly session; the launch link contains only a single-use ticket valid for one minute. Each tab keeps its own selected account.
- Copying an invitation, importing or selecting a room never starts music. Start sending or connect to music explicitly. Microphone and screen capture always start off. Joining a saved room from the browser list also requires an explicit join.
- Reopening your browser chat replaces your previous connection without taking another person's slot. Guest native links preserve their participant identity even if the browser already has a saved account. Account changes stop that tab's captures, and names remain intact after leaving and rejoining.

Existing monitor controls, invitation compatibility, live quality changes and device selection are retained. Update the plugin/receiver and refresh browser tabs before using group sessions; older native versions retain pair behavior.

Saved room codes are encrypted on disk but can be read by the directory server. Invitation links remain valid; room deletion, member removal, invitation revocation and password recovery are not available in this release. Group upload bandwidth and CPU use increase with participant count.

| Platform | Combined installer |
| --- | --- |
| macOS 12+, Apple Silicon + Intel | **ShareStream-Setup-macOS.zip** — open **Share Stream Setup.app** |
| Windows 10/11 x64 | **ShareStream-Setup-Windows-x64.exe** |
| Ubuntu 24.04+ x86_64 | **ShareStream-Ubuntu-amd64.deb** |
| Fedora 44+ x86_64 | **ShareStream-Fedora-x86_64.rpm** |

Each installer includes the receiver and VST3; macOS also includes AU. macOS binaries and Setup use the owner’s Apple Developer ID signature and Apple notarization. Windows Setup is currently unsigned. The original macOS ZIP downloads remain available.

Use the built-in updater or download the installer. Save your session before installing and restart the standalone/DAW afterwards. Refresh or reopen the browser chat to load its updated controls. Checksums are in `SHA256SUMS.txt`; Apple’s report is in `NOTARIZATION.json`.
