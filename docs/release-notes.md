Share Stream 0.6.0 introduces a dedicated macOS Chat app and a shared session across the plugin, receiver and chat.

- **Voice & screen** launches **Share Stream Chat.app** directly in the current room. The existing React interface and WebRTC media run inside a bundled Electron app.
- Sign in once in VST3, AU, receiver or Chat. Running clients adopt the same active account without another password or invitation. Passwords accept any 3+ characters.
- Restarting the plugin/DAW/receiver restores the selected room, Send/Listen role and music connection. Explicit Disconnect remains off. Microphone and screen always require a click.
- Account, room management, invitations, participants and settings open separate windows. Renaming a room synchronizes its name for everyone.
- Copy a room code or send an invitation to a username. Pending invitations appear in the app, including after being offline, and require **Accept and join** or **Decline**. Running Chat can show a system notification.
- The combined Setup installs **VST3 + AU + receiver + Chat** and updates them together. Owner Developer ID signing and Apple notarization cover Chat and its embedded helper too.

**Chat requires macOS 13+**, Intel or Apple Silicon. Native music retains macOS 12 support. This release builds macOS only while Windows/Linux builds remain paused. Existing browser invitations and the browser client remain compatible.

Use the built-in plugin/receiver updater or download **ShareStream-Setup-macOS.zip**. Save the DAW session before installing, then restart the DAW, receiver and Chat. The backend updates through the existing Coolify release job; pending invitations require the updated server. No manual database migration or new credentials are needed.
