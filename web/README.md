# Share Stream web

React 19 + TypeScript + Vite+; the signaling service is TypeScript on Node 24.
Radix UI supplies accessible selects, sliders and tooltips. Heroicons supplies
icons. The shared green/mint palette and control styles live in
`src/components/ui/{tokens,primitives}.css`.

From the repository root:

```sh
bash scripts/web.sh ci
bash scripts/web.sh run dev
# http://localhost:5173 — Vite+ starts the API and WebSocket proxy automatically
bash scripts/web.sh run verify
```

The wrapper uses a compatible installed Node or runs the pinned Node 24.22.0
through npm, without changing the global runtime. With that version already
installed, ordinary `npm` commands in this directory work too. Install the test
browser once with `npx playwright install chromium`.

## Layout

- `src/components/ui/`: reusable Radix controls and design tokens.
- `src/App.tsx`, `src/components/Media.tsx`: room, controls and media playback.
- `src/call/`: typed signaling, encryption, media lifecycle and React subscription.
- `shared/protocol.ts`: client/server wire types, unchanged v1 wire format.
- `server/`: room routing, TURN credentials and static serving.
- `tests/`: Vite+ unit/integration tests and Playwright browser tests.

`npm run check` runs Vite+ formatting, lint and TypeScript checks. `npm run build`
builds the React client and compiles the Node server; `npm start` serves both on
port 48101. `dist/client` contains only public hashed assets; `dist/server` and
`dist/shared` stay private. The Docker image uses a Debian build stage for Vite+
and a small production stage, without compiler/test tooling or source files.

The production deployment stays managed by Coolify. Its existing remote build
directory is `/opt/share-stream/collaboration`; retaining that path preserves
the service and TURN secret mounts after the local rename to `web/`.

## Media invariants

Native music, browser screen and browser voice remain independent transports.
The screen capture never includes audio. Captures require explicit actions;
React renders and effect re-subscriptions never open the microphone. Headphones
mode requires echo cancellation, noise suppression and AGC off. Voice uses
64 kbps normally and 32 kbps under pressure, without detaching the track.
The browser's 80 ms receive jitter-buffer target and priority hints are best
effort, not a network-wide bandwidth reservation.

Browser tests use synthetic oscillator and canvas streams, never the user's
microphone or desktop. They verify actual received audio bytes and decoded
screen frames, mode switching, congestion, reconnect and cleanup. They do not
establish behavior of physical audio hardware or macOS voice processing.
