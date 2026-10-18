# Share Stream 0.1.0 — validation, 2026-10-18

## Distribution

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

## Checks completed

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

## Live deployment

`share-stream-relay.service` is enabled and active on **13.140.153.191**, UDP **48100**.
It introduces the public UDP endpoints, then audio uses P2P when reachable. Relay
fallback remains available for incompatible NATs/firewalls. Audio keys remain on clients.

## Limits of these checks

Measured delays exclude physical audio-interface and DAW buffers. A complete live
session between two human-operated DAWs/audio interfaces behind separate consumer
NATs has not been measured. The plugin was host-validated; Logic routing itself was
not automated. Hole punching is IPv4 UDP discovery, not a full ICE implementation.
Failover waits approximately 1.5 seconds for failed direct probes before using relay.
Resampling/clock correction means that decoded output is not guaranteed bit-identical.
