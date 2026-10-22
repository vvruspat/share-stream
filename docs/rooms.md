# Accounts and saved rooms

The plugin, standalone receiver and browser use the same server accounts. Open
the profile menu to add an account or sign in. Usernames use
3–32 ASCII letters, numbers, dots, underscores or hyphens; passwords use 10–128
characters. Multiple accounts can stay signed in on a device and can be selected
without re-entering their passwords. Opening **Voice & screen** from a signed-in
app also signs the browser into the selected account through a short-lived
handoff; it does not ask for the password again.

Create a named room from the room picker or the **+** action beside the browser's
room list. Room creation, joining by invitation and renaming use focused dialogs;
the normal room screen contains no account or room-management forms. Created
and accepted rooms are saved for the signed-in account. An unnamed imported
session starts as “Music room”; the first account to save it becomes its creator.

The creator can rename a room and invite an existing username. That invitation
adds the room directly to the user's list, including when they are offline. Lists
refresh every five seconds. Copying an invitation from **Invite** still produces
a bearer link: anyone holding it can save the room in their own account. Renaming
keeps the code, membership and old invitation links intact.

In the native UI, select a room and explicitly start sending or connect to its
music, or choose **Voice & screen** for browser chat. Copying an invitation,
creating, importing or selecting a room never starts music. In the browser,
selecting a room previews it; joining is a separate action. The native browser
handoff may join the selected room, with microphone and screen capture off.
Leaving disconnects
media, without removing the room or membership. Restoring a project/account or
reloading the page never starts music or capture. Switching accounts disconnects
the active native stream or browser call; browser captures are stopped.

Up to 64 accounts can save a room and each account can save 100 rooms. Media
supports eight simultaneous participants: one native sender and up to seven
native listeners, plus their browser voice and screen. Saved offline members do not
reserve media slots. Native music has an independent authenticated P2P path per
listener. Only listeners without a working direct path receive targeted relay
packets; a forced-relay listener does not move the other listeners onto the
server. The sender chooses a codec supported by every active listener and falls
back to Float32 while capabilities are unknown. Browser voice and screen use a
full WebRTC mesh with separate voice/screen connections per pair and TURN fallback.
Every participant can speak and share a screen; when several screens are shared,
viewers can select which screen to watch. Upload bandwidth and browser CPU use
grow with the number of participants; eight is the application limit, not a
performance guarantee for every device or connection. Group native streaming
requires the updated relay and sender. Legacy senders/relays retain pair behavior.
There is no room deletion, member removal, invitation revocation or password
recovery UI in this version.

## Storage and privacy

Accounts, room metadata, membership and session hashes live in SQLite. Passwords
are salted with random 128-bit salts and hashed with scrypt. Random 256-bit login
tokens expire after 30 days and only their SHA-256 hashes are stored on the server.
Native sign-out revokes that device's token and forgets it locally; other devices
and saved accounts remain signed in. When offline, native sign-out still forgets
the local token, which remains valid on the server until expiration or successful
revocation. Native login tokens are stored in the user's
`Share Stream/accounts.json`, never in DAW project state or shared invitations.
Native settings use an owner-only directory/file on POSIX systems and the user's
application-data directory on Windows. Passwords are never persisted on clients.

The browser uses an opaque, host-only HttpOnly cookie and server-side account
grants. Production cookies require HTTPS and use SameSite protection; browser
mutations also require the allowed Origin and a CSRF token. Account bearer tokens
are not returned to browser JavaScript or stored in localStorage. A browser can
remember several accounts, while each tab selects its own account. Signing out
removes that browser's grant for the selected account; its other tabs observe the
revocation and stop the affected calls. Other accounts remain available.

## Opening the browser from the app

The native client authenticates a request for a one-use handoff ticket, bound to
its session, account and saved room. The ticket expires after 60 seconds. Only
its hash is stored. The browser removes the ticket from the URL fragment before
initializing the room and prepares the exchange through a JSON POST. Preparation
consumes the ticket atomically and binds the pending exchange to that browser.
Confirmation rechecks the source session, expiry and room membership before
granting a separate browser session. The native bearer token never enters the
browser URL.

If the current tab already uses that authorized account, the exchange completes
automatically. Otherwise, the browser shows **Continue as @username**, without
password fields. This makes first-time linking and account changes explicit;
a forwarded sign-in link must not silently substitute another account. Other
tabs keep their selected accounts. An expired link asks the user to reopen
**Voice & screen** from the app. Guest invitations remain a separate login-free
path, preserving the native/browser participant binding.

Native logout invalidates outstanding handoffs. An already-issued browser grant
is independent. Directory logout does not revoke a shared room code or an
already-established guest media connection; account authentication and room
media credentials have separate lifecycles.

Saved room codes are encrypted with AES-256-GCM at rest, using the separate
`rooms.key`. **The directory server can decrypt saved room codes.** This is a
change from guest-only operation, where the server received only room hashes.
Do not describe saved rooms as private from the directory server operator.
Native audio and browser signaling/media transport encryption are unchanged;
audio, voice and screens are not recorded. The presence and signaling endpoints
still never publish private participant credentials to peers.

Authenticated directory responses contain room codes only for that account's
memberships. Native requests use bearer authorization headers; browser requests
use the cookie and an explicitly selected authorized account. Responses use
`Cache-Control: no-store`.
Shared links contain the room code in their URL fragment, with no account token
or private participant binding. Existing guest invitation links still work.

## Deployment and backups

The development server uses `web/.data`; production reads `DATA_DIR` (default
`.data` outside Docker). Compose mounts the named `directory-data` volume at
`/app/data`, owned by the image's `node` user, while the container root stays
read-only. Both source deployments and the release Coolify helper preserve this
volume across web container recreations.

Before the first tagged deployment with accounts, an administrator must install
the updated `scripts/ci/coolify-image.php` at
`/usr/local/libexec/share-stream-coolify-image.php`, as described in the release
guide. That trusted helper adds `DATA_DIR` and the named volume to the existing
Coolify service. Updating just the web image with the old helper will not add
persistent storage. No live deployment is performed by the feature tests.

Back up the complete data directory while the web service is stopped, including
`directory.sqlite`, any `-wal`/`-shm` files and **rooms.key**. Restore them together
with the same permissions. Startup refuses to open an existing database with a
missing key, preventing silent replacement and loss of saved-room access. The
volume is private server data: never add it to Git, CI artifacts or public assets.

## Focused verification

The web directory tests cover restart durability, encrypted storage, account
validation, session revocation, owner-only management, membership isolation and
the HTTP API. Browser-auth tests cover one-use handoffs, expiration, source-session
revocation, explicit confirmation, cookie rotation, CSRF and per-tab account
authorization. Browser scenarios exercise saved rooms, account switching and
synthetic capture cleanup. Existing media and invitation tests cover guest compatibility.

After compiling the backend TypeScript and native `processor_tests`, run
`node Tests/run_directory_integration.mjs [path/to/processor_tests]` with Node 24.
It starts an isolated real server, uses temporary accounts/settings, exercises
native HTTP login/create/rename/invite/switch/restore/logout, redeems the native
one-use ticket into a browser cookie and checks that both clients use the same
room and participant identity. It then verifies the invited room through the
browser API. It uses no production credentials or media
devices and removes its account storage afterwards.

The native `group_transport` fixture runs all three codecs with seven actual
listeners, four direct and three forced through targeted relay. It checks stereo
audio, late entry, departure/rejoin and the final set of relay recipients. Browser
group tests use four isolated contexts, simultaneous voice and two shared screens,
late entry, departure/rejoin and capture cleanup; server admission tests check the
eight-person limit. These are synthetic local-network checks, not a measurement
of internet NAT success, physical audio latency or eight-browser performance.
