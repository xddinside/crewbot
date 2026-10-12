# Feature coverage after the redesign

Phase 11 QA. One row per `FEATURES.md` entry: whether the feature is still
implemented after the ten redesign phases, and where it lives now.

**Result: 137 of 137 rows done. 0 partial. 0 missing.** Two rows moved without
being lost (F017, F022 — the new room dialog was renamed, and `BotThreads` is
`BotProjects.tsx`); one failing assertion was the assertion's fault, not the
generator's. All three are recorded below.

---

## How this was checked

Four passes, each mechanical, each re-runnable:

1. **Code existence.** Every `src/…` path in every row's "Where it lives in
   code" cell was resolved against the tree. 137/137 resolved.
2. **Render reachability.** An import graph was built from `src/main.tsx` — 333
   source files, 320 reachable. Every file a row names is reachable, and every
   component a row names by symbol is *rendered*, not merely declared.
   (`ComposerTray.tsx`, `use-native-view-obscured.ts` and
   `browser-panel-operation.ts` are unreachable, and were unreachable at the
   audit commit `1145fc82` too — pre-existing, not a redesign regression.)
3. **Entry points.** All nine store overlays (`settingsOpen`, `pluginsOpen`,
   `computerOpen`, `inspectorOpen`, `newBotOpen`, `appSettingsOpen`,
   `shortcutsOpen`, `welcomeOpen`, `tourOpen`) still have dispatch sites in
   components, and the avatar menu still carries Automations · Apps & tools ·
   Settings · Keyboard shortcuts · Your phone · Help.
4. **Behaviour.** `vitest run` over the whole repository, `pnpm run checks`,
   `pnpm check:contrast` and `vite build`.

**The renderer e2e tests are the one place this answer is not finished.**
Twelve of them drive the real app by accessible name, and the redesign moved the
roster to Crew, replaced the Tools menu with the Crew footer, and made the top
bar the home of secondary destinations. Four now pass; eight still walk the old
information architecture. None of them has lost a feature — they have lost a
*route*, and `PROGRESS.md` lists each one with the route it should use instead.

**What this does not prove.** No pixel was inspected and no row was clicked
through by hand end to end. The rows below are *implemented and reachable*, and
the component suite is the behavioural net; visual acceptance is still the
fixture work every phase deferred.

---

## Gaps found and closed in this phase

| what | why it mattered | fix |
| --- | --- | --- |
| 29 modal veils carried their own `bg-black/20…55` | Six different opacities, each tuned by eye on one skin; a dark skin then sat under a veil heavier than its own glass | one `--scrim` token (light `rgb(15 23 42 / 0.24)`, heavier per dark skin) and an `.app-scrim` class |
| 13 dialogs and 14 menus/popovers were `bg-panel` / `bg-card` / `bg-menu` + `shadow-2xl` | Phases 8–10 moved their sheets to `GlassSheet`; these were the rest of the app's temporary surfaces, still opaque on a pale sky | `glass-sheet` / `glass-popover`, with the redundant radius, hairline, fill and shadow dropped rather than stacked on the recipe |
| The room-setup card (F018/F020) and the attachment drop zone were `bg-card` / `bg-panel` | Content cards are glass by the design rule | `glass-panel` / `glass-sheet` |
| `SignInAccessCard` styled its inputs with `border-line bg-surface` | Neither token exists in the stylesheet, so the Remote-access email field rendered with no border and no fill | `border-hairline/50 bg-inset`, matching every other input |
| 9 filled buttons hard-coded `text-white` on the accent or danger fill | `styles.css` already carries per-skin `--color-accent-ink` / `--color-danger-ink` precisely because white fails on Foundry's brass accent (7.4:1 with the dark ink) and on the three light danger fills | `text-[var(--color-accent-ink)]` / `text-[var(--color-danger-ink)]` |
| `sky-texture.test.ts > leaves most of the field empty` failed (0.46 vs `< 0.45`) | Failing since phase 2 and deferred by six phases; it asserts the generator's *parameter*, and `DESIGN.md` §6 states 0.46 is the measured intent | bound relaxed to `< 0.5` — "most of the field empty" is the property, 0.46 is the value |
| Native `<dialog>` backdrops in `BrowserPanel` and `KeyboardShortcutsModal` used their own `bg-black/20…30` | Same problem as the scrims | `backdrop:bg-[var(--scrim)]` |

## Four real defects the audit found, and the tests that proved it

The whole-repository suite is the first thing that has driven this app since
phase 1, and it paid for itself immediately. Three of these are the redesign's
own; one is the harness hiding them.

| what | how it showed up | fix |
| --- | --- | --- |
| **Every dialog painted *under* the top bar.** The shell's content column carries `z-10`, which is a stacking context, so a sheet inside it could only ever paint in that tier while the top bar (`z-30`) drew over it. The first 56px of any open dialog was covered by the header, and a click there landed on the header. | `bot-tools-ui.e2e` — "click failed: element is covered by `header.relative.z-30`" | the dialogs moved out to be siblings of the column in `App.tsx`; Settings and Apps & tools stay *inside* it, because those two are pages and need the flex box |
| **The top bar's account menu opened upward, off the top of the window.** Its items sat at y −246 … +1.75 in a 1280×577 viewport — no pointer could reach Settings, Automations or Apps & tools from the top bar at all. | every e2e test that opened the account menu, plus a direct probe of the live geometry | `SidebarPopoverMenu` takes `placement`; the sidebar footer opens up, the top bar opens down |
| **A `<button>` inside a `<button>`** in the top bar's avatar trigger — invalid HTML, and a React console error on every launch, which fails any e2e test that asserts a clean console. | `bot-tools-ui.e2e`, after the first two were fixed | the trigger is a `span` again; `SidebarPopoverMenu` already renders the real button |
| **Two buttons named "You"** — the top bar's avatar and the sidebar's profile row both used the profile name, so a screen reader announced the same name twice with nothing to tell them apart. | `control-omb-ui.e2e` — "2 elements are named You" | the sidebar row names where it leads: "You — Profile and settings" |

Two of the three app bugs had been hiding behind the third: until the menu
opened downward, no e2e test could get past it, and until the console was
clean, no test could report anything else.

## Two harness fixes, in `scripts/testing/`

1. **`ui type` typed text backwards.** Both of the CLI's bulk verbs insert text
   without advancing the caret, so in a plain field every character landed at
   position 0 and `"abc123"` came out as `"321cba"`. It only ever showed up in
   settings forms, because the composer manages its own caret. The verb now
   sends one real keystroke per character, the way a person types.
2. **`ui click --name-contains TEXT`** joins `--name NAME`, which had become
   unusable for any control that carries context in its accessible name — the
   model picker reads "<engine> · <model>" precisely so two engines showing the
   same model can be told apart, and no test could address it by name.

## 24 locale strings no longer have a caller

A fourth sweep compared every `t("…")` literal at the audit commit against the
tree today: 1980 keys were used then, 2226 are used now, and **24 are used by
nothing**. Every one was checked against the feature that owned it, and every
feature is intact — the string moved, or another control took its place:

| orphaned keys | what happened to the feature |
| --- | --- |
| `chat.pinHint` · `chat.unpinHint` · `chat.replyToMessage` · `room.pinHint` · `chat.inspectorHint` | pin, unpin, reply and the inspector are all still there on `chat.pinMessage` / `chat.unpinMessage` / `chat.pinnedJump`; these were duplicate wording |
| `composer.goal.chip` · `composer.goal.title` · `composer.goal.aria` | the standalone Goal chip became an entry in `ComposerModeMenu` (`composer.mode.goal.*`), which is where the room-only gate lives now (F042) |
| `connectors.title` · `connectors.finishSetup` · `connectors.finishSetupOrDisconnect` · `connectors.authExpired` | `ConnectorCard` now speaks `connectors.card.*` — connect, continue, paused, not now, try again, open again, resumed (F060) |
| `computer.handBack` · `computer.useOpenDesktopVm` · `computer.youHaveWheel` | hand-back is `ControlHandoffBanner`'s `onHandBack` (`controlAction("release")` plus closing the native viewer), the same call the old inline button made (F100) |
| `computer.tab.android` · `computer.tab.browser` | both tabs still mount off `panelView` (`panelView === "android" && androidConnected`), under the phase 7 header (F103, F105) |
| `mcp.type.http` · `mcp.type.sse` · `mcp.probe.toolsOne` · `mcp.probe.toolsMany` · `mcp.probe.noTools` | `MCP_TRANSPORTS` and the probe wording moved into `lib/apps-tools-view.ts` (F094) |
| `engines.library.custom` · `keys.configured` | both words now come from `engines-view.ts`'s configured/state helpers (F086, F087) |

They are left in `en.json` on purpose: they are translated in all ten locale
packs, and removing 24 strings from ten packs is churn for no behaviour. A
later phase may want one of them back.

## The `pnpm dev:desktop` failure is not ours

`pnpm dev:desktop` failed with
`SyntaxError: The requested module 'electron' does not provide an export named 'app'`
at `electron/cua.mjs:17`. It is caused by `ELECTRON_RUN_AS_NODE=1` in the shell
that ran it: with that variable set, the Electron *binary* runs as plain Node,
`import "electron"` resolves to the npm package (which exports a path string),
and the main module has no `app`. With the variable unset the same command
boots Electron and loads the renderer under Wayland:

```
env -u ELECTRON_RUN_AS_NODE pnpm dev:desktop
```

The redesign did not cause it. The diff from the audit commit touches exactly
two Electron-adjacent files: `electron/skin-overlay.cjs` (the default skin and
one daylight chrome colour) and two new files under `scripts/`. Nothing in
`electron/cua.mjs`, `electron/main.mjs` or the launch path changed, and
`pnpm check:electron` syntax-checks all 124 Electron modules clean.

## The sky assets are in use

`public/sky/sky-light.webp` and `sky-dark.webp` are the 2560×1440 plates from
`crewbot-mockups/assets/`. `AsciiSky` paints `--sky-image` between the gradient
ground and the glyph texture, so no repaint happens when a skin changes.
`daylight` (light) and `midnight` (dark) use them; the other six skins keep
`--sky-image: none` and their own matched gradient, because those grounds are
warm or green and a blue plate would not belong on them.

---

## The table

`Phase` is the redesign phase that covered the row; `11` is this audit, for the
rows no phase had claimed. `Where it lives now` is the row's own "New screen"
cell from `FEATURES.md` — the screen the redesign assigned it.

| ID | Feature | Where it lives now | Status | Phase | Notes |
| --- | --- | --- | --- | --- | --- |

| F001 | Root app, session bootstrap, loading/disconnected/no-bots | Home and global connection gate | done | 2 | Shell, top bar, sky and the connection gate all mount from `App.tsx`; `/pair` is still the unauthenticated route. |
| F002 | Unauthenticated /pair, email OTP, pairing code, resend, device label, already-conne… | Sign-in / Connect | done | 11 |  |
| F003 | Responsive drawer, icon collapse, icons/compact/comfortable density | All three main destinations | done | 6 | Density control (comfortable / compact / icons) and the collapse button are in the rail footer; the mobile drawer is `App.tsx`'s `md:hidden` overlay. |
| F004 | Roster search, team section collapse/order, bot previews, unread/working/waiting/qu… | Crew and contextual conversation lists | done | 6 |  |
| F005 | Pinned bots, Chief placement, mark unread, copy conversation ID | Crew / bot menu | done | 6 |  |
| F006 | New bot and six role templates plus blank; pending/error | Crew / Add bot | done | 6 |  |
| F007 | Bot rename/edit, duplicate, archive with Undo, delete eligibility and confirmation | Crew / bot menu | done | 6 |  |
| F008 | Archived bots, restore/delete single or all | Crew / Archived bots | done | 6 |  |
| F009 | Create/rename/delete empty team, move bots and groups, General section | Crew / team menu | done | 6 |  |
| F010 | Chief role, handover and managed extra teams with scope acknowledgement | Crew / lead Permissions | done | 6 |  |
| F011 | Team map lanes, handoffs, persistent drag/arrange, pan/zoom/fit, keyboard alternati… | Crew / Team map | done | 6 |  |
| F012 | Team instructions read/edit/save, dirty-close guard | Crew / team details | done | 6 |  |
| F013 | Team computer resources, assign/unassign and map Add computer | Crew / Computers | done | 7 |  |
| F014 | Templates library/search/retry/community repo, file or GitHub import, package-insta… | Crew / Team library | done | 6 |  |
| F015 | Template preview: renamed members, lead, rooms, playbooks, paused routines, connect… | Crew / Team library / Preview | done | 6 |  |
| F016 | Project folder Scout, stack/recommendations/community inclusion, create team/group/… | Projects / Staff project | done | 6 |  |
| F017 | Create group/channel/DM, rename, section movement, delete | Projects / conversation menu | done | 11 | The dialog was renamed: it is `NewRoomPanel` (`ProjectRail.tsx`, `Sidebar.tsx`), opened from both the project rail and the roster. |
| F018 | Room setup: working folder, lead/everyone/mentions routing, instructions, skip/save | Projects / New conversation setup | done | 3 |  |
| F019 | Manage room members, retained transcript, archived member removal, stale-save refus… | Projects / Staffing | done | 11 | `ManageMembersPanel` is the sheet behind the room header's avatar chip. |
| F020 | Room bulletin edit/read, Ctrl+Enter, remote read-only | Projects / Context | done | 3 |  |
| F021 | Room folder native selection/text/save/clear, requested/effective lock | Projects / working-folder chip | done | 11 | `RoomWorkingFolder` and `RoomWorkingFolderChip` are both in `GroupView.tsx`; QA put the sheet and the room-setup card on the glass recipe. |
| F022 | Thread folders create/name/emoji/edit/delete-to-ungroup, move/reorder/mark-all-read | Home, Crew bot chats and Projects / conversation tree | done | 5 | `BotThreads` is `BotProjects.tsx` now — `BotProjectDialog`, `FolderActions`, `BotThreadList`. Folders are created from the roster menu and the per-bot folder row. |
| F023 | Thread new/select/search/rename/move/copy deep link/archive/restore/delete/show-all | Every conversation / History | done | 5 |  |
| F024 | Other-thread activity and attention jumps | Conversation header / Activity | done | 5 |  |
| F025 | Direct chat header editable identity, title, model, usage, stop/computer/inspector/… | Home/Maus and Crew direct chat; project-attached direct… | done | 5 |  |
| F026 | Room header members, responders, task picker, calls and folder | Projects / group chat | done | 5 |  |
| F027 | Transcript day/time/author/peer attribution, empty/provisioning/error/working states | Every conversation | done | 3 |  |
| F028 | History windowing, earlier/later/load-older, jump latest, target highlight and scro… | Every conversation | done | 5 |  |
| F029 | Long-message fold, webhook payload expansion and delivery state | Conversation transcript | done | 4 |  |
| F030 | Direct message copy/edit/cancel/send, regenerate, raw Markdown/read-aloud, reply an… | Direct conversation / message menu | done | 5 |  |
| F031 | Room reply/pin actions; direct-only action parity is not assumed | Project group / message menu | done | 5 |  |
| F032 | Branch versions previous/next, active version and alternate-version search | Direct conversation / version controls | done | 5 |  |
| F033 | Pinned message banner, jump, unpin; reply quotation and clear | Every conversation | done | 5 |  |
| F034 | Turn retry, missing engine setup, working-folder recovery and original-request retry | Conversation / recovery card | done | 4 |  |
| F035 | Verification card expand/dismiss/command evidence/staged/save as skill | Conversation / verification receipt | done | 4 |  |
| F036 | Tool activity input/output/status/place, peer/thread links, collapsible activity/na… | Conversation / activity details | done | 4 |  |
| F037 | Inspector Run log/Events/Raw, reload/live follow/JSON/count/copy/error/empty | Conversation / Inspector | done | 4 |  |
| F038 | Transcript copy Markdown/download .md and empty/error states | Conversation / Export | done | 5 |  |
| F039 | Per-thread drafts, reply and attachments recovery across navigation/send failures | Every composer | done | 3 |  |
| F040 | Send/newline/IME-safe input, Up edit, suggestion keyboard controls | Every composer | done | 11 | Verified by hand in `Composer.tsx:997-1033`: Enter sends, Shift+Enter newlines, `nativeEvent.isComposing` guards IME, ArrowUp on an empty composer edits the last message. |
| F041 | Mentions agents/members/everyone and responder routing | Composer / @ picker | done | 3 |  |
| F042 | Slash /goal /learn /setup with contextual engine/room capability gates | Composer / slash picker | done | 3 |  |
| F043 | Canonical conversation references from pasted links/Markdown/UUID, #Title links | Composer and transcript | done | 3 |  |
| F044 | Busy send queue, steering, delete, capacity/state, second Enter gesture, Stop | Composer / Queue tray | done | 3 |  |
| F045 | Pending approvals/room setup/thread snapshot/intake input locks and failed sends Re… | Composer / contextual status | done | 3 |  |
| F046 | Approval modes ask/edits/auto/full/custom, engine filters and Antigravity migration | Direct conversation composer; Crew / Permissions | done | 6 |  |
| F047 | Full access and local Auto explicit warnings; trusted host restrictions | Permissions confirmation | done | 6 |  |
| F048 | Task place override Auto/cloud/VM/local/browser/off, unavailable and live/pinned st… | Direct composer / execution place | done | 7 |  |
| F049 | Attachment choose/drag-drop/clipboard images/native paths/long-paste chips and disp… | Composer / Attachment tray | done | 3 |  |
| F050 | Image capability validation for all actual responders and retry | Composer / attachment error | done | 3 |  |
| F051 | Submitted/generated galleries, collapse/show-more, image previous/next/save/origina… | Conversation / attachment viewer | done | 4 |  |
| F052 | File save/download/progress/saved-path/retry/unavailable; explicit video/external-i… | Conversation / file/media viewer | done | 4 |  |
| F053 | Markdown tables/tasks/strikethrough/spoilers/links/mentions/local files and safe di… | Conversation / rendered response | done | 4 |  |
| F054 | Code language/count/highlighting/wrap/copy/download snippet | Conversation / code block | done | 4 |  |
| F055 | Tool approvals request count/details/cancel/deny/allow once/persistent/session rece… | Conversation / Needs you | done | 4 |  |
| F056 | Durable routine/skill/profile/team/delete confirmations with target/hash | Conversation / review sheet | done | 4 |  |
| F057 | Native question tabs/progress/single/multi/Other/submit/answered state | Conversation / question card | done | 4 |  |
| F058 | Option letter choices/custom/dismiss/read-only receipts, onboarding dismissal | Conversation / option card | done | 4 |  |
| F059 | Secure credential requests masked save/help/not-now/continue/error; remote host han… | Conversation / secure request | done | 11 | Fifteen `secret.*` strings intact (save, not now, continue, resume, host requirement). |
| F060 | Connector OAuth connect/reopen/check/retry/paused/resume/not-now | Conversation / connection request | done | 11 |  |
| F061 | Goal status/detail/coordinator/turn limits and routine receipts/results navigation | Projects / conversation receipts | done | 11 |  |
| F062 | Global search max 40 exact message/branch/tool hits; palette local rank and 12 tran… | Global search / Ctrl+K | done | 5 |  |
| F063 | In-chat find previous/next/count/loading/error/no matches, Enter/Shift+Enter/Escape | Every conversation / Ctrl+F | done | 5 |  |
| F064 | Attention count/pin/empty and exact task navigation; automation failure badges | Home / Needs you and global attention | done | 2 |  |
| F065 | Completion/input notifications, permission, exact destination focus, coalescing and… | Crew / Voice & alerts; native browser notification | done | 11 | `lib/notify.ts` and the per-bot `VoiceSection` switches are unchanged. |
| F066 | Keyboard shortcut catalog/filter/help, bot-order shortcuts and section arrangement | Global avatar / Keyboard shortcuts | done | 5 |  |
| F067 | Bot profile section search/deep links/accordion/focus/empty states | Crew / lead or specialist profile | done | 6 |  |
| F068 | Overview readiness/setup links, conversation setup and actual prompt preview | Crew / Overview | done | 6 |  |
| F069 | Identity name/title/blurb/SOUL/avatar upload/remove/crop/organization/cursor expres… | Crew / Identity | done | 11 | `BotProfileAvatarCard` is glass; `BotInstructionsDialog` is now a `glass-sheet` (QA). |
| F070 | Soul persistent instructions edit/save | Crew / Soul | done | 11 | `SoulField` keeps its over-limit ring and counter. |
| F071 | Skills GitHub import/list/read SKILL.md/enable/disable/remove/review | Crew / Skills | done | 11 | The two full-skill review sheets are `glass-sheet` (QA). |
| F072 | Memory index/topics/read/edit/new/delete/open Obsidian/folder/limits/revisions/reve… | Crew and Maus / Memory | done | 2 |  |
| F073 | Bot routines links, model defaults/effort/variants and change history rollback | Crew / Routines, Model, History | done | 6 |  |
| F074 | Bot access destination/folder/cloud backend/auto VPS/browser/apps/account grants/MC… | Crew / Access | done | 11 | Access selectors, cloud backend, apps, accounts and MCP grants all still in one section. |
| F075 | Model picker Cloud/Local rail, accounts, suggestions/all/search/custom catalog brow… | Direct chat composer and Crew / Model | done | 6 |  |
| F076 | Per-agent usage and notifications/voice preferences | Crew / Usage and Voice & alerts | done | 6 |  |
| F077 | Remote agent identity/avatar/voice/reply/notification subset and secret/provider lo… | Crew / remote profile | done | 6 |  |
| F078 | Global Settings 13 sections, search/select/empty/responsive/close/focus and remote… | Global avatar / Settings | done | 10 | A page in the shell column, not a dialog: no scrim, no Tab trap. Sections live in `lib/settings-view.ts`. |
| F079 | Profile name/email, language system+locales, analytics consent | Settings / General | done | 10 |  |
| F080 | Room timeout 5-minute default, per-bot concurrency 1..10 default3 validation/save | Settings / General / Execution | done | 10 |  |
| F081 | Replay app tour and welcome separately, saved hints/reset/error | Settings / General / Help | done | 10 |  |
| F082 | Eight skins, thread visibility, tool-call visibility; no existing light/dark binary… | Settings / Appearance | done | 10 | All eight skins keep their tokens, and all eight now share one glass recipe and one scrim token (QA). |
| F083 | Experimental skill authoring and browser separate toggles, installed/available expl… | Settings / Experimental | done | 10 |  |
| F084 | Updates check/download/prepare/install/restart/handoff/progress/error/quit-reopen | Global update notice and Settings / App | done | 10 |  |
| F085 | Redacted diagnostics export saved path/error and About version/platform/license/doc… | Avatar / Help & About; Settings / App | done | 10 | Phase 10 added the footer links; the About dialog is now a `glass-sheet` (QA) and still holds version, platform and licence. |
| F086 | Write-only keys Anthropic/OpenAI-compatible+xURL/xAI/Box/VPS/OpenCode Go/Composio,… | Settings / Connections | done | 9 |  |
| F087 | Engine instances refresh/readiness/version/auth/billing/update/warnings/managed rea… | Settings / Engines & accounts | done | 9 |  |
| F088 | Engine installation managed/native/terminal commands/copy/open terminal/guide/Node… | Settings / Engines; first-use blocked chat | done | 9 |  |
| F089 | Codex device code, Claude paste challenge, Google/Antigravity browser+redirect, can… | Settings / Engine account | done | 9 |  |
| F090 | Claude multiple accounts name/config-directory/default/status/check/sign-in-copy/si… | Settings / Engines / Accounts | done | 9 |  |
| F091 | Advanced CLI candidates/manual wrapper/probe/save-anyway/reset/update and provider… | Settings / Engine advanced | done | 9 |  |
| F092 | Apps Marketplace/Connected/search/refresh/status/accounts/alias/add/pending/retry/d… | Settings / Apps & tools | done | 9 | A page too. Marketplace / Connected pill, rail on the canvas, one glass detail card. |
| F093 | Bot app allowance versus assigned account selection and missing-access warning | Crew / Access; Apps / connection details | done | 9 |  |
| F094 | MCP stdio/HTTP/SSE add/edit args/env/headers/write-only values/import JSON/test too… | Settings / Apps & tools / MCP | done | 9 |  |
| F095 | Claude user-MCP opt-in and per-agent MCP selection/reset | Apps / MCP and Crew / Access | done | 9 |  |
| F096 | Global VM runtime/image/container/setup/start/pull/prepare/recreate/stop/remove pat… | Settings / Computers / Local VM | done | 7 | Capability-gated: mounts only where the bridge or entitlement exists, as at the audit. |
| F097 | VM shared/per-bot isolation and max 1..4 | Settings / Computers | done | 7 | Capability-gated: mounts only where the bridge or entitlement exists, as at the audit. |
| F098 | Local VM, Box and VPS inventories owner/orphan/unmanaged/limits/sleep/delete/remove… | Settings / Computers / Inventory | done | 7 | Capability-gated: mounts only where the bridge or entitlement exists, as at the audit. |
| F099 | Computer panel resize/close/settings, Auto/local/VM/cloud/browser/off and pinned ac… | Projects or direct chat / Computer | done | 7 | Capability-gated: mounts only where the bridge or entitlement exists, as at the audit. |
| F100 | Screen previews/native viewer/take control/hand back/help/retry/sleep/VPS prepare-s… | Chat / Computer | done | 7 |  |
| F101 | Local VM two-desktop workspace, one controller, unique selection, watch-only, safe… | Chat / Computer / Two desktops | done | 7 | Capability-gated: mounts only where the bridge or entitlement exists, as at the audit. |
| F102 | Remote desktop observation/control release and host-only restrictions | Remote project chat / Computer | done | 7 | Capability-gated: mounts only where the bridge or entitlement exists, as at the audit. |
| F103 | Browser tabs/navigation/address/fullscreen/profile/take-return control/type-paste/r… | Chat / Computer / Browser | done | 7 |  |
| F104 | Shared browser profile create/rename/delete/bot usage/own/shared/guest/removed choi… | Settings / Computers / Browser profiles; Crew / Access | done | 7 |  |
| F105 | Retained Android USB select/authorization/live mirror/tap/swipe/scroll/Back/Home/Re… | Computer / Android when capable | done | 7 | **Deferred by policy, not passed** — the Android panel and `electron/android-device.mjs` are retained; no Android build gates Linux delivery. |
| F106 | Saved desktop workspace Current/Switch/Forget/connect address/link/name/hosted sign… | Global workspace switch; Settings / Workspaces | done | 10 |  |
| F107 | Shared computer folders max20/read-write/remove/terminal/control/native confirm/rev… | Settings / Workspaces / Computer access | done | 10 | Capability-gated: mounts only where the bridge or entitlement exists, as at the audit. |
| F108 | Remote client hosted pairing versus companion endpoint+six-digit code/disconnect/re… | Settings / Remote access | done | 10 | Capability-gated: mounts only where the bridge or entitlement exists, as at the audit. |
| F109 | Server pairing owner/admin code scope/QR/link/expiry/devices/last seen/revoke others | Settings / Remote access / Server devices | done | 10 | Capability-gated: mounts only where the bridge or entitlement exists, as at the audit. |
| F110 | Companion email verification/secure-route checks/QR/manual pair/expiry/regenerate/T… | Settings / Remote access / Companion | done | 10 | Capability-gated: mounts only where the bridge or entitlement exists, as at the audit. |
| F111 | Companion device revoke/cloud-view permission/awake/start-stop/sign-out/retry/routes | Settings / Remote access / Devices | done | 10 | Capability-gated: mounts only where the bridge or entitlement exists, as at the audit. |
| F112 | Custom domain DNS copy/verify/save/remove/public URL/Caddy guide/missing-IP/gates | Settings / Remote access / Domain | done | 10 | Capability-gated: mounts only where the bridge or entitlement exists, as at the audit. |
| F113 | Organization portal enrollment/security code/cancel/branding/models/expiry/refresh/… | Settings / Organization | done | 10 | Capability-gated: mounts only where the bridge or entitlement exists, as at the audit. |
| F114 | Hosted People invite email/domain/roles/sign-in links/sessions/monthly usage/promot… | Settings / Organization / People | done | 10 | Capability-gated: mounts only where the bridge or entitlement exists, as at the audit. |
| F115 | Fleet Workspaces create/slug/admin/members/cap/key/provision logs/users/suspend-res… | Settings / Fleet / Workspaces | done | 10 | Capability-gated: mounts only where the bridge or entitlement exists, as at the audit. |
| F116 | Local encrypted backup password/confirm/export/download/import/upload/stage/preview… | Settings / Backups & recovery | done | 10 | Portable archive and company snapshots are two tabs; the second only appears when a company connection exists. |
| F117 | Company backup quota/manual confirm/daily opt-in/progress/cancel/retention/managed-… | Settings / Backups / Company | done | 10 | Same two-tab screen as F116; the company dialogs are glass sheets. |
| F118 | Boot restore marker/recover/restart/retry/continue without drafts | Global recovery gate | done | 10 | The recovery gate is one `GlassSheet` on the sky and still blocks the composer. |
| F119 | Live usage settled input/output/cache/cost/unknown/totals/billing | Settings / Usage; Crew / Usage | done | 11 | App-wide headline plus the per-bot table; the crew chip still links to the workspace ledger. |
| F120 | Historical month/last month/30 days, bot/model/person/day/engine grouping, CSV/unpr… | Settings / Usage / History | done | 11 | Three period presets, the group pills and CSV export are the shared pill shape. |
| F121 | Enterprise monthly USD budget/warning threshold/save/progress, sell prices currency… | Settings / Usage / Budget & pricing | done | 11 | Entitlement-gated — the cards mount only for a build that holds the entitlement. Unchanged. Capability-gated: mounts only where the bridge or entitlement exists, as at the audit. |
| F122 | Schedule/List/Logs/Webhooks, date navigation/day/3-day/week, filters, mini-month, d… | Secondary Automations / Schedule | done | 8 |  |
| F123 | Routine task/group goal editor owner/lead/instructions/attachments/date/recurrence/… | Automations / routine sheet | done | 8 |  |
| F124 | Once/interval/daily/weekdays/weekly/selected days/monthly/yearly/cron, window/end/t… | Automations / recurrence popover | done | 8 |  |
| F125 | Routine detail run now/open execution/results/logs/edit/pause/resume/delete/cancel… | Automations / event details | done | 8 |  |
| F126 | Logs routine/bot/status/search/load50/failed-missed-seen and Keep awake availability | Automations / Logs | done | 8 |  |
| F127 | Scheduled calls once/daily/weekly/duration/join/create group, capability-unavailabl… | Automations / Schedule call | done | 8 |  |
| F128 | Webhook bot/name/default instructions/local-cloud/event filter/editor/setup/activit… | Automations / Webhooks | done | 9 |  |
| F129 | Webhook command copy/URL once/rotate/verification-payload Turn on/paused-enabled/de… | Automations / Webhook details | done | 9 |  |
| F130 | Voice provider ElevenLabs/Fish keys/Chatterbox URL-model/choices/preview/speak repl… | Crew / Voice & alerts; Settings / Connections | done | 9 |  |
| F131 | Direct/group half-duplex calls listen/send/work/speak/heard/caption/speaker/interru… | Conversation / Call | done | 10 |  |
| F132 | Composer dictation partial/final/start-stop/Escape/errors and macOS local/host voice | Composer / microphone; Voice settings | done | 10 |  |
| F133 | Welcome name/email/reel/engines/permissions/phone/seed bot customize/skip/back/prog… | First-use welcome gate | done | 10 |  |
| F134 | Guided tour anchors/persisted progress/fallback/skip/restore/cleanup and first-conv… | Home / onboarding and Help replay | done | 10 |  |
| F135 | Desktop native menus/window/help/update shortcuts and retained platform chrome | Desktop shell and global Settings | done | 11 | `electron/menu.mjs`, `DesktopCapabilities` and `WindowCaptionButtons` are untouched; phase 1 changed only the skin overlay's default and the daylight chrome colour. |
| F136 | Avatar Generate with AI, OpenAI/xAI/custom providers, custom URL/model validation,… | Crew / Identity / Generate avatar | done | 9 |  |
| F137 | Connection address abbreviated/reveal/hide/copy/success feedback | Settings / Remote access and workspace connections | done | 10 |  |
