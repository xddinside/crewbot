# crewbot redesign — design system and screen plan

The approved mockups are `crewbot-mockups/codex-v7/01…12-*.png` (feature set)
and `crewbot-mockups/codex-v6/project.png` + `home.png` (visual direction).
`FEATURES.md` in this folder is the feature audit and the preservation
contract: nothing in it may be lost.

This file makes the design principles concrete so the next nine phases build
against the same numbers instead of re-deciding them.

---

## 1. The shape of the thing

The application is a sky. Everything else floats on it.

- **No app window.** No outer frame, no opaque card around the viewport, no
  title strip. The canvas reaches the edges of the window. (Previously
  `Shell` painted `bg-app` on a full-height container with a bordered
  `Sidebar` — that chrome is what phase 1 removes.)
- **Full-bleed ASCII sky.** A pale blue-white field carrying a dotted character
  texture. It reads as atmosphere: soft, horizontal, never legible, never busy.
- **Glass only where work happens.** The conversation surface, the composer,
  compact content cards, popovers and temporary sheets are frosted. Nothing
  else is.
- **Everything else is transparent.** Navigation, headings, lists, the project
  and thread lists, the goal/progress column, section headers — all sit
  directly on the canvas.
- **Conversation dominates.** Staffing, context, goals, tools and settings are
  secondary: chips, popovers, collapsible sheets, `Ctrl+K`.

Restraint follows Linear / T3 Code: one accent blue, small radii, generous
whitespace, 150–200ms motion, joy through small touches (mascot life) rather
than through scale or saturation.

## 2. Colour tokens

### 2.1 Sky ramp (new tokens, `ascii-sky` skin family)

| token | light (`daylight`) | dark (`midnight`) | use |
| --- | --- | --- | --- |
| `--sky-0` | `#f6faff` | `#0a0e16` | page ground under the texture |
| `--sky-1` | `#e6f0fb` | `#101827` | upper sky |
| `--sky-2` | `#d8e8f8` | `#16202f` | horizon band |
| `--sky-ink` | `#7ea8da` | `#2c4363` | cloud cores |
| `--sky-ink-soft` | `#a9c6e6` | `#1d2b3f` | cloud edges |

Contrast rule: `--sky-ink` measures about **2.2:1** against the ground and
`--sky-ink-soft` about **1.5:1**. Both are a texture, not text — nothing in the
app is ever written in either. WCAG asks 4.5:1 of text; the sky is two full
steps under that on purpose, which is what lets it sit behind a label without
competing with it.

### 2.2 Ink

| token | light | dark | contrast on glass |
| --- | --- | --- | --- |
| `--color-ink` | `#0f172a` | `#f4f7fb` | ≥ 14:1 |
| `--color-ink-secondary` | `#51607a` | `#9fb0c8` | ≥ 5.2:1 |

Body copy and labels sit on glass *and* on the canvas. Both are measured in
`pnpm check:contrast`.

### 2.3 Accent

One blue. It is the send button, the active pill, the focus ring, the progress
fill, unread dots.

| token | light | dark |
| --- | --- | --- |
| `--color-accent` | `#2f7ff0` | `#5aa2ff` |
| `--color-accent-border` | `#1f6ad8` | `#7ab6ff` |
| `--color-accent-text` | `#1d5fc0` | `#8ec2ff` |
| `--color-focus` | `#2f7ff0` | `#7ab6ff` |
| `--color-accent-ink` | `#ffffff` | `#06101f` |

### 2.4 Mascot colours

Mascots are triangular cursors. Four roles, four hues — never used for
anything else, so a colour always means an agent.

| role | token | light | dark |
| --- | --- | --- | --- |
| Maus (personal) | `--mascot-maus` | `#8ea2bd` | `#b6c4d6` |
| Atlas (Engineering) | `--mascot-atlas` | `#2fbf87` | `#3ed39a` |
| Nova (Marketing) | `--mascot-nova` | `#f4735f` | `#ff8a76` |
| Sage (Product) | `--mascot-sage` | `#eda22b` | `#f6b44a` |

Existing bots keep their own stored `color`; these four are the *presentation*
default for the named leads. Real data is never renamed or overwritten.

### 2.5 Skin system

The eight existing skins (F082) keep working. Two of them are the redesign's
home ground:

- **`daylight`** — the default light skin. Redesigned in phase 1 to the sky
  palette above.
- **`midnight`** — the default dark skin. Same structure, a darker sky.

Any other skin keeps its own colours and simply gets a sky that matches its
ground, so nothing regresses. `Daylight` becomes `DEFAULT_SKIN`; a user who has
already chosen a skin is untouched because the choice is stored per browser.

## 3. Glass recipe

One recipe, four shapes. Tokens rather than utility soup, so a skin can
re-tune all four at once.

```css
--glass-bg: rgb(255 255 255 / 0.72);
--glass-bg-strong: rgb(255 255 255 / 0.86);   /* popovers, sheets */
--glass-border: rgb(255 255 255 / 0.85);      /* the lit top edge */
--glass-ring: rgb(15 23 42 / 0.07);          /* the hairline underneath */
--glass-blur: 20px;
--glass-shadow: 0 1px 2px rgb(15 23 42 / 0.04), 0 12px 32px rgb(15 23 42 / 0.08);
```

Dark counterpart: `--glass-bg: rgb(18 26 40 / 0.72)`, ring `rgb(255 255 255 /
0.10)`, same blur and the same shadow geometry at lower opacity.

Four shapes, all exported from `src/components/Glass.tsx`:

| primitive | blur | radius | shadow | used by |
| --- | --- | --- | --- | --- |
| `GlassPanel` | 20px | 16 | soft | conversation surface, wide cards |
| `GlassCard` | 14px | 12 | soft | compact cards: needs-you, in-motion, decision rows |
| `GlassPopover` | 24px | 12 | lifted | menus, pickers, thread sheets |
| `GlassSheet` | 28px | 16 | lifted | temporary review sheets, Inspector, add-bot |

All four: hairline border, `backdrop-filter`, `prefers-reduced-motion` safe,
and a visible `--color-focus` ring when anything inside is focused.

## 4. Radii, spacing, type, shadow, motion

**Radii** — `8` control · `12` card/pill · `16` panel/sheet · `999` pill and
avatar. No 4px anything except inline code and badges.

**Spacing** — 4px base. Rhythm `4 · 8 · 12 · 16 · 24 · 32 · 48`. Page gutter
`24px`, panel gutter `16px`, card padding `14–18px`.

**Type** — Inter (already the skin `--font-sans`).

| role | size / line | weight | tracking |
| --- | --- | --- | --- |
| display (Home greeting) | 34 / 40 | 650 | -0.02em |
| title (page) | 22 / 28 | 620 | -0.015em |
| conversation title | 26 / 32 | 640 | -0.02em |
| section heading | 13 / 16 | 600 | 0.02em, uppercase |
| body | 14 / 21 | 400 | 0 |
| message | 15 / 23 | 400 | 0 |
| secondary | 13 / 18 | 400 | 0 |
| meta / time | 11.5 / 15 | 500 | 0.01em |

**Shadow** — three levels only: `none` (canvas), `soft` (glass resting),
`lifted` (glass that is on top of other glass: popovers, sheets, modals).

**Motion**

| token | duration | curve |
| --- | --- | --- |
| `--motion-fast` | 150ms | `cubic-bezier(0.22, 1, 0.36, 1)` |
| `--motion-base` | 180ms | same |
| `--motion-slow` | 200ms | same |

Allowed: opacity, transform (translate ≤ 8px, scale 0.98→1), and one mascot
loop. `prefers-reduced-motion: reduce` collapses every duration to 1ms and
stops the mascot loop — the existing `--animate-*` theme entries are left alone
so onboarding keeps its slower beats for people who want them.

**Focus** — `outline: 2px solid var(--color-focus); outline-offset: 2px` on
every interactive element, everywhere. Never `outline: none` without a
replacement.

## 5. Component inventory (phase 1 creates these)

| file | exports | job |
| --- | --- | --- |
| `src/components/AsciiSky.tsx` | `AsciiSky`, `skyCellPx`, `buildSkyTexture` | full-bleed canvas, painted once per resize, zero per-frame cost |
| `src/components/Glass.tsx` | `GlassPanel`, `GlassCard`, `GlassPopover`, `GlassSheet`, `glassClass` | the four frosted shapes |
| `src/components/AppTopBar.tsx` | `AppTopBar`, `DESTINATIONS` | wordmark · pill nav · search · bell · avatar |
| `src/components/AvatarMenu.tsx` | `AvatarMenu` | profile + app-level items, now also Automations and Apps & tools |
| `src/lib/shell-nav.ts` | `Destination`, `destinationFor`, `isDestinationActive` | pure nav mapping, unit-tested |
| `src/lib/sky-texture.ts` | `buildSkyTexture`, `SKY_GLYPHS` | seeded texture builder, pure and testable |

Supporting edits: `src/styles.css` (sky tokens, glass tokens, `daylight` /
`midnight` reskin, `[data-skin]` sky variants), `src/App.tsx` (new shell),
`src/main.tsx` (default skin), `src/components/Sidebar.tsx` (float on canvas).

## 6. The ASCII sky, concretely

Generated, not hand-drawn, and cheap:

- Cell grid `8 × 14px` (a monospace character box at ~10px).
- Glyph set `".·:-=+*"` — low weight, never words.
- Density from value noise seeded by a fixed constant, so the sky is
  *identical on every machine and every reload*: same texture, no flicker, no
  first-paint surprise.
- Two bands of density, offset, so the texture drifts rather than tiles
  visibly.
- Painted once into an offscreen canvas at grid resolution, then scaled up with
  `imageSmoothingEnabled = false` — cost is O(cells) at resize, never per
  frame.
- The canvas backing store is the **viewport**, not the grid. An earlier
  version stored one pixel per cell and scaled up with `image-rendering:
  pixelated`, which looks like a clever saving and is not: a 10px glyph
  rasterised into one pixel is an antialiased smudge, and magnifying it turns
  the texture into grey mush.
- `coverage: 0.46` and alpha `0.42 → 0.86` are measured, not guessed. Coverage
  is enforced by finding the field's own quantile, because the hash's noise is
  not centred on the midpoint (median ≈ 0.44), so a cutoff picked on paper
  lands wherever the distribution happens to fall.
- Repaints only on `ResizeObserver` (debounced 200ms) and on a `data-skin`
  change (so a dark sky draws its dark ink).
- Cost at 1440×900: 180×65 cells, ~5 400 glyphs, **2.2 ms** for the texture
  and under 15 ms for the full paint including rasterising the glyphs. Once,
  not per frame.
- `prefers-reduced-motion` and `prefers-contrast`: no difference — it is
  static by construction.

## 7. Navigation model

```
TopBar  ─────────────────────────────────────────────────────
  │ wordmark    [ Home | Crew | Projects ]     search · bell · avatar
  ├───────────────────────────────────────────────────────────
  │ left context column (floats, transparent)   central surface
  │   Home    → Maus / selected direct chat     frosted conversation
  │   Crew    → roster, lead columns            + composer
  │   Projects→ conversations & folders
  └───────────────────────────────────────────────────────────
```

- **Home** — the personal conversation with Maus. Selected bot's threads in
  the left column, the chat on the right.
- **Crew** — the roster: Maus, the leads Atlas / Nova / Sage with their
  specialists. Existing bots and teams render here; nothing is renamed.
- **Projects** — group conversations, DMs and bot thread folders.

**Secondary destinations**, reachable from the avatar menu and `Ctrl+K`:
Automations (schedule/list/logs/webhooks), Apps & tools (marketplace, MCP),
Settings, Help.

**Routing rule.** `activeView` stays the store's own `"chat" | "team-map" |
"routines"`. The destination is *derived*, never stored, so nothing is lost:

| store state | destination |
| --- | --- |
| `activeView === "routines"` | automations |
| `activeView === "team-map"` | crew |
| `selectedId` is a group id | projects |
| `selectedId` is a bot id | home |

Selecting a bot from Crew flips to Home; selecting a room flips to Projects.
The three pills are therefore always honest about what is on screen.

## 8. Screen plan

| phase | screen | primary FEATURES.md rows |
| --- | --- | --- |
| 1 | foundation: tokens, sky, glass, top bar, shell, routing | F001, F003, F062, F064, F066, F082, F085 |
| 2 | Home / Maus landing | F001, F064, F072, F122, F134 |
| 3 | Project chat + composer | F018–F023, F039–F050, F055, F075 |
| 4 | decisions, tools, files, Inspector | F029, F034–F038, F051–F058 |
| 5 | history, search, message actions | F023–F028, F030–F033, F062, F063 |
| 6 | Crew + bot profile | F004–F012, F065–F077, F093–F095 |
| 7 | computers / browser / control | F013, F048, F096–F105 |
| 8 | automations / calendar | F122–F129 |
| 9 | apps / MCP / webhooks / engines / models / usage | F086–F095, F128–F130, F136 |
| 10 | settings / workspaces / backups + onboarding, sign-in, pairing, remote access | F002, F078–F085, F106–F118, F131–F135, F137 |
| 11 | QA: contrast, keyboard, reduced motion, feature sweep | all |

## 9. Rules for every phase

1. Reuse `AsciiSky`, `Glass`, `AppTopBar` and the tokens. Do not add a second
   background, a second popover recipe, or a private colour hex.
2. Present existing data. Never rename a bot, a team or a folder to fit the
   mockup. Atlas / Nova / Sage / Maus are a *presentation* of what exists.
3. Keep the store, IPC and server alone unless a layout move strictly
   requires a small wiring change, and say so in `PROGRESS.md` when it does.
4. A feature that exists today must exist tomorrow. If a screen is not built
   yet, the old route to it must still work.
5. Run `pnpm run checks` before committing. Record what you could not verify.