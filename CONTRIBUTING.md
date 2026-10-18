# Development

Use the root repository for all components; invitation fixtures in `Tests/Invitations.json` are shared by C++ and TypeScript tests.

| Path | Component |
| --- | --- |
| `Source/` | JUCE plugin, standalone receiver and streaming protocol |
| `server/` | Python UDP introduction/relay service |
| `web/src/` | React + TypeScript browser client, Radix UI and Heroicons |
| `web/server/` | TypeScript signaling and TURN credentials |
| `web/shared/` | Browser/server protocol types and limits |
| `Tests/`, `web/tests/` | Native, relay and browser tests |
| `scripts/ci/`, `.github/workflows/` | CI, Apple signing, releases and Coolify deployment |

## Web

```sh
bash scripts/web.sh ci
bash scripts/web.sh exec playwright install chromium
bash scripts/web.sh run dev
bash scripts/web.sh run verify
```

Node 24.22.0 is pinned in `web/.node-version`. The wrapper can run it without changing your global Node. Browser tests generate synthetic media; they do not capture your microphone or screen.

## Native

Install Xcode command line tools, CMake 3.22+ and Ninja, then:

```sh
bash scripts/ci/build-native.sh
```

This builds universal arm64/x86_64 plugins and receiver, runs native/relay tests and a VST3 host probe. It does not install plugins or create a distributable archive. Packaging requires the owner's Developer ID; see the root README and [release guide](docs/releases.md).

Keep music transport separate from browser screen and voice. Do not start connections or capture merely because the DAW restores a project. Preserve compatibility with existing invitation links and test cross-language protocol changes against the shared fixtures.

Before publishing, run the checks and inspect the diff for room codes, credentials and generated artifacts. The GitHub CI uses no production or Apple credentials for pull requests. Third-party license requirements are documented in [THIRD_PARTY.md](THIRD_PARTY.md).
