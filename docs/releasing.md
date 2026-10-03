# Releasing crewbot

Releases run only in `xddinside/crewbot`. Run **Actions → Prepare next release** for a version-bump PR. Merging that PR starts **Release** and assembles a draft from the pinned commit. The **Actions → Release** button supports reruns and recovery. Tick **publish** only when the complete draft is ready; otherwise review and publish it in GitHub's UI.

The tag is `crewbot-vX.Y.Z`. Desktop installers, stable download names, and updater feeds belong to [crewbot releases](https://github.com/xddinside/crewbot/releases). The workflow checks every installer and feed before creating or publishing the draft, then checks the uploaded assets against staged bytes. It does not upload to an upstream or legacy mirror and does not use `RELEASES_PAT`. **Verify published CrewBot release** checks the published desktop assets and feeds; it permits the optional versioned npm tarball attached later.

`app-update.yml` is baked into desktop packages. This fork points at `xddinside/crewbot`; it does not move or update users of upstream or older updater feeds. The npm and Docker workflows are dispatched on the crewbot tag after a workflow-driven publish.

## Why the gates exist

The clean-output, codesign, packaged-server, helper-path, browser, staple, blockmap, feed-hash, and complete-asset gates catch failures that previously shipped or nearly shipped. See the comments in `.github/workflows/release.yml` before changing them. See [browser packaging](browser-packaging.md) for browser provenance and Linux sandbox checks.

## Release secrets

Configure secrets in **xddinside/crewbot → Settings → Secrets and variables → Actions**. The release workflow requires `MAC_CERT_P12_BASE64` and `MAC_CERT_PASSWORD` to sign macOS builds, plus `APPLE_API_KEY_P8_BASE64`, `APPLE_API_KEY_ID`, and `APPLE_API_ISSUER_ID` to notarize them. Use fork-owned signing credentials. Do not copy upstream credentials or add an upstream-repository token. The release uses its scoped `GITHUB_TOKEN` to write only to the fork.

**Prepare next release** also needs **Settings → Actions → General → Workflow permissions → Allow GitHub Actions to create and approve pull requests**. It opens a PR; it does not approve or merge it.

When Actions is unavailable, package and verify each platform with the same gates, regenerate feeds after stapling, upload only to `xddinside/crewbot`, and download the published assets to verify their bytes against the feeds. Do not publish a partial release.
