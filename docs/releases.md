# Releases and deployment

The repository contains the native JUCE plugin/receiver, browser client, signaling server and UDP relay. They share a release version and invitation contract.

Pull requests run lint and tests only. Native CMake product targets are disabled,
browser tests use Vite's development server, and no distributables or Docker
images are built/uploaded. Full artifact builds run after a push/merge to main.
Publication is a separate tagged-release step, also restricted to commits
already merged into main.

## Create a release

1. Update the version in `CMakeLists.txt`, `web/package.json`, the root and `packages[""]` entries of `web/package-lock.json`, `web/shared/protocol.ts`, and `web/compose.yaml`.
2. Update `docs/release-notes.md`. Merge the tested pull request into `main`.
3. Tag that commit and push the tag:

   ```sh
   git tag -a v0.4.4 -m 'Share Stream 0.4.4'
   git push origin v0.4.4
   ```

The **Release** workflow validates the tag against all versions and `origin/main`, tests web/browser/relay behavior, builds the backend and native binaries on macOS, Windows, Ubuntu and Fedora, and smoke-tests the Windows/Linux installers. macOS bundles and Setup are signed and notarized using the owner's existing Developer ID Application identity. Windows Setup is currently unsigned. Linux packages retain apt/rpm ownership and resolve native runtime dependencies.

The macOS job first notarizes/staples the three bundles, then seals them in Setup's signed resources and notarizes/staples Setup separately. After all platforms succeed, the backend deploys through Coolify. Publication uploads a draft with all six downloads, `SHA256SUMS.txt` and `NOTARIZATION.json`, verifies GitHub's asset digests and marks the complete release public/latest. [Native update trust and installation behavior](updates.md).

### Applications first, backend later

The checked-in `scripts/ci/release-plan.json` can defer backend deployment for one
exact version. Version 0.5.0 uses `deploy_backend: false` because the first saved-room
deployment needs an administrator to update the trusted server helper. The tagged
release still tests/builds the backend and every native platform, signs/notarizes
macOS and verifies all published assets. It skips production deployment only for
that explicitly named version. A missing plan or a different version uses the
normal deploy-before-publication process.

The native applications can be installed immediately, but production remains on
0.4.5 until the server update: guest sessions keep the existing two-person behavior;
accounts, saved rooms, larger groups, the new browser UI and account handoff wait
for the backend. This limitation must appear prominently in the release notes.

When administrator access is available:

1. Compare the installed trusted helper with `scripts/ci/coolify-image.php` from
   the release tag. Keep a backup of the previous helper and install the updated
   file at `/usr/local/libexec/share-stream-coolify-image.php`, owned by root and
   not writable by other users. Preserve any existing directory data and key.
2. Validate the helper against the existing Coolify service with
   `SHARE_STREAM_DRY_RUN=1`; it must add `DATA_DIR=/app/data` and the
   `directory-data:/app/data` mount without saving changes or restarting services.
3. Run the backend-only workflow against the published immutable tag:

   ```sh
   gh workflow run release.yml --ref v0.5.0 -f backend_only=true
   ```

   This validates the tag's main ancestry, tests/rebuilds the backend and deploys
   through the existing controller. Native installers are not rebuilt, signed or
   republished. Existing publication recovery remains a separate operation.
4. Confirm `/api/health` reports version 0.5.0 and the exact tagged commit; inspect
   the web container's `/app/data` mount and `DATA_DIR` without dumping secrets.
   Check saved-room persistence, native-to-browser sign-in and a group session.
5. Update the release description and README to remove the deferred-server notice
   only after those production checks succeed.

To retry compilation, signing or deployment failures, use **Re-run failed jobs**. A normal manual dispatch must select the existing `vX.Y.Z` tag as its ref. Published binaries are never overwritten; an identical published release is a successful no-op.

If only publication failed, dispatch **Release** from `main` with `recovery_tag=vX.Y.Z` and `source_run_id` set to the original Release run ID. Recovery verifies that the run belongs to this repository and immutable tag, every build/test/sign/deploy gate succeeded, and production reports the exact tagged revision. It downloads those existing Actions artifacts and finishes the matching draft without rebuilding, signing again or deploying. Every existing asset must match its expected SHA-256 and size; different published or draft assets are rejected. A partial matching draft can receive missing assets. Draft metadata is queried by numeric release ID, since the REST tag endpoint excludes drafts.

## GitHub environments

Both environments accept only `v*` tags. No production credentials are available to pull-request jobs.

| Environment | Kind | Name | Purpose |
| --- | --- | --- | --- |
| `macos-release` | Secret | `APPLE_CERTIFICATE_P12` | Base64 export of the owner's selected Developer ID identity |
| `macos-release` | Secret | `APPLE_CERTIFICATE_PASSWORD` | Password of that P12 export |
| `macos-release` | Secret | `APPLE_NOTARY_CREDENTIALS` | Notarization credentials as JSON, see below |
| `production` | Variable | `DEPLOY_HOST` | Deployment server |
| `production` | Secret | `DEPLOY_SSH_KEY` | Dedicated restricted deployment key |
| `production` | Secret | `DEPLOY_KNOWN_HOSTS` | Pinned server SSH public host key |

Preferred notarization JSON for an App Store Connect API key:

```json
{"key_id":"KEY_ID","issuer":"TEAM_ISSUER_UUID","private_key":"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"}
```

For an individual API key, omit `issuer`. An existing app-specific password is also supported:

```json
{"apple_id":"you@example.com","team_id":"3WKK5AGY66","password":"APP_SPECIFIC_PASSWORD"}
```

Set JSON through GitHub's encrypted environment Secrets interface or `gh secret set APPLE_NOTARY_CREDENTIALS --env macos-release < /private/path/credentials.json`. Never put the JSON or P12 in the repository. The signing step imports only the selected identity into a temporary keychain, requires the owner's certificate fingerprint, submits to Apple, and deletes the temporary files and keychain on exit. No Apple secrets are needed by ordinary CI.

## Server bootstrap and boundaries

An administrator installs `scripts/ci/server-deploy.py` as `/usr/local/libexec/share-stream-ci-deploy.py` and `scripts/ci/coolify-image.php` as `/usr/local/libexec/share-stream-coolify-image.php`, both owned by root and not writable by the deployment artifact. The dedicated public key in root's `authorized_keys` uses:

```text
restrict,command="/usr/bin/python3 /usr/local/libexec/share-stream-ci-deploy.py" ssh-ed25519 PUBLIC_KEY share-stream-github-actions
```

The key cannot open a shell or forward connections. It accepts only `deploy <40-character commit SHA>` and a bounded archive containing exactly `manifest.json`, `image.tar.gz`, and `relay.py`. Checksums, image digest and image revision are verified before deployment.

The controller updates only Coolify service **Share Stream → production → Voice and screen** (`fdigjscz43ygrrmgnxiie5n7`), changing the web image and queueing a web-only recreation through Coolify's deployment queue. TURN, TLS, domains and secret mounts remain managed by the existing service. The native systemd relay is replaced/restarted only when its source changes. No Coolify API token or registry credential is needed.

`/api/health` must report the exact version and commit SHA before deployment succeeds. On failure, the controller queues the previous web image and restores the previous relay source. Deployment is serialized both in GitHub and on the server. Current successful metadata is kept at `/opt/share-stream/ci/deployed.json`.

The initial local-source deployment scripts remain available for administrator recovery; running them switches web back to a source build. For normal releases use the workflow. To roll back, deploy a new release from a revert commit rather than moving an existing tag. Keep recent Docker images until the new release has been verified.

## First deployment with saved rooms

Before deploying the first accounts/rooms release, install the updated trusted
`scripts/ci/coolify-image.php` at `/usr/local/libexec/share-stream-coolify-image.php`
with the existing root ownership. The helper adds `DATA_DIR=/app/data` and the
`directory-data` named volume to the existing service without restarting TURN.
An old helper updates only the image and cannot provide persistent room storage.
Back up the complete data directory, including `rooms.key`, before later updates.
See [accounts and saved rooms](rooms.md) for backup and restore requirements.
