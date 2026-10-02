# OpenMausBot agent notes

Before claiming a server or conversation change works, follow
[`docs/verification/README.md`](docs/verification/README.md). Always launch an
isolated fixture; never verify mutations against the user's live app or data.

More specific `AGENTS.md` files override this note within their directories.

## Product and platform policy

Linux is the only supported platform during current development. Prioritize
dependable daily use, reliable agent turns and recovery, and token/cache
efficiency. Native Android, iOS, macOS, and Windows support is parked; retain
their source and adapters, but their builds and acceptance do not gate Linux
delivery. Revisit Android after dependable Linux daily use, then the other
platforms after public release and demonstrated demand. Resuming support is an
explicit product decision.

Keep the server and shared protocols portable. Put OS-specific behavior behind
desktop/platform adapters; renderer code consumes capability contracts. Use
filesystem/process APIs and argv rather than Linux paths or shell assumptions
in shared code. Preserve existing platform boundaries without building unused
abstractions for future ports.

Linux delivery still requires data and credential continuity, stable/development
isolation, permissions, Stop, and recovery evidence. Retain shared protocol and
security tests used by Linux. Scope Linux claims to documented architecture,
distro, and display-session coverage; preserve existing Wayland safety gates.

When changing CI, releases, support documentation, or task acceptance, apply this
policy consistently to `CONTRIBUTING.md`, verification docs, and issue/PR gates.
Record parked-platform proof as deferred, never passed. Keep legal attribution
and existing recovery data intact.

Run app development servers through `portless`.

Choosing checks, or reproducing a CI failure, starts with
[`CONTRIBUTING.md`](CONTRIBUTING.md#ci-in-one-glance): CI shards the suite four
ways, and the `pre-push` hook already runs lint, typecheck, and the locale
check. `pnpm run checks` runs that battery with bounded output, and
`pnpm ci:wait` waits for CI in one blocking call.

For distributing an implementation or review plan across agents, use
[`parallel-work`](.agents/skills/parallel-work/SKILL.md) to scope tickets,
dependencies, and worker briefs before dispatch.
