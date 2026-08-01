# shadcn/ui audit — Room of Devs

_Audited 2026-07-31 against `shadcn` CLI v4.16.1 (`@shadcn` registry, 61 `registry:ui` items)._

**Headline:** the repo vendors **8** shadcn primitives by hand in
`packages/ui/src/primitives/`. **5 are live, 3 are dead.** There is **no
`components.json` anywhere in the repo**, so the shadcn CLI is not wired up —
every primitive was copied in manually and now drifts on its own. **53 of the
61 registry components are unused**, and several of them map 1:1 onto
hand-rolled code we maintain today (three separate hand-built tablists, four
raw `<select>`s, two bespoke toast implementations).

Consumers of `@room/ui`: `panel/` (Tauri desktop), `packages/mobile/`
(phone SPA), `prototype/` (siloed RIG / FIELD UNIT mock app — `/field`,
`/console`, control deck), and `packages/ui/gallery/` (rig showcase, imports
`rig/` only).

---

## 1. Used — vendored shadcn primitives

All live in `packages/ui/src/primitives/`, re-exported from
`packages/ui/src/index.ts`. Radix deps are declared in
`packages/ui/package.json`.

| shadcn component | File | Base | Consumers | Status |
| --- | --- | --- | --- | --- |
| `button` | `packages/ui/src/primitives/button.tsx` | `class-variance-authority` only (no Radix, no `asChild`/Slot) | `prototype/src/field/FieldDock.tsx` | **Live — barely.** Single consumer, in the prototype only. Neither panel nor mobile uses it; both ship raw `<button className="icon-btn">`. |
| `dialog` | `packages/ui/src/primitives/dialog.tsx` | `@radix-ui/react-dialog` | — | **DEAD.** Zero imports. `prototype/src/deck/ControlDeck.tsx` hand-rolls `role="dialog"` instead. |
| `dropdown-menu` | `packages/ui/src/primitives/dropdown-menu.tsx` | `@radix-ui/react-dropdown-menu` | `packages/mobile/src/components/OverflowMenu.tsx` | Live (1 consumer). Sub-menu / radio / checkbox item exports are all unused. |
| `popover` | `packages/ui/src/primitives/popover.tsx` | `@radix-ui/react-popover` | `panel/src/app/ActionCluster.tsx`, `prototype/src/field/GaugesScreen.tsx` | Live (2 consumers). |
| `sheet` | `packages/ui/src/primitives/sheet.tsx` | `@radix-ui/react-dialog` (Dialog re-skinned as a side sheet) | `packages/mobile/src/components/PickerSheet.tsx`, `PlayerSheet.tsx`, `ConvoSheet.tsx` | **Most-used primitive** (3 consumers, all mobile). |
| `sonner` (as `toast`) | `packages/ui/src/primitives/toast.tsx` | `sonner` | — | **DEAD.** Zero imports of `Toaster`/`toast`. Both apps ship their own: `panel/src/app/App.tsx:114` (`function Toast`) and `packages/mobile/src/components/Toast.tsx`. The `sonner` dependency is currently paid for and unused. |
| `toggle-group` | `packages/ui/src/primitives/toggle-group.tsx` | `@radix-ui/react-toggle-group` | `prototype/src/field/ListenScreen.tsx` | Live (1 consumer, prototype only). |
| `tooltip` | `packages/ui/src/primitives/tooltip.tsx` | `@radix-ui/react-tooltip` | — | **DEAD.** Zero imports; the codebase uses native `title=""` attributes everywhere instead. |

**Dead-code total: 3 primitives** (`dialog`, `sonner`/`toast`, `tooltip`) plus
their deps (`@radix-ui/react-dialog` survives via `sheet`;
`@radix-ui/react-tooltip` and `sonner` are otherwise orphaned).

Note: the `Button` word-matches in `panel/src/app/SettingsView.tsx` and
`server-data.ts` are HID `ButtonConfig` types, **not** the primitive — that
file imports nothing from `@room/ui`.

---

## 2. Custom components that wrap shadcn

### Domain leaf components (`packages/ui/src/components/`, `markdown/`)

| Component | File | Built on |
| --- | --- | --- |
| `StateBadge` | `components/StateBadge.tsx` | **Fully custom** (dot + label div, `.state-*` CSS). Registry equivalent: `badge`. |
| `AgentChips` | `components/AgentChips.tsx` | **Fully custom**. Registry equivalent: `badge`. |
| `LiveBadge` | `components/LiveBadge.tsx` | **Fully custom**. Registry equivalent: `badge`. |
| `FailedCountBadge` | `components/FailedCountBadge.tsx` | **Fully custom**. Registry equivalent: `badge`. |
| `QueuedPreview` | `components/QueuedPreview.tsx` | **Fully custom** (truncated blockquote). |
| `GrantButton` | `components/GrantButton.tsx` | **Fully custom** real `<button>` with push-to-talk hold semantics. Does *not* use our own `Button` primitive. |
| `TransportBar` | `components/TransportBar.tsx` | **Fully custom** (icon buttons from `components/icons.tsx`). Registry equivalent: `button-group`. |
| `SummaryText` | `components/SummaryText.tsx` | Wraps our `Markdown` → `react-markdown` + `rehype-sanitize`. No shadcn. |
| `Markdown` | `markdown/Markdown.tsx` | `react-markdown` + `rehype-sanitize` + `remark-breaks`. No shadcn; not a registry concept. |
| `icons` | `components/icons.tsx` | **Fully custom** hand-drawn 24×24 SVGs. Deliberately not Lucide (header comment: "Lucide is reserved for vendored primitives"). |

### RIG industrial primitives (`packages/ui/src/rig/`)

**All 13 are fully custom** — CSS/SVG instrument art with no Radix or shadcn
underneath (only `cn()`): `CutFrame`, `Chassis`, `Bay`, `ScreenBed`, `Tag`,
`Waveform`, `Led`, `Keycap`, `HexLayer`, `Odometer`, `DialGauge`, `CrtFace`,
`SalienceBar`. This is intentional — the RIG look is the product. The nearest
registry analogues are `card` (Chassis/Bay/ScreenBed), `badge` (Tag),
`progress` (SalienceBar), and `chart`'s radial family (DialGauge), and none of
them would survive the restyle. **Leave these alone.**

Prototype extensions (`prototype/src/rig-ext/`: `FieldCard`, `FieldCrtFace`,
`SessionDial`) wrap RIG primitives, not shadcn.

---

## 3. Available but unused — the rest of the registry

53 of 61 `registry:ui` components are unused. Grouped, with a note on whether
each maps onto real hand-rolled code here.

### Layout & surface

| Component | Fit here |
| --- | --- |
| `card` | Overlaps `rig/Chassis.tsx` + `rig/Bay.tsx`; RIG chamfer styling makes it a net loss. Skip. |
| `separator` | Cosmetic; our dividers are single CSS borders. Low value. |
| `scroll-area` | Real candidate: 12 files hand-manage overflow, notably `packages/mobile/src/components/ChatView.tsx`, `panel/src/app/console/ConsoleView.tsx`, `panel/src/app/console/ThreadNode.tsx`. Gives consistent styled scrollbars across panel/mobile. |
| `aspect-ratio` | Avatar frames are fixed-size; no need. |
| `resizable` | No split panes anywhere. |
| `sidebar` | Panel is a fixed two-window layout, not an app shell. No. |
| `skeleton` | We render nothing rather than placeholders during snapshot load. Could improve `RoomGrid.tsx` first paint. |
| `spinner` | No spinner exists today; `Led`/`Waveform` carry busy state. Skip. |
| `empty` | Could replace ad-hoc "no replays yet" / empty-room strings in `packages/mobile/src/components/ReplayHistory.tsx`. Minor. |
| `item` | Generic list row; could tidy `packages/mobile/src/components/PickerSheet.tsx` rows. Minor. |

### Overlays

| Component | Fit here |
| --- | --- |
| `dialog` | **Vendored, dead** (see §1) — but it is exactly what `prototype/src/deck/ControlDeck.tsx` hand-rolls with `role="dialog"` and a manual `keydown` listener. |
| `drawer` (vaul) | Better mobile ergonomic than our `sheet` for `PlayerSheet.tsx` / `ConvoSheet.tsx` (drag-to-dismiss). Would add a dep for polish only. |
| `alert-dialog` | No destructive confirmations exist today (clear queue / stop room happen immediately). Would be a *behavior* addition, not a replacement. |
| `hover-card` | Redundant with the live `popover`. |
| `context-menu` | No right-click menus. |
| `menubar`, `navigation-menu`, `breadcrumb`, `pagination` | No app-chrome navigation of this shape. `prototype/src/field/FieldNav.tsx` is a 5-dot LED rail — not a nav menu. |
| `sonner` | **Vendored, dead** — see the top-5 below. |
| `tooltip` | **Vendored, dead**; would replace the ~dozens of native `title=""` attributes with accessible, styled hints. |

### Forms & input

| Component | Fit here |
| --- | --- |
| `tabs` | **Top opportunity** — three hand-rolled `role="tablist"` implementations (see below). |
| `select` / `native-select` | Four raw `<select>` elements (see below). |
| `slider` | Replaces `type="range"` at `panel/src/app/SettingsView.tsx:275`. |
| `switch` | Replaces `type="checkbox"` toggles in `panel/src/app/SettingsView.tsx:307`, `panel/src/app/PickerView.tsx`, `packages/mobile/src/components/PickerSheet.tsx` — these are semantically switches, not checkboxes. |
| `checkbox` | Only if any of the above are genuinely multi-select; most are not. |
| `input` | Raw `<input>` in `SettingsView.tsx`, `PickerView.tsx`, `PickerSheet.tsx`, `prototype/src/field/FieldDock.tsx`, `prototype/src/console/ReplyDeck.tsx`. Styling-only win. |
| `textarea` | Reply composers: `panel/src/app/console/ReplyDeck.tsx`, `packages/mobile/src/components/Composer.tsx` (both hand-manage autosize). |
| `label`, `field`, `form` | `form` pulls in react-hook-form + zod for what are one-field controls. **Not worth it** — we have no forms, only live-committed settings. |
| `input-group`, `button-group` | `button-group` maps cleanly onto `packages/ui/src/components/TransportBar.tsx` and `panel/src/app/ActionCluster.tsx`. |
| `input-otp`, `calendar`, `radio-group`, `combobox` | No token entry, dates, or radio sets. `combobox` folds into the `command` item below. |
| `toggle` | Single-button variant of the already-vendored `toggle-group`. Add only if a lone toggle appears. |

### Data display

| Component | Fit here |
| --- | --- |
| `badge` | Would unify five bespoke badge components (`StateBadge`, `AgentChips`, `LiveBadge`, `FailedCountBadge`, `rig/Tag`). Tempting, but those carry semantic state colors from `tokens.css`; a `badge` migration is a restyle, not a simplification. Skip. |
| `avatar` | Our avatars are lipsync-driven `<img>` refs (`panel/src/stage/`, `packages/mobile/src/components/Avatar.tsx`) that must **never** re-render through React. `avatar` would fight the stage engine. **Do not adopt.** |
| `table` | Zero `<table>` elements in the repo. |
| `chart` (Recharts) | `prototype/src/plot/LongRangePlot.tsx` (438 lines) and `prototype/src/field/FieldPlot.tsx` (253 lines) are hand-drawn SVG plots. Recharts could replace the math — but the RIG phosphor look is the point, and Recharts fights custom SVG art. **Considered and rejected**, worth revisiting only if plots go generic. |
| `progress` | Overlaps `rig/SalienceBar.tsx`; segmented amber look would be lost. Skip. |
| `carousel` | `prototype/src/field/FieldView.tsx` swipes between 5 field screens — closest real match in this category, but embla is heavy for 5 fixed panes. |
| `accordion` / `collapsible` | `collapsible` replaces three hand-rolled expand/collapse spots: `prototype/src/console/ThreadNode.tsx` (`<details>`), `packages/mobile/src/components/HiddenDevs.tsx` and `panel/src/app/DockView.tsx` (manual `aria-expanded`). Solid runner-up. |
| `alert` | No inline alert banners; errors surface as toasts. |
| `kbd` | `rig/Keycap.tsx` already does this with far more character. Skip. |

### Chat / AI (newer registry additions)

| Component | Fit here |
| --- | --- |
| `message`, `bubble` | Directly overlaps `packages/mobile/src/components/ThreadBubble.tsx` and `panel/src/app/console/ThreadNode.tsx`. Worth *reading* for structure ideas, but our thread nodes carry grant/PTT and CRT-face semantics these don't model. |
| `message-scroller` | Stick-to-bottom logic that `packages/mobile/src/components/ChatView.tsx` and `CallView.tsx` hand-roll. Genuinely useful if the mobile chat scroll ever misbehaves. |
| `attachment` | Matches the backlogged "phone image attachments" feature (`docs/reference/ideas-backlog.md`) — pre-built UI for it. |
| `marker` | Annotation markers; no use case. |

### Misc / infra

| Component | Fit here |
| --- | --- |
| `command` (cmdk) | See top-5. |
| `direction` | RTL provider; not needed. |
| `use-mobile` (hook), `utils` (lib) | We already have `packages/ui/src/lib/cn.ts`; the hook is a viewport-width helper we don't use. |
| `theme-*` (zinc/slate/gray/stone/neutral) | **Do not adopt** — `packages/ui/src/tokens.css` is the declared color authority. |

### Top 5 opportunities

1. **`tabs`** — three independent hand-rolled tablists with manual `role="tab"`
   and no arrow-key roving focus:
   `panel/src/app/PickerView.tsx:397`, `panel/src/app/SettingsView.tsx:558`,
   `packages/mobile/src/components/PickerSheet.tsx:125`. One primitive, three
   deletions, plus keyboard a11y we currently lack.
2. **`sonner` — already vendored and dead.** Wiring the existing
   `packages/ui/src/primitives/toast.tsx` in would delete
   `packages/mobile/src/components/Toast.tsx` (whole file) and the
   `Toast` component in `panel/src/app/App.tsx:114-120`, plus the toast timer
   state in `panel/src/app/view-state.ts:71,111-119`. **Highest
   effort-to-payoff ratio in this audit** — the dependency is already paid for.
3. **`select` (or `native-select`)** — four raw `<select>` elements styled
   ad hoc: `panel/src/app/SettingsView.tsx:217` and `:408`,
   `panel/src/app/PickerView.tsx:446`,
   `packages/mobile/src/components/PickerSheet.tsx:250`. `native-select` is
   the low-risk pick (keeps the OS picker on phone, just styles it).
4. **`command` (cmdk)** — `prototype/src/deck/ControlDeck.tsx` is literally a
   command palette hand-built from a backtick `keydown` listener and a button
   list; `panel/src/app/PickerView.tsx` (505 lines) is a filterable
   agent/model picker. `command` covers both, with fuzzy filtering for free.
5. **`slider`** — `panel/src/app/SettingsView.tsx:275` uses a bare
   `type="range"`; a real slider is better on a floating NSPanel where the
   native range control is awkward to hit.

Runner-up: **`collapsible`** (three hand-rolled expanders, listed above).

**Adoption caveat:** every one of these must be vendored the way the existing
primitives were — take the Radix behavior, drop shadcn's default Tailwind
palette, and restyle against `packages/ui/src/tokens.css`. shadcn's stock look
does not survive contact with the RIG aesthetic, and `tokens.css` stays the
color authority. Never run `shadcn add` with a theme.

---

## 4. Keeping this audit current

The repo has **no `components.json`**, so `shadcn add`, `shadcn diff`, and
`shadcn info` all have nothing to anchor to. Two options:

**A. Stay CLI-less (status quo, lowest risk).** Re-run this audit by hand:

```bash
# what the registry offers (61 ui items; blocks/examples filtered out)
pnpm dlx shadcn@latest search @shadcn -l 200 | grep '(ui)'

# read source/docs for one component without installing it
pnpm dlx shadcn@latest view @shadcn/tabs
pnpm dlx shadcn@latest docs tabs

# what we actually vendor, and who imports it
ls packages/ui/src/primitives/
grep -rn 'from "@room/ui"' --include='*.tsx' panel/src packages/mobile/src prototype/src
```

That last grep is the dead-primitive detector — anything exported from
`packages/ui/src/index.ts` with no hits is a deletion candidate.

**B. Add `packages/ui/components.json`** pointing `ui` at
`packages/ui/src/primitives` with `tailwind.cssVariables` mapped to
`tokens.css`. Unlocks:

```bash
pnpm dlx shadcn@latest add tabs --diff     # upstream drift vs our vendored copy
pnpm dlx shadcn@latest add tabs            # pull a new primitive in
pnpm dlx shadcn@latest info                # config sanity check
```

Worth it if primitive count grows past ~10; the drift check is the real prize,
since nothing today tells us when Radix/shadcn fix a bug in a component we
copied months ago. The risk is `add` overwriting our token restyling — always
run `--diff` first and treat the CLI as a source of patches, not writes.

Either way, re-run when: a new surface ships (the prototype graduating to the
live app is the obvious one), a primitive loses its last consumer, or a Radix
major bumps.

_Note: `shadcn diff` is deprecated — use `add <component> --diff`. The npm
cache in this environment is in a broken state (`EEXIST` on `npx shadcn`); use
`pnpm dlx` as shown above._
