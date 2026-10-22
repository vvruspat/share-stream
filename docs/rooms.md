# Accounts and saved rooms

The plugin, standalone receiver and browser use the same server accounts. Choose
**Add account** in the native UI or **Register** in the browser. Usernames use
3–32 ASCII letters, numbers, dots, underscores or hyphens; passwords use 10–128
characters. Sign in separately on each device. Multiple accounts can stay signed
in on a device and can be selected without re-entering their passwords.

Create a named room with **New room** (native) or **Create room** (browser).
Native **Create session**, **Copy invite** and **Paste invite** also save the
current room when signed in. **Save current** imports a legacy session without
starting music. An unnamed imported session starts as “Music room”; the first
account to save it becomes its creator.

The creator can rename a room and invite an existing username. That invitation
adds the room directly to the user's list, including when they are offline. Lists
refresh every five seconds. **Copy invite** / **Copy room invite** still produces
a bearer link: anyone holding it can save the room in their own account. Renaming
keeps the code, membership and old invitation links intact.

In the native UI, select a saved room and press **Connect to room** for music or
**Voice & screen** for browser chat. In the browser, clicking a saved room joins
chat. Joining never enables microphone or screen capture. Leaving disconnects
media, without removing the room or membership. Restoring a project/account or
reloading the page never starts music or capture. Switching accounts disconnects
the active native stream or browser call; browser captures are stopped.

Up to 64 accounts can save a room and each account can save 100 rooms. Media is
still limited to two simultaneous participants: one native sender and one native
listener, plus their browser voice and screen. Saved offline members do not
reserve media slots. There is no room deletion, member removal, invitation
revocation or password recovery UI in this version.

## Storage and privacy

Accounts, room metadata, membership and session hashes live in SQLite. Passwords
are salted with random 128-bit salts and hashed with scrypt. Random 256-bit login
tokens expire after 30 days and only their SHA-256 hashes are stored on the server.
Signing out revokes that device's token and forgets it locally; other devices and
saved accounts remain signed in. When offline, sign out still forgets the local
token, which remains valid on the server until expiration or successful revocation.
Login tokens are stored in browser localStorage or the user's native
`Share Stream/accounts.json`, never in DAW project state or shared invitations.
Native settings use an owner-only directory/file on POSIX systems and the user's
application-data directory on Windows. Passwords are never persisted on clients.

Saved room codes are encrypted with AES-256-GCM at rest, using the separate
`rooms.key`. **The directory server can decrypt saved room codes.** This is a
change from guest-only operation, where the server received only room hashes.
Do not describe saved rooms as private from the directory server operator.
Native audio and browser signaling/media transport encryption are unchanged;
audio, voice and screens are not recorded. The presence and signaling endpoints
still never publish private participant credentials to peers.

Authenticated directory responses contain room codes only for that account's
memberships. They use bearer authorization headers and `Cache-Control: no-store`.
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
the HTTP API. The browser scenario `saved rooms survive leave and reload,
invitations and account switching` exercises two isolated accounts and synthetic
capture cleanup. Existing media and invitation tests cover guest compatibility.

After compiling the backend TypeScript and native `processor_tests`, run
`node Tests/run_directory_integration.mjs [path/to/processor_tests]` with Node 24.
It starts an isolated real server, uses temporary accounts/settings, exercises
native HTTP login/create/rename/invite/switch/restore/logout, then verifies the
invited room through the browser API. It uses no production credentials or media
devices and removes its account storage afterwards.
