# Releases and deployment

The repository contains the native JUCE plugin/receiver, browser client, signaling server and UDP relay. They share a release version and invitation contract.

## Create a release

1. Update the version in `CMakeLists.txt`, `web/package.json`, the root and `packages[""]` entries of `web/package-lock.json`, `web/shared/protocol.ts`, and `web/compose.yaml`.
2. Update `docs/release-notes.md`. Push the tested commit to `main`.
3. Tag that commit and push the tag:

   ```sh
   git tag -a v0.3.1 -m 'Share Stream 0.3.1'
   git push origin v0.3.1
   ```

The **Release** workflow validates the tag against all versions and `origin/main`, runs the web/browser/relay tests, builds the Linux backend image and macOS universal binaries, signs and notarizes the native bundles, deploys the backend through Coolify, then publishes the two ZIPs with checksums and Apple's notarization report. A failed prerequisite prevents publication. It never publishes unsigned fallback archives.

To retry a failed workflow, use **Re-run failed jobs**. A manual dispatch must select the existing `vX.Y.Z` tag as its ref. Published releases are immutable from the workflow: it refuses to replace their binaries.

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
