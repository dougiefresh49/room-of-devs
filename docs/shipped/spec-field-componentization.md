# Spec: FIELD prototype componentization (round 4)

_Owner escalation 2026-07-31: the FIELD UNIT screens were hand-rolled
JSX + bespoke CSS across three rounds despite the standing
shared-components rule. This round makes the prototype's field surface
sit on the shared library so it is extensible and can graduate into the
real mobile app. Visuals must NOT change — this is an architecture
port, pixel-stable._

## Ground rules

- Edit only `prototype/src/**` and `prototype/*.config`. Never edit
  `packages/` — `@room/ui` ships to the live panel/mobile. If a shared
  primitive is missing a capability, EXTEND it prototype-side (wrapper
  component in `prototype/src/rig-ext/`) and leave a `// candidate for
  @room/ui/rig` note; do not fork-copy code out of packages.
- No live Gemini/ElevenLabs calls. Mock store only.
- The visual result must match the current screens (the committed state
  at `8899210`). Screenshot-compare before/after.

## What exists in `@room/ui` (already a prototype dependency)

- `@room/ui/rig`: `CutFrame` (the chamfer chassis authority), `Chassis`,
  `Bay`, `ScreenBed`, `Tag`, `Waveform`, `Led`, `Keycap`, `HexLayer`,
  `Odometer`, `DialGauge`, `CrtFace`, `SalienceBar` (+ `rig.css`).
- `@room/ui` components: `StateBadge`, `AgentChips`, `TransportBar`,
  `SummaryText`, `Markdown`, icons.
- `@room/ui` primitives: vendored shadcn/Radix — `button`, `toggle-group`,
  `popover`, `sheet`, `dialog`, `tooltip`, `toast`, `dropdown-menu`
  (+ `tokens.css`, `tailwind.css`, `components.css`).

The desktop console screens (`prototype/src/console/`) already import
`@room/ui/rig` — they are the reference for HOW to consume it.

## The port, per field file

| File | Today | Target |
| --- | --- | --- |
| card shells everywhere (`.fcard`, faceplate, thread, tiles) | bespoke CSS classes from `shape.css` | `CutFrame`/`Chassis`/`Bay` from `@room/ui/rig` (shape.css keeps only what rig.css genuinely lacks; delete duplicated corner rules) |
| `SpendDial.tsx` | fresh hand-rolled SVG dial | wrapper over rig `DialGauge`; if DialGauge can't draw the outer blue session arc, compose it (DialGauge + absolutely-positioned session arc layer) in `rig-ext/SessionDial.tsx` |
| LEDs (route toggle dot, watch chips, grant chip) | bespoke spans | rig `Led` with tones |
| synth light bar on LISTEN | bespoke | rig `Waveform` |
| odometer on GAUGES | bespoke digits markup | rig `Odometer` |
| bottom-row keys (stop/replay/chat/mic, START verb rows) | bespoke buttons | rig `Keycap` (uniform `--fkey-h` height preserved) |
| phone|mac route toggle (LISTEN) | two bespoke buttons | shadcn `toggle-group` (single-select), skinned via existing classes |
| chat/talk `talkgroup` capsule | bespoke | keep the capsule shell, but each segment renders through `Keycap`/shadcn `button` so behavior (focus, disabled, aria) is library-standard |
| composer input + send/close keys | bespoke | shadcn `button` for keys; input stays native but picks up tokens.css vars |
| status tags (WORKING, ALL QUIET, GATED #75) | bespoke chips | rig `Tag` / `StateBadge` where tone semantics fit |
| avatar face wells (dock chip, faceplate) | bespoke divs | rig `CrtFace` sizes |

`AvatarFace` (sprite/lipsync mock) stays prototype-local — it is mock
art, not a library candidate.

## Acceptance

1. `grep -r "from \"@room/ui" prototype/src/field prototype/src/rig-ext`
   shows every field screen consuming the library; no field file defines
   its own dial/LED/keycap/odometer/waveform markup anymore.
2. `pnpm typecheck` clean at root.
3. Before/after screenshots of all five field screens + desktop console
   at 390x844 / 1500px are visually equivalent (minor sub-pixel drift
   fine; layout/shape/color changes are failures).
4. `shape.css` and `field.css` shrink (deleted duplication measured in
   the report); anything still bespoke is listed with a one-line reason.
5. Console screens untouched or only trivially adjusted; no `packages/`
   diffs (`git status packages/` must be empty).
