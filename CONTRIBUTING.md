# Contributing to OpenMausBot

Thanks for wanting to help — community PRs have already shipped in this repo, and more are welcome.
This file covers the Linux development setup, change expectations, and PR evidence. Read it once before opening anything; it's short on purpose.

## Ground rules

- **Small, focused PRs.** One concern per PR. A PR that ports a platform *and* adds a feature *and*
  refactors will be asked to split. Big changes: open an issue first and agree on the approach.
- **Match the altitude.** This codebase is deliberately small and direct — plain Node, no frameworks
  on the server, one store, one event bus. Don't introduce a dependency where thirty lines of code
  will do. New runtime dependencies need a reason in the PR description.
- **Keep it green.** `pnpm typecheck && pnpm test` must pass. Server changes need tests (see below).
- **UI changes need screenshots.** Before/after images in the PR body; video for anything animated.
  Match the existing palette and tone in [`src/styles.css`](src/styles.css).

## Dev setup

Requirements: **Linux x86_64**, **Node 24+**, **pnpm**, and for chatting with a bot, at least one agent CLI
([`claude`](https://claude.com/claude-code) or [`codex`](https://github.com/openai/codex)) installed
and logged in. `pnpm install` installs the project's pinned [Portless](https://github.com/vercel-labs/portless) version.
Linux is the only supported platform during active development. Arch Linux is the daily development target; Ubuntu 24.04 x86_64 is the package and CI reference. Native Android, iOS, macOS, and Windows support is parked. See [platform support](docs/platform-support.md). The harness and shared protocols remain portable.

```sh
git clone https://github.com/xddinside/crewbot.git && cd crewbot
pnpm install

pnpm dev:server    # isolated development harness → 127.0.0.1:18799 in the main checkout
pnpm dev           # Vite through Portless → https://crewbot.localhost
pnpm dev:desktop   # Linux Electron shell; keep server + Vite running

pnpm typecheck     # app + server
pnpm test          # vitest suite (server unit + driver contract + API smoke)
pnpm test:watch    # same, in watch mode
pnpm exec vitest run --shard=1/4   # one CI shard, exactly the files CI ran in it
pnpm check:electron # syntax-check the plain JS Electron entrypoints

pnpm package:linux # Ubuntu x64 .deb + AppImage
```

If this machine has no Portless proxy on its default ports, start one on an
unprivileged port and set that port for each development command:

```sh
pnpm exec portless proxy start --port 1355 --https
PORTLESS_PORT=1355 pnpm dev:server
PORTLESS_PORT=1355 pnpm dev
PORTLESS_PORT=1355 pnpm dev:desktop
```

The desktop launcher follows Portless's selected port in its start URL.

Linked Git worktrees get a branch-prefixed Portless URL and separate development data, profile,
cache, and API ports. For example, branch `feature/search` uses
`https://search.crewbot.localhost`.

Source launches keep their profile, workspace, cache, and service ownership
under development-specific paths. They do not share packaged Crewbot state.

`pnpm dev:desktop` downloads and verifies the pinned Cloudflare Tunnel connector for the current
platform and architecture before Electron starts. Later launches re-verify and reuse the staged
binary. Packaging continues to use `pnpm build:cloudflared`, which stages every architecture the
host's desktop package build requires. To stage only the current development target without
launching Electron, run `node scripts/prepare-cloudflared.mjs --current`.

For Ubuntu installation and real desktop checks, see [`docs/linux-desktop.md`](docs/linux-desktop.md).

## Linux package workflow

The manual `.github/workflows/package-linux.yml` workflow builds Ubuntu 24.04 x86_64 artifacts from an exact revision. Its `crewbot-ubuntu-${version}-x64` artifact contains `crewbot-${version}-amd64.deb`, `crewbot-${version}-x86_64.AppImage`, stable names `crewbot-amd64.deb` and `crewbot.AppImage`, a four-row `SHA256SUMS-ubuntu-x64.txt`, and `latest-linux.yml`. The update feed records versioned artifact names, SHA-512, and sizes. Verify the workflow's checksum report and installed-package evidence before publishing. Linux installed acceptance in [platform support](docs/platform-support.md) remains pending until its continuity, credentials, isolation, rollback, and recovery fixtures pass. Record pending proof as pending.

## Repo map

| Path | What lives there |
|---|---|
| `server/contracts.ts` | The driver SPI and canonical runtime event types. The whole architecture in one file — read it first. |
| `server/drivers/` | One file per provider (Claude, Codex, Grok, cloud computer). Adding a provider = one file + one registration line in `builtIn.ts`. |
| `server/harness/` | Registry (configs → live instances, unknown → shadow) and the fan-in event bus. |
| `server/index.ts` | The HTTP + SSE API the app talks to. |
| `server/testing/` | Test fakes: an in-memory driver, plus scripted fake `claude` / `codex` CLIs. |
| `src/` | The React chat app. No transports of its own — HTTP commands out, one SSE stream in. |
| `electron/` | Desktop shell: dictation, screen capture, local computer-use daemon. macOS-specific code lives here, gated. |
| `dist-server/` | **Build output.** Never hand-edit, never include in PRs — it's regenerated by `pnpm build:server` at release time. |

See the [Linux desktop guide](docs/linux-desktop.md) for Linux data locations and package behavior.

## Tests

The suite is colocated (`server/**/*.test.ts`) and runs with `pnpm test`. Three layers:

- **Unit** — registry, bus, store. Pure in-process, use the fake driver in
  [`server/testing/fake-driver.ts`](server/testing/fake-driver.ts).
- **Driver contract** — [`claude.test.ts`](server/drivers/claude.test.ts) and
  [`codex.test.ts`](server/drivers/codex.test.ts) spawn the scripted fake CLIs in `server/testing/`
  and assert the canonical event stream, argv/env hygiene, interrupts, and the permission broker.
  Failure modes are toggled by env var (`FAKE_CLAUDE_MODE=exit-early`, etc.) — extend those fakes
  rather than mocking `child_process`.
- **API smoke** — [`index.test.ts`](server/index.test.ts) boots the real server against a throwaway
  home directory and exercises the HTTP surface.

House rules for tests:

- **No sleeps.** Wait on the event that proves the behavior (see `server/testing/events.ts`'s
  `recordEvents(...).until(...)`). A test that needs a timeout to pass is wrong.
- **Never touch the real `~/.openmausbot`.** The setup file points `HOME` at a temp dir; keep it
  that way.
- Fake CLI shebang scripts must be launched through `spawnCli`/`execCli`, which resolve them through
  Node on Windows. Only gate a test when the behavior itself is genuinely platform-specific.

## Adding a provider driver

The SPI in [`server/contracts.ts`](server/contracts.ts) is deliberately small. A driver PR should:

1. Add `server/drivers/<name>.ts` implementing `ProviderDriver` and register it in
   [`builtIn.ts`](server/drivers/builtIn.ts).
2. `decodeConfig` **throws** on invalid config; `create` **rejects** (never throws synchronously) on
   failure — the registry downgrades both to an unavailable shadow instead of crashing the fleet.
   Do not remove or work around that behavior; it's what makes configs forward/backward compatible.
3. Emit only canonical `RuntimeEvent`s carrying your own `driverKind` — the bus drops cross-driver
   events on the floor.
4. A missing/broken CLI must surface as `snapshot() → { state: "unavailable", reason }`, and a
   failed spawn as a failed turn — never a hang, never a crash.
5. Bring a contract test following the fake-CLI pattern (scripted fake process + `recordEvents`).

## Agent-facing control CLIs

Before claiming a server or conversation change works, use the isolated flow
in [`docs/verification/README.md`](docs/verification/README.md). For new CLIs
intended for automation:

- Reuse an existing MCP or API operation; keep the CLI to argument parsing and
  result formatting.
- Mutating commands require an explicit target or an isolated launcher. Never
  silently target the user's live app.
- Return JSON for success and failure, use non-zero exit codes for failure, and
  provide `--help`.
- Errors name the failed action and the next valid step.
- Commands that delete or overwrite data provide `--dry-run`; test that it
  leaves state unchanged.
- Prefer task-level subcommands and add one smoke test for the main workflow.

The verification feature map is intentionally incomplete. Add an entry only
when the shared control surface can exercise it and a permanent test proves it.

## MCP tool schemas

Tool `inputSchema`s travel through every engine's own MCP-to-provider conversion before a model
sees them, and those converters are lossy: composition keywords get flattened, dropped, or pruned
by size-compaction passes (codex only began preserving `oneOf` in mid-2026; others simplify
harder). A model that never saw your schema's branches guesses shapes forever — that is exactly
how chat routine proposals failed in the field hours after 0.1.38 shipped (#544).

- **Never use `oneOf`, `anyOf`, `allOf`, `const`, or `format` in a tool `inputSchema`.** Advertise
  one flat object; put per-variant rules in `description`s. `enum` on plain strings is fine.
- **Coerce before you reject.** Models stringify nested objects, shorten enum values, and vary
  case. If an input has one obvious meaning, accept it and normalize on the wire.
- **Errors must teach.** When you refuse an input, the message states the supported shapes with a
  literal example the model can copy. "Invalid discriminator value" burns a turn; an example
  fixes the next call.
- A schema test should assert the tool surface stays flat
  (see `server/drivers/agents-proxy.test.ts` — it regexp-guards the serialized schema).

## Adding a language

The renderer's strings live in JSON catalogs under `src/locales/`. English
(`src/locales/en.json`) is the source of truth (typing still flows from it). A
language is one file plus a one-line registration, exactly like a provider
driver:

1. Copy `src/locales/en.json` to `src/locales/<code>.json`. Filenames use a
   lowercase BCP-47 tag (`de.json`, `pt-br.json`). Translate the values; keys
   you leave out fall back to English, so partial community packs are fine.
2. Register it in `src/locales/index.ts`.
3. Run `pnpm i18n:check`, then select the language in **Settings → General**.

An authenticated local Claude CLI can produce a first draft; it never runs in
CI and its output still needs human review:

```sh
# Uses the locally logged-in Claude CLI
node scripts/generate-locale.mjs it "Italian"
```

The helper runs the model without repository access, custom instructions, or
write-capable tools. It accepts only one complete JSON object and tracks the
English source hash for each reviewed translation. See
[`docs/localization.md`](docs/localization.md) for the workflow and safety rules.

Only a slice of the UI is extracted so far. Move strings into the catalog
with `t("…")` as you touch components — never in big sweeps, which conflict
with everything.

## Platform rules

- The harness (`server/`) must stay portable Node. Anything macOS-only (TCC, Swift helpers,
  `~/Library` paths) belongs in `electron/` behind a `process.platform === "darwin"` gate.
- Renderer code must consume the desktop capability contract rather than infer support from Electron,
  the user agent, or the presence of a preload bridge. Screen preview, dictation, and local control are
  independent capabilities.
- Test Ubuntu platform claims on a real GNOME session. Xvfb proves packaging and fake-driver orchestration, not
  Wayland portal behavior or real CUA inspection/input delivery.
- Linux local control is enabled only on GNOME/Xorg after explicit opt-in. The owned daemon must start with
  `--no-overlay`: the decorative full-screen Cua cursor surface is not part of the product contract and must never
  sit between the person and their desktop. GNOME/Wayland must clear a legacy durable opt-in, report
  `linux-wayland-seat-safety-blocked`, and never start Cua until it independently passes the real-seat matrix in
  #345. Xvfb proves the overlay-free arguments, lifecycle, and input routing; it does not waive real-seat evidence.
  An unrelated app must remain clickable/typeable before any approved action. Global opt-in plus per-bot
  **This computer** remains mandatory; Linux Auto, full-auto/bypass modes, remembered grants, and cloud approvals
  must never authorize the user's desktop.
- Keep CUA discovery shell-free and pin accepted archive, inner-file, manifest, and driver contracts. Packaged Linux
  builds must prefer their reviewed outside-ASAR runtime and fail closed instead of executing ambient PATH code;
  source/dev builds may use the validated explicit/user-local paths. Never add a runtime downloader/self-updater or
  silently install GNOME extensions. GNOME/Wayland readiness must require its exact compositor/helper/portal health
  contract; never infer it from `WAYLAND_DISPLAY` or XWayland.
- Native release changes must update the checked-in Cua license report/SBOM, preserve MIT/OFL/MPL notices, pass the
  malicious-archive tests, and prove identical hashes in `linux-unpacked`, `.deb`, and AppImage artifacts. AppImage
  must additionally prove post-copy hashing in its private `0700` execution stage; never weaken the general path
  validator to accept a root-owned group-writable SquashFS path when its toolchain emits `0775` rather than `0755`.
- **Never build command strings for a shell.** No `shell: true`, no spawning through `cmd.exe` with
  quoted strings — model names, personas, and MCP config JSON travel through argv, and cmd.exe
  metacharacter expansion is a real injection class. On Windows, resolve `.cmd` shims to their JS
  entry and spawn `process.execPath` instead.
- POSIX-only calls (`process.kill(-pid)`, unix sockets) need a gated Windows equivalent
  (`taskkill /T`, named pipes) — not a silent failure.

## Secrets

API keys are write-only: they land in the selected data directory's `config.json` (source development uses `~/.crewbot-development`, with a branch-specific directory in linked worktrees; packaged installs use `~/.crewbot`) via `PUT /api/config`, and the API
only ever reports `configured` booleans. Keep it that way — no logging keys, no echoing them in
responses or events, no baking them into argv where another local process could read them.

## Downstream forks and release ownership

Changes prepared in a downstream fork should keep provenance in the pull request, not add
fork-specific branding or ownership claims to the upstream source tree. Record the exact upstream
commit used as the comparison base, the head branch, and the checks run after the final rebase.

Fork maintainers own the binaries and update channels they publish. Before distributing a fork,
review the application name and identifiers, signing configuration, update metadata, and every
`electron-builder` publish target. Never upload fork artifacts or update metadata to the official
OpenMausBot release repository, and never change the upstream publish target in a feature PR unless
that release migration was explicitly agreed with the maintainer.

An upstream PR should contain only the portable product change. Keep local build paths, account
names, credentials, private endpoints, machine-specific configuration, and fork-only release notes
out of its commits and screenshots.

## Contribution licensing

- No DCO sign-off is required. Submit only code you wrote or have the right
  to contribute under the applicable project license.
- Changes under `enterprise/` (source-available, see [LICENSING.md](LICENSING.md))
  need the [CLA](CLA.md), signed once by commenting on the pull request
  when the bot asks. Changes outside `enterprise/` do not require a CLA.
- `enterprise/`, the cloud seam and the licensing files have code owners; a
  maintainer review is required there.

## CI, in one glance

Normal CI requires Linux jobs and reports one aggregate gate named `Linux CI gate`. The gate depends on static checks, four Ubuntu Vitest shards, packaged-server smoke, Electron smokes, FOSS checks, control-plane checks, UI smoke, and Linux package validation. A failed required job fails the gate. The ARM64 Cloudflare connector installer smoke checks that installer only; it does not establish ARM64 desktop support. Native Android, iOS, macOS, and Windows jobs are manual historical recipes; their proof is deferred and does not gate Linux delivery.

Read [platform support](docs/platform-support.md) for the Linux claims each job can establish and the installed-app acceptance that remains pending. The four shards are `pnpm exec vitest run --shard=1/4` through `4/4`. `pre-push` runs lint, typecheck, and locale checks when installed. `pnpm checks` runs the static battery (typecheck, lint, locale, Electron) as one call, streams each check to a log under `.omb-scratch/checks/`, and prints a bounded summary; add `--json <path>` to keep the record with a revision. For one check, run `pnpm lint`, `pnpm typecheck`, or `pnpm i18n:check`. `pnpm ci:wait [pr...]` waits for pull request checks in one blocking call and prints a check only when its state changes. It takes the repository from the `origin` remote and passes `--repo` on every `gh pr checks` call, because a fork checkout has two remotes and the same pull request number means different things in each; `pnpm ci:wait --repo owner/name` names a different one explicitly. A pass requires a current reading of every requested pull request: the last poll of a pull request decides, and one that could not be read leaves it unknown rather than keeping an earlier pass. `--json <path>` records the repository and one entry per requested pull request, each with a `status` of `pass`, `fail`, `pending` or `unknown`, so a layer the run could not read is recorded rather than dropped. It exits 0 when everything passed, 1 on a failure, 2 if checks were still pending at the timeout, and 3 when `gh` could not reach the pull request, the repository could not be named, or some requested pull request never reported a check state.

Provider fakes under `server/testing/fake-*.ts` must stay dependency-free: they run as bare subprocesses and at least one is copied out of the repo by a test, so a relative import from the repo dies at link time. `server/testing/fakes-self-contained.test.ts` enforces it.

## Before you open the PR

- [ ] `pnpm typecheck` and `pnpm test` pass
- [ ] `pnpm lint` passes
- [ ] Locale changes pass `pnpm i18n:check` and have been reviewed by a speaker
- [ ] `pnpm check:electron` passes for desktop-shell changes
- [ ] Ubuntu packaging changes pass `pnpm package:linux` and `node scripts/verify-linux-package.mjs`
- [ ] New server behavior has a test; driver changes keep the contract tests green
- [ ] No `dist-server/` churn, no lockfile churn beyond your actual dependency change
- [ ] OS-specific code stays behind existing platform adapters; Linux package behavior remains covered
- [ ] UI changes include before/after screenshots

By contributing you agree your contributions are licensed under the
[Apache License, Version 2.0](LICENSE).
