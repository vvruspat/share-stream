# Session interface

The native plugin owns the music connection. Native and browser clients share
server accounts and a persistent named-room directory. Both can create rooms,
save invitations, rename owned rooms and invite registered users. Voice & screen
opens the browser in the selected native room. Opening the browser never requests
microphone or screen permission. See [accounts and saved rooms](rooms.md).

Native introductions use `stream.whitesquirrel.digital:48100/UDP`. New invites
carry this hostname. Saved projects and legacy invitations containing the former
built-in relay IP migrate to this domain; custom relay addresses remain intact.
The network worker resolves it through DNS before the existing UDP handshake.

Rooms support up to eight people: one music sender and up to seven listeners.
Each listener has an independent authenticated P2P path, with targeted relay as
fallback. Browser voice and screen form independent WebRTC links for every pair.
Audio payload formats and encryption stay compatible; targeted relay adds a
routing envelope which the server strips before delivery. Congestion priorities
and receiver jitter-buffer behavior remain independent of room membership.

## Native controls

Create session starts the selected music role. Join session accepts the
clipboard invitation, or asks for one when the clipboard is not valid. The
active session shows Copy invite and Leave session. Changing Send audio / Listen
keeps the room and reconnects with the selected role.

Local monitor displays one slider bound to the selected role's existing host
parameter. Both per-role settings remain saved in DAW state. The engine's
-60 to +6 dB range and 0.1 dB step are preserved; -60 dB is mute. The L/R tracks
measure the actual stereo output after the smoothed local gain. Their signal
scale is -60 to 0 dBFS, independent of the gain thumb. The peak readout is also
post-monitor, and stale meters clear when callbacks stop. Music is captured
before monitoring gain, so local mute does not mute the remote stream.

Connection address, private code, quality, network buffer, packet diagnostics
and the standalone output device control live under Audio & connection
settings. A scrollable content area keeps expanded settings accessible inside
the fixed-size editor. The update menu remains a small footer action.

## Browser controls

The stream contains an always-visible toolbar at bottom right with three
44 px controls: microphone, screen sharing and fullscreen. The fullscreen API
target is the entire stage, including controls, tooltips and media errors.
`fullscreenchange` synchronizes the button after external exits, including
Escape. Unsupported fullscreen reports an error instead of simulating it.

Voice settings and Participants use Radix disclosures, closed initially. Their
contents stay mounted to preserve device selections. Voice playback lives
outside the disclosure, so collapsing it never interrupts audio. Screen video
uses `object-fit: contain`; the local screen fills the stage when there is no
remote screen, otherwise it becomes a small preview.

The browser's always-visible Local monitor uses the native fader design: two
L/R signal tracks, a separate narrow gain thumb, a dB gain readout and post-gain
peak in dBFS. Both controls use -60..+6 dB in 0.1 dB steps, exact mute at -60 dB,
double-click reset to 0 dB and a 20 ms linear gain ramp. Browser monitoring changes
the partner's received voice; native monitoring changes the music output.

Browser gain multiplies the decoded samples in Web Audio before they reach the
output media element. That element stays at unity and retains `setSinkId` device
selection and the explicit Play fallback. A separate muted media element keeps
Chromium's remote RTP decoder running; it cannot bypass the gain. Both elements
and the output graph are released on departure/replacement. Input tracks remain
owned by WebRTC. The meter reads the same post-gain signal at 20 Hz and clears on
mute, ended input, a suspended context or departure. The control remains mounted when voice
settings are collapsed, and the selected gain survives call reconnection.

## Participant identity and presence

A separate HTTPS `/api/presence` control endpoint combines native and browser
connections. It carries no music or screen data and cannot stop the audio
engine. Native registration runs on its own worker; browser polling runs once
per second. Source records expire after eight seconds without a heartbeat.
Room hashes match the existing browser signaling room derivation. Presence and signaling receive only the room hash and never return participant
credentials to peers. The separate authenticated saved-room directory stores room
codes encrypted at rest and can decrypt them for account members.

For signed-in members, the directory supplies one stable private participant
credential per account/room, shared across native and browser clients. For guests,
a per-installation random key is stored alongside native application settings
in `Share Stream/participant.key`. It derives a different private credential for
each room. Native instances in the same installation/room and a browser opened
from Voice & screen share this credential. Copy invite omits it. The browser
removes the binding from the fragment immediately and retains it per room in
localStorage, with tab session storage as a fallback and migration source. A
fresh native launch takes precedence over a saved browser identity. Copying a
DAW project to another computer does not copy a person's ID.

Signaling authenticates with the same private credential. Opening another tab
replaces that participant's old browser transport and stops its capture, instead
of consuming a second person's slot. Each transport still gets a fresh public
signaling ID and encryption sequence, so the partner can accept its new messages
without weakening replay checks. The replaced tab does not auto-reconnect. Native
presence does not occupy a browser signaling slot, and up to eight distinct people can
each use music, voice and screen in the same room. A ninth person is rejected.
The versioned chat handshake asks older pages to reload before reserving a slot;
old per-page sessions therefore cannot keep blocking the partner after deployment.

The public participant ID is a hash of that credential. Names do not merge
participants. A default name is derived from the ID; a person may set their name
under Voice settings. The browser remembers this name in localStorage and sends
it when joining another room or returning after a reload. Clearing the field
removes the saved name and restores the ID-derived default. If storage is blocked,
the entered name still works in the current session. Names are not read from
operating-system accounts. The list includes the current user and distinguishes music, voice-only,
muted and unjoined voice states. Speaking is shown only when actual WebRTC
`audioLevel` telemetry crosses the activity threshold and the microphone is on.
Missing activity telemetry does not produce a Speaking indicator.

Both clients need the updated presence service to display a combined roster.
An unavailable presence service is reported separately from media errors. Older
music peers remain compatible; the native editor can report an unidentified
music partner from actual transport presence when the roster is unavailable.

## Validation

Run the normal web check/build/unit/e2e commands and native CTest suite. The web
suite covers 320/390 px layouts, real fullscreen, keyboard controls, denied
microphone permission, cancelled capture, browser-ended capture, identity merge,
participant names, source expiry and uninterrupted media recovery.

For a direct native/browser presence integration check, first build the web and
`processor_tests`, then run from the repository root with Node 24 or newer:

```sh
node Tests/run_presence_integration.mjs
```

It starts an isolated local service, registers a browser participant, exercises
the native HTTP client, checks the shared ID, and checks that native departure
preserves the browser source. Ordinary native CTest disables external presence
requests through `SHARE_STREAM_PRESENCE_URL=disabled`.
