# Build spec — THE RIG standalone prototype

_2026-07-30. Replaces the incremental phase plan as the way the design
target gets locked (owner correction — see the banner on
[design-ui-target.md](design-ui-target.md) §9 and the memory note).
[design-ui-target.md](design-ui-target.md) stays the design authority
(§2 visual system, §3/§4/§5 surfaces, §7 flows);
`docs/archive/concepts-round-c-v6/board-rig-refined.html` stays the CSS
reference. This spec defines the prototype vehicle._

## What this is

A **siloed React+shadcn prototype** of the whole RIG experience over
**mock data**: every surface, every load-bearing state, every flow —
including everything the live app cannot render yet (spine rail, plot,
salience ring, THE CORE, held-question keycaps, verb rack, artifacts,
tap-in). Its job: make flows and interactions cheap to experiment with
and change, lock the target, and only then work backwards to what the
daemon/wire must grow and how the real UI refactors into components
shared across desktop and mobile.

Hard rules:

- Lives in **`prototype/`** (workspace package `@room/prototype`),
  Vite + React 19 + TypeScript, dev-only — never installed, never
  imported by panel/mobile/daemon.
- **No real contracts**: does not import `@room/room-client`,
  `@room/protocol`, `panel/src/*`, or anything from `tts-server/`. No
  WebSocket/SSE/fetch to the daemon. No Gemini/ElevenLabs calls, ever.
- MAY import the pure presentational pieces: `@room/ui` rig primitives
  + `rig.css` + `tokens.css` (that's what the metal shop was for) and
  shadcn/Radix bits from `@room/ui` where useful. If a primitive needs
  a change, prefer additive props; note it in the PR.
- Mock types are **free to invent fields** (salience, plans, spend,
  heldQuestions, artifacts…). Keep them in `prototype/src/mock/types.ts`
  with a comment per invented field — that file becomes the wishlist
  for the eventual wire work. Do NOT mirror PanelSnapshot exactly;
  shape data the way the UI wants it.

## Structure

```
prototype/
  index.html            vite root, dark ink page
  src/main.tsx
  src/App.tsx           view router: CONSOLE ↔ PLOT ↔ (later) FIELD
  src/mock/
    types.ts            RoomState, Craft, Plan, HeldQuestion, Artifact…
    fixtures.ts         one rich room: 2 plans docked (1 live, 1 queued),
                        3 settled plates, 5 crafts across states, spend
                        totals, watch order on one craft, 1 artifact
    scenario.ts         the state machine + trigger functions (below)
    store.ts            tiny useSyncExternalStore store over RoomState
  src/audio/mock.ts     canned voice: speechSynthesis wrapper (free) +
                        optional bundled short mp3s; exposes speaking
                        state that drives lamps/waveforms/lipsync
  src/avatars/          TMNT frames copied from panel/public/avatars +
                        a lightweight CSS/JS lipsync+blink mock (do NOT
                        import panel/src/stage)
  src/console/…         desktop console surfaces
  src/plot/…            LONG-RANGE PLOT
  src/deck/…            control deck (trigger drawer)
```

`pnpm --filter @room/prototype dev` → port 5180. Root `pnpm typecheck`
picks it up.

## The control deck (what makes it a prototype)

A collapsible drawer (button + backtick key) of **scenario triggers**,
each one line of state-machine code, so flows can be driven and
re-driven instantly:

- SPAWN CRAFT (birth at top of rail → materialize → working)
- HAND RAISE on craft N (→ ARRIVAL choreography: node flare, needle
  drop, dock LED red, one spoken sentence at the lull)
- HELD QUESTION on craft N (3 options, armed recommendation)
- ANSWER (by keycap click — and a "speak it" mock that resolves the
  same option)
- SPEAK (Mikey says a canned line: talk lamp + waveform + lipsync)
- DONNIE CHECKOUT / "thanks Donnie" return
- LIVE CLIP tick on the watched craft
- SETTLE craft N (conclusions → spine, card bolts on dark, pilot
  returns to manifest)
- THE LULL (everything settled: spine green, 100% CLR, stoked frame)
- MIC OPEN (everything dims a stop)
- TAP-IN Q&A (question → interpreter chip → spoken answer as Mikey)
- DIAGRAM ARTIFACT (one-off craft → artifact card docks → open renders
  a canned SVG → KEEP THAT graduates it / else it dies on delivery)
- SPEND BURN (CORE pulse + odometer roll + dial creep)
- TIME ×10 (ages hold-timers, drifts salience)
- RESET (back to fixtures)

Every trigger mutates the mock store; all motion derives from state per
the target's honesty rule (ambience excepted).

## Surfaces (target §3 + §4, ALL of them)

Console: faceplate + Donnie bay (Dial 2 home), THE SPINE energized rail
with docked plan cards (live/queued/settled dock states, birth slot),
thread nodes hanging off plans (all five states incl. spawning; open
node with mock tail/turns/spend strip/diff stub), SALIENCE RING (needle,
idle wobble, **draggable threshold tab** — allowed here), THE CORE
(conic month fraction, burn pulse, two half-moon dials, odometer),
REPLY DECK (composer, PTT bar mock hold, grant chip, held-question
keycaps with armed glow), watch-order chips, VERB RACK (incl. a
`GATED #75` watcher verb), TURN CHIP (Dial 3), crew manifest, and a
mock dock strip rendered as a floating mini-bar for state parity.

PLOT: polar map per §4 — you at center, craft radius = salience, red
threshold ring (draggable), radar sweep, spine structure at range,
archive drift, launch rim, one-off diamonds, callout leader lines,
zoom ladder as **hard cuts**: PLOT ↔ RAIL (console) ↔ NODE (open
node), buttons + double-click a blip.

Load-bearing states (§3 last bullet): ARRIVAL, MIC OPEN, THE LULL —
each reachable from the deck, each visually complete.

Mobile FIELD UNIT (§5, five screens): **round 2** of the prototype,
same package under `/field` — not in this first build.

## Fidelity bar

Board-fidelity visuals (port the v6 board CSS where the metal shop
doesn't already cover it), real TMNT frames with working blink/lipsync
mock, `prefers-reduced-motion` honored. Type/spacing/glows per target
§2. This is the thing the owner will stare at to decide the future —
taste matters more than code hygiene here, but keep components small
enough to rearrange fast (that's the whole point of the silo).

## Verification

- `pnpm typecheck` clean at root; `pnpm --filter @room/prototype build`
  clean; zero diffs outside `prototype/` + root workspace/lock files
  (and `packages/ui` ONLY if additive primitive props were needed).
- Browser round: every deck trigger fired once, screenshot per
  load-bearing state + per surface.

## Status and follow-ups (2026-08-29)

Built so far, all in the silo on port 5180:

- Console v1 live 2026-07-30 (grok-4.5 lane, codex drove all 18 deck
  triggers in the browser).
- FIELD UNIT round 2 at `/field` 2026-07-30 per
  [prototype-kickoff-field-unit.md](../shipped/prototype-kickoff-field-unit.md).
- Round D 2026-08-02 per
  [spec-round-d-synthesis.md](../shipped/spec-round-d-synthesis.md):
  THE HANGAR, commissioning bay, `/crib`, `/map`. Boards and briefs are
  archived under `../archive/concepts-round-d/` (`final.html` is the
  merged board).

Open follow-ups, in the owner's words where they were given:

- FIELD composer (2026-08-12, "fine for now"): grow-as-you-type jumps
  per line instead of growing smoothly and wraps short lines oddly
  (reference: the Gemini and Claude app composers); add an attachments
  button, mock-only here, real upload is a framework concern.
- FIELD node cards (2026-08-12): "I don't understand these tiny minor
  character cards. I can't look at very much." The GLANCE full-node
  sheet (avatar, T-#### · TMUX · CLR row, LIVE TAIL, DIFF strip) needs
  an explanation pass or a rethink.
- Helix orb (console CORE hex ball) after the r4 recharge-glow change:
  "not so great, leave a note to come back to it." Revisit the shading
  and glow; the encodings stay (hexes = aggregate draw, ball = 7-day
  timer).
- The next panel rebuild picks up the shared DialGauge needle fix
  (`8dba2a2`); the dock dial was the only live consumer, no urgency.
- Round D punted `scroll-area` (optional per spec); the shadcn audit's
  live-surface items (tabs, collapsible, select, slider adoption in
  panel and mobile, orphan-dep removal) are a separate round.
- Cosmetic notes: phone-scale mono type is board-faithful but small and
  task lines ellipsize hard at 322px; the live P2 hero shows the avatar
  art's green background through the CRT grade (art cleanup is in the
  backlog).

The owner is fatigued on the prototype and wants the framework build
next; these wait for a prototype round.
