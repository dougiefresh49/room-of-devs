# Report: FIELD prototype componentization (round 4)

_Implementation of `docs/active/spec-field-componentization.md`.
No commit. `packages/`, `tts-server/`, `panel/` untouched. No live API calls.
`pnpm typecheck` clean at repo root._

## Verdict

Field screens now sit on `@room/ui/rig` + shadcn primitives (via `@room/ui`),
with prototype-side extensions in `prototype/src/rig-ext/` where the library
lacks a capability. Console screens untouched. Visual intent is pixel-stable;
one intentional geometry shift is noted under SessionDial.

## Per-file changes

### New — `prototype/src/rig-ext/`

| File | Role |
| --- | --- |
| `SessionDial.tsx` | Composes rig `DialGauge` + absolutely-positioned blue session arc. `// candidate for @room/ui/rig` (`sessionFraction` on DialGauge). |
| `FieldCrtFace.tsx` | Wraps `CrtFace` for field well sizes `40` / `148` (not in `CrtFaceSize`). `// candidate for @room/ui/rig` (extend size union). |
| `FieldCard.tsx` | Thin `CutFrame scale="s"` + `.fcard` fill for VT / exchange cards. |

### Deleted

| File | Why |
| --- | --- |
| `prototype/src/field/SpendDial.tsx` | Replaced by `rig-ext/SessionDial.tsx`. |

### Field screens / chrome

| File | What changed |
| --- | --- |
| `GaugesScreen.tsx` | `SessionDial`; `Odometer`; guard tiles + spendfoot via `CutFrame`. |
| `GlanceScreen.tsx` | `SalienceBar`; `Tag`; `FieldCrtFace`; plot bay via `CutFrame scale="m"`. |
| `AnswerScreen.tsx` | `Tag`; `Keycap` (held options); `Led` (grant); `FieldCard` / `FieldCrtFace`. |
| `ListenScreen.tsx` | `Waveform`; `Led`; shadcn `ToggleGroup` (phone\|mac); `CutFrame` for lcol/lface; `FieldCrtFace` (148). |
| `StartScreen.tsx` | `FieldCard`; `FieldCrtFace`; `Tag`; `Led` on verb rows. |
| `FieldDock.tsx` | shadcn `Button` for stop/replay/chat/close/send; rig `CrtFace` (52) for dock chip; talkgroup capsule kept. |
| `FieldView.tsx` | Status-bar LEDs → rig `Led`. |
| `FieldNav.tsx` | Tab badge dots → rig `Led`. |

### Untouched (still bespoke — see below)

- `FieldPlot.tsx` — SVG long-range plot (mock art / layout, not a rig instrument).
- `PttPill.tsx` — hold-to-talk / handoff pill (behavior + chrome unique to field).
- Console (`prototype/src/console/**`) — no edits.

### CSS

| File | Before | After | Δ |
| --- | --- | --- | --- |
| `prototype/src/styles/shape.css` | 149 | 146 | **−3** |
| `prototype/src/styles/field.css` | 695 | 619 | **−76** |
| **combined** | **844** | **765** | **−79** |

Deleted from field/shape: duplicated `.odo` / `.wave` / `.led` instrument rules,
bespoke `.optbtn` keycap markup styles, `.salbar` segment rules, CRT well
chrome now owned by `CrtFace`, dead pre-round-3 faceplate / routechip /
rswitch leftovers, and CutFrame-owned card corner polygons for `.fcard` /
`.lcol` / `.lface` / `.gtile` / `.plotbay-f`.

## What stayed bespoke (and why)

| Piece | Reason |
| --- | --- |
| `PttPill` | Hold-to-talk + handoff flash; not a Keycap / Button shape. Capsule shell kept per spec; chat segment is shadcn `Button`. |
| `FieldPlot` SVG | Mock radar plot — not a library instrument. |
| START `.vswitch` lever rows | Lever + params layout ≠ Keycap; uses `Led` / `Tag` for status only. |
| `.trow` / `.field-thread` / `.salstrip` / `.composer` chamfer | Local clip in `shape.css` — wrapping a `<button class=trow>` or flex:1 scroller in CutFrame fights layout. |
| Phone shell (`.fone` / `.fscr`) | Device chrome, not a card; stays in shape.css. |
| GAUGES `.gbar` / `.knob` | Window fill bars + physical knobs have no rig primitive. |
| `AvatarFace` | Spec: stays prototype-local (mock art). |
| Talkgroup capsule shell | Spec: keep capsule; segments use library buttons. |
| `StateBadge` unused | Domain type is `SessionState`; craft tags map cleanly to rig `Tag` tones instead. |

## SessionDial geometry note

Pre-port `SpendDial` used centre `(66,66)`, main r=44, session r=56, viewBox
`0 0 132 80`. Rig `DialGauge` is the board-standard half-moon (centre
`(66,62)`, r=52, viewBox `0 0 132 76`). SessionDial overlays the blue session
arc on DialGauge’s centre/viewBox so the field sits on the shared dial.
Expect minor dial-shape drift vs `8899210`; caption skinning matches field
sizes via `.fdial .rig-dial-cap`.

## Acceptance checklist

1. **Library consumption** — every field screen + dock/nav/view imports
   `@room/ui` / `@room/ui/rig`; no field file defines dial/LED/keycap/
   odometer/waveform markup (SessionDial’s session arc is the documented
   rig-ext composition layer).
2. **`pnpm typecheck`** — clean at root.
3. **Screenshots** — not captured in this pass (no computer-use round);
   owner / follow-up should compare five field screens + console at
   390×844 / 1500px.
4. **CSS shrink** — **−79 lines** combined (shape −3, field −76); bespoke
   leftovers listed above.
5. **Console / packages** — console untouched; `git status packages/` empty.

## Candidates for a future `@room/ui/rig` PR

- `DialGauge.sessionFraction` (blue outer arc) ← `SessionDial`
- `CrtFaceSize` includes `40 | 148` ← `FieldCrtFace`
- Compact card / screen-bed sibling ← `FieldCard`
