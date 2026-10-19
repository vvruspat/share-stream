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

This builds universal arm64/x86_64 plugins and receiver, runs native/relay tests and a VST3 host probe. It does not install plugins or create a distributable archive. macOS packaging requires the owner's Developer ID; see the root README and [release guide](docs/releases.md).

Keep music transport separate from browser screen and voice. Do not start connections or capture merely because the DAW restores a project. Preserve compatibility with existing invitation links and test cross-language protocol changes against the shared fixtures.

Before publishing, run the checks and inspect the diff for room codes, credentials and generated artifacts. The GitHub CI uses no production or Apple credentials for pull requests. Third-party license requirements are documented in [THIRD_PARTY.md](THIRD_PARTY.md).


For Windows x64, use Visual Studio 2022 C++ tools, CMake, Python and Inno Setup 6, then run `./scripts/ci/build-windows.ps1` in PowerShell. The script builds/tests the VST3 and receiver and smoke-tests Setup and uninstall. The C++ runtime is linked statically.

For Ubuntu 24.04 or Fedora 44, install the dependencies listed in `.github/workflows/native-platforms.yml`, then run `bash scripts/ci/build-linux.sh deb` or `bash scripts/ci/build-linux.sh rpm`. Use an x86_64 machine/container matching the target distro. CI also installs the resulting package, probes the installed VST3 and removes it. GUI tests use a private Xvfb display and synthetic audio.

Updater tests cover stable-version selection, repository/tag/asset trust, missing hashes, archive traversal, staging failures, whole-install rollback and retained backups. On macOS, `build/update_tests /absolute/path/to/payload.zip` additionally verifies installation of the actual owner-signed bundles into a temporary directory, including executable permissions. It does not change the user’s installed applications.

After publishing, build `update_probe` explicitly and run it to exercise the production updater against the actual public GitHub Release. It models an older installed version, downloads the platform installer and validates its hash/signature, but never launches the installer or changes installed applications. This network acceptance probe is excluded from the default build and deterministic test suites.
