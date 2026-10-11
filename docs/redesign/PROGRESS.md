# crewbot redesign — handoff log

One section per phase, newest last. Each says what changed, which files moved,
which `FEATURES.md` rows it covers, what is unfinished or broken, and what the
next agent should know.

Read `DESIGN.md` first. `FEATURES.md` is the preservation contract: nothing in
it may be lost.

Branch `redesign/ascii-sky`. Worktree `/home/xdd/dev/work/crewbot-redesign`.
Never edit the original checkout at `/home/xdd/dev/work/crewbot`.

## Shared rules

- Reuse the primitives phase 1 created: `AsciiSky`, `GlassPanel`, `GlassCard`,
  `GlassPopover`, `GlassSheet`, `AppTopBar`, and the sky/glass tokens. Do not
  add a second background, a second menu recipe or a private hex.
- Present existing data. Atlas / Nova / Sage / Maus is a presentation of the
  bots and teams a user already has. Never rename or overwrite real data.
- Do not rewrite stores, IPC or the server. A layout move may need a small
  wiring change; record it here when it does.
- Before committing: `pnpm run checks` (lint + typecheck + locale) and the
  tests for what you touched.
## Phase 1 — foundation

Branch `redesign/ascii-sky`, worktree `/home/xdd/dev/work/crewbot-redesign`,
from `c87a80d5`.

### What changed

**Docs.** `docs/redesign/DESIGN.md` (tokens, glass recipe, radii, type, motion,
component inventory, sky spec, navigation model, the phase 2–11 screen plan),
`docs/redesign/FEATURES.md` (copied verbatim from the mockup audit),
`docs/redesign/PROGRESS.md` (this file).

**Tokens, wired into the existing skin system — not a parallel one.**

- `--sky-ground`, `--sky-ink`, `--sky-ink-soft`, `--sky-opacity` and the
  `--glass-*` family are declared in **all eight** `[data-skin]` blocks, each
  matched to that skin's own ground (Atelier gets a warm paper sky, Foundry a
  brass night one, Lagoon a glazed one). `src/lib/skins.test.ts` already
  required every skin to carry DEFAULT_SKIN's token set, so adding these to
  Daylight forced the other seven — which is the behaviour we wanted anyway.
- **Daylight** is rewritten as the redesign's default light skin and is now
  `DEFAULT_SKIN`. Its structural change: the user's own bubble is a wash of the
  accent instead of an inversion, so the `@scope` block that re-declared dark
  tokens inside `.bg-bubble-user` is **gone**. Nothing else references it.
- **Midnight** is the dark counterpart: same structure, a darker sky, dark
  glass. Its two upstream contrast gaps are preserved at their baselines.
- `DEFAULT_SKIN` also moved in `electron/skin-overlay.cjs` (the Windows caption
  overlay's unknown-skin fallback) and its `daylight` chrome entry now names
  the new page colour. A test asserts that entry equals the skin's
  `--color-app`, so the two cannot drift.
- `pnpm check:contrast` passes for all eight skins plus the bubble context.

**Sky.** `src/lib/sky-texture.ts` (pure, 11 tests) + `src/components/AsciiSky.tsx`.
Seeded value noise, a glyph table of `. · : - = + *`, and a **measured**
coverage cutoff: the noise is not centred on the midpoint (median ≈ 0.44), so a
cutoff picked on paper lands wherever the distribution falls. Painted once, on
resize (200ms debounce) and on `data-skin` change. No animation loop anywhere.
Cost at 1440×900: 180×65 cells, ~5 400 glyphs, 2.2ms for the texture and
under 15ms for the full paint. Once, not per frame.

**Glass.** `src/components/Glass.tsx` — `GlassPanel`, `GlassCard`,
`GlassPopover`, `GlassSheet`, plus `glassClass()` for menus and portals that
cannot use the component. The recipe is CSS, so a skin retunes all four at once.

**Shell.** `src/App.tsx` now renders the sky, a top bar, and a transparent
column. No frame, no plate. `src/components/Sidebar.tsx` loses `bg-panel` and
its right border and gains a gutter; below `md` it keeps `bg-panel` because
there the drawer covers the conversation and has to be readable against it.
`ChatView` and `GroupView` swap `bg-app` for `glass-panel` so the sky reads
through the largest area on screen.

**Top bar.** `src/components/AppTopBar.tsx` — wordmark, a `radiogroup` pill of
Home · Crew · Projects (arrow keys move between them; one tab stop), search,
`src/components/AttentionBell.tsx`, `src/components/AvatarMenu.tsx`.
`CommandPalette` gained an optional controlled `open`, so the top bar's search
entry and the Ctrl+K chord are one action with one state.

**Routing.** `src/lib/shell-nav.ts` (pure, 8 tests). The destination is
*derived* from `activeView` + what is selected, never stored a second time:

| store state | destination |
| --- | --- |
| `routines` | crew (a secondary destination reached from Crew) |
| `team-map` | crew |
| a selected room | projects |
| a selected bot | home |

A pill click moves the *selection* to something that already exists and leaves
it alone when there is nothing to move to — a user with no rooms clicking
Projects sees their work, not an empty page.

### Secondary destinations — nothing lost

Automations and Apps & tools moved into the avatar menu (they were in the
sidebar's Tools row, which stays). Settings, shortcuts, phone, the update check
and Help all still reachable. Team map is Crew. `Ctrl+K` still opens the
palette. Every panel, dialog and view that mounted before still mounts.

### FEATURES.md rows covered

F001 (root shell, connection gate), F003 (density, drawer, collapse — kept),
F062 (Ctrl+K), F064 (attention), F066 (avatar, shortcuts), F082 (all eight
skins), F085 (Help & About still reachable). The other 130 rows keep their
existing route; nothing was removed.

### Two decisions worth knowing

1. **The composer fade mask is now frosted, not opaque** (`bg-glass-mask`).
   It used an opaque `bg-app` band to hide bubbles tucking under the pill. Over
   a glass conversation that band reads as a slab across the transcript, so the
   mask blurs instead: a bubble under the pill is diffused past legibility
   rather than covered. Same intent, no seam.
2. **Daylight is the default for new installs only.** `readSkin()` still
   returns the stored choice first, so everyone who picked a skin keeps it.

### Open, deferred, or unfinished

- **Phase 1 shows the shell, not the screens.** Home/Crew/Projects are the
  existing views routed into three destinations. The Home landing, the Crew
  roster columns, the real project list and the conversation internals are
  phases 2, 3 and 6.
- **The sky is verified by rendering, not by the app.** I previewed the real
  `buildSkyTexture()` output against the real token values (see §6 of DESIGN.md
  for the numbers). I have **not** run the app against a live server, so the
  shell's behaviour in situ is unverified — phase 11 QA.
- **`scripts/sky-proof-skins.css` is generated** by
  `scripts/build-sky-proof.mjs` and committed so the preview can never drift
  from `styles.css`. Regenerate it if you retune a palette.
- **The six non-default skins got a matched sky but no visual review.** They
  pass contrast and the token-parity test; only Daylight and Midnight have
  been looked at.
- **`electron/skin-overlay.cjs` DEFAULT_SKIN moved to Daylight.** Purely a
  fallback for an unknown skin id, but it is a main-process file and worth
  knowing about.

### For the next agent

- Reuse `AsciiSky`, `Glass*`, `AppTopBar` and the tokens. Do not add a second
  background or a second menu recipe.
- The store was not touched. `activeView` is still `"chat" | "team-map" |
  "routines"`; if a phase needs a fourth view, extend `destinationFor` rather
  than storing a destination.
- `scripts/sky-proof-skins.css` — regenerate, never hand-edit.
- Atlas / Nova / Sage / Maus are a *presentation* of what a user already has.
  Do not rename or overwrite real bots, teams or folders.
