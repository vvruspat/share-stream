# Share Stream 0.2.0 — validation, 2026-10-18

## Browser 0.2.1 hotfix

- User reported local music attenuation and voice glitches at the sending partner,
  using Chrome and an audio interface. Native stream gain is not controlled by voice.
  Browser-requested voice processing is a suspected cause of local OS ducking;
  the user's hardware symptom has not been reproduced automatically.
- Headphones mode now requests echo cancellation, noise suppression and AGC off
  with mandatory false constraints. Voice isolation is also disabled where supported;
  unsupported optional voice-isolation constraints may be retried once, retaining
  all three mandatory raw-audio requirements. Reported processing-on settings are rejected.
- Changing mode closes the previous capture before reacquiring and preserves mute.
  Leaving during a pending permission cannot reactivate the microphone.
- Voice budget is 64 kbps; voice priority is normal (low), screen is medium,
  native music remains the highest intended priority. Voice receiver jitter target
  is 80 ms when supported. Congestion reduces voice to 32 kbps before reducing screen;
  it no longer removes the voice track. Target buffer time is a browser hint.
- Native 0.2.0 bundles and their Apple signing/notarization are unchanged.
- Hotfix validation: ten Node tests passed, including pending-capture cancellation
  and rejection of processing-on capture settings. All four Chromium integrations
  passed locally and through live HTTPS/TURN; the two-way media/reconnect flow also
  passed with TCP-only TURN. Reported sender limit was 64 kbps, voice receive target
  80 ms. Under injected congestion the microphone stayed live and received audio
  bytes continued increasing while its limit dropped to 32 kbps, then recovered.
- Coolify deployed only the web container; `/api/health` reports 0.2.1 and healthy.
  TURN container start time was unchanged, and native music relay remained active.
- Automated microphone tests use synthetic capture. This host's headless browser
  rejected even unconstrained native fake-device getUserMedia as NotSupportedError,
  so those tests cannot establish physical Core Audio ducking behavior.

## 0.2.0 verification

- Universal arm64 + x86_64 build of VST3, AU and output-only receiver completed.
- Native CTest, x86_64/Rosetta core tests, five Python relay tests, and VST3 host
  probe (nine audio configurations, Send passthrough, silent Listen, state restore) passed.
- Standalone 0.2.0 Info.plist has no microphone permission key. Capture remains browser-only.
- Browser service: eight Node tests cover encrypted signaling, participant/stream/sequence
  binding, tamper rejection, room isolation, room capacity, session resumption,
  origin validation, expiring TURN credentials and private asset/security headers.
- Chromium synthetic-media integration verifies separate single-transceiver peer
  connections, voice in both directions, video decoding in both directions, bitrate/
  network priorities, mute, stop, Leave releasing tracks and reconnect without recapture.
- Congestion integration verifies voice pauses before screen bitrate reduces and
  voice resumes after stable measurements. It injects network statistics; it does
  not establish router-level QoS or measure a real congested consumer connection.
- Browser app is deployed by Coolify, project **Share Stream / production / Voice and screen**.
  `web` health reports 0.2.0. HTTPS uses a valid Let's Encrypt certificate.
- Native music relay remains active on UDP 48100; it was not restarted during browser deployment.
- Signed AU validation and the installed signed VST3 host probe passed again for 0.2.0.
- 0.2.0 is signed with the user's Developer ID (Team 3WKK5AGY66), hardened runtime,
  and secure timestamp. Apple notarization **Accepted**, no issues, submission
  `9d57df33-8351-42f7-9d0f-bd7dd65cc9cb`. All three bundles are stapled and validated;
  Gatekeeper accepts the app as **Notarized Developer ID**. See `NOTARIZATION.json`.
- Local Chromium integration: three tests passed, including responsive mobile layout,
  signaling reconnect preserving captures, Leave/rejoin, and TURN credential renewal
  exercising an ICE restart on both independent transports.
- Live HTTPS Chromium integration: all three tests passed with relay-only ICE;
  both selected media paths were confirmed as TURN relay candidates. An additional
  TCP-only TURN run passed the full two-way media / restart / reconnect / rejoin flow;
  both initial selected relay transports were confirmed as TCP. Tests use generated media.

### Scope

Browser media tests use generated tone/canvas content. They validate media transport
and decoding, without capturing the user's real microphone, desktop or DAW. Real
hardware capture permissions and listening with another human still need user testing.
QoS markings and browser caps express best-effort priority; they cannot reserve music
bandwidth on an arbitrary router. Native socket configuration accepts DSCP EF on this
Mac, but an EF-filtered server capture did not see that mark on the internet path.
No guarantee is made that an ISP/router preserves DSCP.

## Previous 0.1.0 audio baseline (historical evidence)

### Distribution

- VST3, AU and a dedicated output-only standalone receiver.
- Universal macOS binaries: arm64 and x86_64, deployment target macOS 12.
- Signed with **Developer ID Application: Aleksandr Kolesov (3WKK5AGY66)**.
- Hardened runtime and Apple secure timestamp enabled. `codesign --verify --deep --strict` passed.
- Apple notarization **Accepted**, with no issues; submission
  `5cfcf858-2e9d-4acd-abb1-d5910e8a194d`, using the existing `SMC-notarize` Keychain profile.
- Tickets stapled and validated on all three bundles. Gatekeeper accepts the app as
  **Notarized Developer ID**. Both ZIPs include the stapled bundles and `NOTARIZATION.json`.
- Standalone has no `NSMicrophoneUsageDescription`, opens zero input channels,
  and exposes only an audio-output selector. The user confirmed that microphone prompts stopped.

### Checks completed

- Core CTest: authenticated encryption, wrong-key rejection, authenticated headers,
  truncation/tampering, authenticated P2P probes and concurrent SPSC stereo ordering.
- Core executable also passed under x86_64/Rosetta.
- Five Python server tests: source-cookie validation, address spoofing rejection,
  sender/receiver routing, role conflicts, room limits, expiry and endpoint introduction.
- Signed AU: `auval -v aufx Ss01 Shst` — **AU VALIDATION SUCCEEDED**.
- Signed VST3 loaded in a JUCE host probe: factory scan, instantiation, audio rendering
  in nine rate/block configurations, transparent Send, silent disconnected Listen,
  and state restoration passed.
- Local P2P, 48 → 48 kHz: synthetic pulse approximately **15.3 ms**, without hardware.
  With a 5 ms minimum buffer, two late frames caused adaptation to approximately 13 ms.
- Local P2P, 44.1 → 96 kHz: all 1999 packets received, no late/lost packets;
  synthetic pulse approximately 28.3 ms, without hardware.
- Two-machine P2P over the internet: native Mac sender and a headless Python/Linux
  receiver using the system libsodium implementation. **6000/6000 authenticated
  audio packets arrived directly**, peer RTT approximately **18.5 ms**.
- Relay-only internet test: 20 s, 7998 sent / 7951 accepted, 40 late frames;
  adaptive network buffer grew from 10 ms to approximately **119 ms**. Steady-section
  silence was below the probe's 1% threshold and stereo energy passed. This network
  path required a larger buffer; low fixed buffers produced audible gaps.
- Receiver drained to silence after the sender stopped. Replaying a previously seen
  frame cannot trigger repeated adaptive-buffer increases.

### Live deployment

`share-stream-relay.service` is enabled and active on **13.140.153.191**, UDP **48100**.
It introduces the public UDP endpoints, then audio uses P2P when reachable. Relay
fallback remains available for incompatible NATs/firewalls. Audio keys remain on clients.

### Limits of these checks

Measured delays exclude physical audio-interface and DAW buffers. A complete live
session between two human-operated DAWs/audio interfaces behind separate consumer
NATs has not been measured. The plugin was host-validated; Logic routing itself was
not automated. Hole punching is IPv4 UDP discovery, not a full ICE implementation.
Failover waits approximately 1.5 seconds for failed direct probes before using relay.
Resampling/clock correction means that decoded output is not guaranteed bit-identical.
