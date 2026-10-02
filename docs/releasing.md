# Releasing crewbot

Releases run only in `xddinside/crewbot`. Run **Actions → Prepare next release** for a version-bump PR. Merging that PR starts **Release** and assembles a draft from the pinned commit. The **Actions → Release** button supports reruns and recovery. Tick **publish** only when the complete Linux release draft is ready; otherwise review and publish it in GitHub's UI. Linux is the supported release platform. The manual `build_parked_platforms` option runs legacy macOS and Windows packaging checks for diagnostic use; that evidence is deferred, those artifacts are excluded from stable publication, and those jobs do not gate Linux release.

The tag is `crewbot-vX.Y.Z`. Linux installers, stable download names, and updater feeds belong to [crewbot releases](https://github.com/xddinside/crewbot/releases). The workflow checks the six supported Linux assets and feed before creating or publishing the draft, then checks the uploaded assets against staged bytes. It does not upload to an upstream or legacy mirror and does not use `RELEASES_PAT`. **Verify published CrewBot release** checks the published Linux assets and feeds; it permits the optional versioned npm tarball attached later.

`app-update.yml` is baked into desktop packages. This fork points at `xddinside/crewbot`; it does not move or update users of upstream or older updater feeds. The npm and Docker workflows are dispatched on the crewbot tag after a workflow-driven publish.

## Why the gates exist

The Linux clean-output, packaged-server, helper-path, browser, feed-hash, and complete-asset gates catch failures that previously shipped or nearly shipped. Codesign, staple, and parked-platform blockmap checks remain in the opt-in legacy packaging jobs. See the comments in `.github/workflows/release.yml` before changing them. See [browser packaging](browser-packaging.md) for browser provenance and Linux sandbox checks.

## Ubuntu package artifact proof

**Package Ubuntu** runs on a clean Ubuntu 24.04 runner. Its handed-over DEB command proof uses a disposable Ubuntu rootfs in a chroot to test dependency resolution and AppArmor profile staging. Separate runner-native browser and installed-package checks remain responsible for proving the live sandbox and package behavior. The script's default Docker mode remains useful for manual command checks on unrestricted Ubuntu hosts; on hosts with restricted unprivileged user namespaces, Docker may correctly fail closed because it cannot load the host AppArmor policy. Do not weaken the package post-install check to make that container case pass.

## Release secrets

Configure secrets in **xddinside/crewbot → Settings → Secrets and variables → Actions**. Normal Linux releases do not require Apple signing credentials. Only a manual release dispatch with `build_parked_platforms` enabled needs `MAC_CERT_P12_BASE64` and `MAC_CERT_PASSWORD` to sign macOS builds, plus `APPLE_API_KEY_P8_BASE64`, `APPLE_API_KEY_ID`, and `APPLE_API_ISSUER_ID` to notarize them. Use fork-owned signing credentials. Do not copy upstream credentials or add an upstream-repository token. The release uses its scoped `GITHUB_TOKEN` to write only to the fork.

**Prepare next release** also needs **Settings → Actions → General → Workflow permissions → Allow GitHub Actions to create and approve pull requests**. It opens a PR; it does not approve or merge it.

When Actions is unavailable, package and verify Linux with the same gates, upload only to `xddinside/crewbot`, and download the published assets to verify their bytes against the feeds. Do not mark parked-platform evidence as passed or publish a partial release.
