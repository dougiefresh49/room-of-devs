# Build spec — RIG prototype P1: the metal shop

_2026-07-30. Phase 1 of [design-ui-target.md](design-ui-target.md) §9.
Owner signed off on the target 2026-07-30. This spec is the delegate's
work order; the target §2 is the design authority and
`docs/active/concepts-round-c-v6/board-rig-refined.html` is the
reference implementation — port its CSS values, don't reinvent them._

## Scope

Pure UI-layer work, zero daemon/wire changes, zero risk to mobile:

1. RIG tokens into `packages/ui/src/tokens.css` — **as new tokens
   alongside the existing set** (see Token strategy).
2. Corner-grammar + instrument primitives in `packages/ui`
   (new `src/rig/` component dir + `src/rig.css`).
3. A dev-only gallery page in `packages/ui` proving every primitive in
   every state.
4. The panel **dock strip reskinned** in RIG language (first live
   surface).

NOT in scope: the main-window console (P2), any snapshot/schema change,
any restyle of mobile, theme switching, removing existing tokens.

## Token strategy (decided — don't relitigate)

P1 **adds** the RIG vocabulary; it does NOT change the values of the
existing `--room-*` / `--state-*` semantic tokens (that flip happens in
P2 when the console adopts, so the panel never half-re-tints and mobile
stays untouched until P6).

Add to `tokens.css`, values ported from the board's `:root`:

- Palette: `--ink`, `--gun1`, `--gun2`, `--gun-edge`, `--steel`,
  `--steel-dim`, `--amber`, `--amber-hot`, `--amber-dim`,
  `--amber-ghost`, `--screen`, `--screen2`, `--green`, `--green-dim`,
  `--red`, `--haz` (prefix all as `--rig-*` to avoid collisions, e.g.
  `--rig-amber`; rig.css may alias short names locally inside `.rig`
  scoped rules).
- Corner grammar: `--rig-cut-l: 20px`, `--rig-cut-m: 12px`,
  `--rig-cut-s: 7px`.
- Hex tiles: `--rig-hex`, `--rig-hex-dim`, `--rig-hex-faint` (the three
  inline-SVG data-URI tiles from the board, stroke opacities .5/.13/.045).
- Type: `--rig-mono`, `--rig-stencil` (font stacks from the board).
- Glows: `--rig-glow-hot: rgba(255,150,30,…)` and
  `--rig-glow-amber: rgba(255,179,71,…)` base colors.

Tailwind: add matching `@theme inline` color entries
(`--color-rig-amber` etc.) in `packages/ui/src/tailwind.css` so
utilities exist for P2; P1 components may use plain CSS classes in
`rig.css` (closer to the board's reference CSS — preferred).

## Primitives (packages/ui/src/rig/)

All props-in/callbacks-out, no fetch/WS/Tauri/audio, React 19,
TypeScript. Every component gets JSDoc with the board section it
mirrors. Export from `packages/ui/src/rig/index.ts` (and package
exports map).

- **`CutFrame`** — THE corner-grammar wrapper: props
  `scale: "l"|"m"|"s"`, optional `glow` (drop-shadow color/size).
  Renders the unclipped wrapper div (owns `filter: drop-shadow(...)`)
  around the clipped child (owns `clip-path` chamfer + asymmetric
  `border-radius` per target §2.3). Everything below composes it.
- **`Chassis`** — gunmetal panel (gradient `--gun1→--gun2`, edge
  border, inset highlights) on CutFrame scale-m; optional `screws`
  (corner rivets; BR screw offset clears the chamfer).
- **`Bay`** — Chassis with a bay label strip (stencil type, tracked
  uppercase, left label + right meta slot).
- **`ScreenBed`** — amber CRT bed (screen gradient, scale-s grammar);
  props: `hex?: boolean` (faint hex backdrop layer),
  `scanlines?: boolean`, `sweep?: boolean` (7s sweep, ambience only).
- **`Tag`** — chamfered mini tag; `tone: "amber"|"red"|"green"|"dim"`.
- **`Led`** — status dot; `tone`, `pulse?: boolean` (+ speed variants
  per board: 2.2s default, .5s hot).
- **`Keycap`** — machined option key: `glyph`, `label`,
  `hint?` (right-aligned spoken phrase), `armed?: boolean` (amber
  border + needglow pulse), `onPress`. 22px key face, board gradients.
- **`HexLayer`** — absolutely-positioned hex texture:
  `intensity: "bright"|"dim"|"faint"`, optional banded mask + 9s
  shieldshift drift (bright only).
- **`Odometer`** — mechanical drum readout: `value: number`,
  `digits?: number`; last digit rolls via `steps(10)` keyframe; amber
  or steel digit variants.
- **`DialGauge`** — half-moon SVG gauge (viewBox 0 0 132 76, pathLength
  100 arc trick): `fraction: 0–1`, `redlineFrom?: 0–1`, `needle` angle
  derived from fraction, `caption` lines. Port arc/track/needle values
  from the board.
- **`CrtFace`** — amber-CRT avatar housing: `size` (26|52|58|104|158|176),
  child is the consumer's own `<img>` (accept `children`, NOT a `src`
  prop) so the panel's stage engine keeps mutating its own img ref —
  frame-flipping never goes through React. Applies the screen-bed
  backdrop + sepia/hue-rotate amber grade + optional scanline overlay
  and halo (`halo?: boolean`, 3.4s facehalo pulse).
- **`SalienceBar`** — the dock's LED bar: `segments?: number` (16),
  `lit: number`, `threshold: number` (red notch segment), dim unlit
  cells (`#3d3325`).

All motion honors `prefers-reduced-motion` (kill everything except
static states). Keep `rig.css` class-based and close to the board's
CSS; class prefix `rig-`.

## Gallery (dev-only)

`packages/ui/gallery/` — `index.html` + `main.tsx`, launched with a
`dev` script (`vite` root at gallery/). Dark ink page, one section per
primitive, EVERY state variant labeled (CutFrame×3 scales, Keycap
armed/idle, ScreenBed with/without hex/scanlines, DialGauge with
redline, CrtFace all sizes with a placeholder avatar img from
`panel/public/avatars/` copied into gallery assets or any local img,
Odometer rolling, SalienceBar with threshold, Led tones/pulses,
HexLayer intensities). Never shipped: not referenced by panel or
mobile builds; add a README line in the folder.

## Dock strip reskin (panel)

`panel/src/app/DockView.tsx` + the dock bucket in `panel/src/style.css`.
Restyle to the board's §"dock strip": gunmetal ruler — 52px CrtFace
(Mikey/current speaker), SalienceBar with red threshold notch,
one-line ticker, three Leds (red = any `hand_raised`, amber = any
`working`, green = all idle/settled).

- Interim salience (client-local, until P3's daemon field): compute
  `% clear` in DockView from agent states only — min over agents of
  {hand_raised: 20, speaking: 55, working: 70, idle: 100} — and light
  `round(segments × clear/100)`; threshold notch at a local constant
  35. Mark with a `// P3: replace with snapshot.salience` comment.
- Ticker content from existing snapshot facts only: per-agent
  `label/name + state` and `queuedPreview` when present; CSS marquee
  (22s), `prefers-reduced-motion` → static truncated line.
- HARD constraints: do NOT touch `panel/src/lib.rs`, window/pill
  geometry logic, `usePttGrant`, `grant-guard`, or `AvatarImg`'s ref
  registration (wrap it with CrtFace via children). Do not break
  dockCaptions. Behavior identical; paint only.
- Delete replaced dock CSS rules from `style.css` (promote-and-replace,
  never keep dead buckets).

## Verification gate (delegate runs all)

- `pnpm typecheck` clean at root.
- `pnpm --filter @room/ui dev` gallery renders (delegate: verify it
  builds; screenshots happen in the main session's verify round).
- Panel: `cd panel && pnpm exec tsc --noEmit` clean. Do not run
  `tauri build` (main session handles install/verify).
- No live Gemini/ElevenLabs calls — this task has zero reason to touch
  them. No files under `~/.cursor/tts/` touched.
- `pnpm check-fixtures` still green (nothing here should touch
  protocol; run to prove it).

## References

- `docs/active/design-ui-target.md` §2 (visual system), §3 (dock),
  §10 (house rules).
- `docs/active/concepts-round-c-v6/board-rig-refined.html` — the CSS
  source of truth. Port values; cite the board class you ported in a
  brief comment where non-obvious (e.g. clip-path polygons).
- `packages/ui/src/tokens.css`, `tailwind.css` — existing structure.
- `panel/src/app/DockView.tsx`, `panel/src/style.css` (dock bucket).
