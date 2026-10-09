# Development stack

Run `pnpm dev:all` for the source server, Portless/Vite renderer, and Electron.
Ctrl-C, SIGTERM, SIGHUP, or any child exit stops the stack's owned process groups.
After three seconds the supervisor sends SIGKILL to remaining group members,
including descendants whose pnpm wrapper has already exited. It keeps the shared
Portless proxy running. Closing Electron ends the stack. Linux is the supported
platform; native lifecycle proof on other platforms remains deferred.

## Paths and boundaries

In the main checkout the launcher chooses these before its child starts:

- Harness data, threads, rooms, settings, and saved workspace API keys:
  `~/.crewbot-development`, through `CREWBOT_DATA_DIR`.
- Electron profile, encrypted desktop credentials, browser session, and
  single-instance lock: `~/.config/crewbot-development`, through
  `CREWBOT_DEV_PROFILE_DIR`. The early safeStorage name is `crewbot-development`.
- XDG cache: `~/.cache/crewbot-development`.
- Harness API/webhook ports: `18799` / `18800`, compared with stable `8799` / `8800`.
- Renderer URL: the pinned Portless CLI's `get crewbot` result. Electron follows
  the proxy's protocol, port, and worktree hostname, including existing HTTP
  proxies. Vite receives its UI port from Portless and proxies to the selected
  development harness port.

Linked worktrees retain their branch-specific paths and ports. Dedicated
`CREWBOT_DEV_DATA_DIR`, `CREWBOT_DEV_PROFILE_DIR`, `CREWBOT_DEV_CACHE_DIR`,
`CREWBOT_DEV_PORT`, and `CREWBOT_DEV_WEBHOOK_PORT` overrides support fixtures.
`CREWBOT_DEV_START_URL` is an explicit URL override; use it only when it matches
that fixture's Portless route. Stable/legacy profile and data overrides do not
select the source profile or workspace.

Source launches disable service install/uninstall/rollback through the CLI's
existing development guard. Protocol registration and updater initialization
remain restricted to packaged Electron. This launcher never installs a package,
registers a protocol, resets a workspace, or removes persistent data. Delete only
an explicitly owned development fixture after its children stop.

The normal launcher still inherits HOME, XDG config/data roots, CLI login roots
such as `.claude` and `.codex`, and exported provider credentials. Do not treat
it as complete engine credential isolation. Do not copy or symlink stable
credentials into development. For verification use a disposable HOME and a
whitelisted environment with no provider secrets; log in deliberately to that
fixture only if a credential-specific check requires it. Complete independent
engine login state and installed Linux Secret Service evidence remain in #17.

## Automated checks

```sh
node --test scripts/run-development.node-test.mjs scripts/run-development-stack.node-test.mjs
pnpm exec vitest run server/service-cli.test.ts server/service-unit.test.ts server/service-recovery.test.ts
pnpm lint
pnpm typecheck
pnpm test:electron
```

The guard launches the real development environment adapter, imports the server's
actual data selection and Electron's profile resolver, and writes synthetic state
in a disposable home. It checks exact development directories, independent of
filename case, then deletes the development roots and verifies stable sentinels.
Removing either explicit data or profile selection fails the guard. Synthetic
credentials prove file separation only, not native credential-store access.

The lifecycle fixtures use owned child/grandchild processes, including children
that ignore graceful signals, a crashing or successfully exiting child, and a
missing executable. They verify bounded shutdown and no running descendants.

## Real launch smoke

Following the [verification rules](README.md), create a disposable home, data,
profile, cache, and Portless state directory. Start an owned Portless proxy with
`pnpm exec portless proxy start --foreground --port PORT --no-tls --skip-trust`
and `PORTLESS_SYNC_HOSTS=0`. Choose unused API and webhook ports. Launch
`pnpm dev:all` with the fixture roots/ports above, disposable HOME and
XDG_CONFIG_HOME, and only PATH plus the necessary display-session variables.
Do not inherit provider keys or login-root overrides. Use
`pnpm control:omb doctor --url http://127.0.0.1:API_PORT` against that exact fixture.

Once server, renderer, and Electron are running, send Ctrl-C to the foreground
launcher. Record the owned descendant PIDs, verify no running descendants or
listening API/webhook ports remain, and stop only the fixture's proxy. Remove
only that fixture's app data; keep logs. If a stable AppImage is already running,
compare its checksum/file metadata and process start identities before/after
without invoking its API or reading its credentials.

Renderer HMR is Vite's existing fast path and needs no package build. Server
source edits still require stopping and relaunching this stack. Automatic server
restart, measured renderer/server latency, and interrupted-turn reconnection
without replay remain unproven here. Simultaneous installed stable/development
state and credential continuity, development upgrade/reset/delete, and native
Linux protocol/updater isolation retain their real-package gates. Neither these
synthetic tests nor a launch smoke closes those acceptance criteria. #17 stays
open; parked Android/iOS/macOS/Windows proof is deferred, never passed.
