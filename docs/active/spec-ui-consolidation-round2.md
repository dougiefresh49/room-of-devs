# UI Consolidation Round 2 — promote and replace

Status: **awaiting owner go-ahead** (owner leaning yes, 2026-07-24).
Source: deep-module audit run with the `codebase-design` skill
(mattpocock/skills), 2026-07-24. Supersedes the strawman in
[ui-architecture-concerns-2026-07-24.md](ui-architecture-concerns-2026-07-24.md).

## The findings, in one breath

The refactor made both apps React, but sharing stops at badges and Radix
wrappers. Everything above that line is built twice:

- **panel/src/style.css is 2,465 lines** (not the ~800 previously
  believed) and is the **top surviving churn file** since mid-June — 30
  commits, 3.3× the runner-up. `body` declared 3×, seven selectors
  declared 2×, plus dead rules (`.hold-control`, `.replay-slower-*`,
  `.icon-btn.paused-indicator`).
- **Nine concepts implemented twice** across panel + mobile: agent card,
  picker flow, avatar-with-fallback (5 copies), toast, icons (3 files),
  transport controls (**4 implementations**), segmented control (4),
  connection dot, action menu.
- **@room/ui exports nobody imports**: TransportBar, Toaster/toast,
  Button, Dialog, Tooltip, ToggleGroup, IconHold — while both apps
  hand-roll exactly those components.
- **Tailwind v4 is fully wired into the panel** (same setup as mobile;
  `panel/vite.config.ts`, `tailwind-entry.css`) and used for exactly one
  utility class (`w-auto`, ActionCluster.tsx:155).
- **Seam violations**: `client.send` called raw from AgentCard, DockView
  (×2), PickerView, SettingsView despite `cluster-actions.ts` existing as
  the single dispatcher; PickerView does raw `localStorage` +
  `platform.pickFolder()`; three mobile players call `audioController.*`
  directly instead of taking callbacks.

## The strategy: promote and replace

One motion, repeated per module:

1. **Promote**: build the shared module in `packages/ui`, Tailwind-native,
   interface = domain data in + callbacks out (house rule), with explicit
   slots for what genuinely varies per platform.
2. **Adopt**: both apps replace their copy with the shared module.
3. **Delete**: the per-app implementations AND the matching style.css
   bucket die in the same PR. **Never port style.css rules to Tailwind
   in place** — deletion by replacement only.

Sequencing rule (learned in round 1): this program **precedes any further
parallel UI lanes** — parallel lanes amplify divergence while the shared
layer is thin.

## Design concept round (2026-07-24, awaiting owner pick)

Before implementation, four models produced blind redesign concepts
(shared brief: features + constraints + shadcn vocabulary, NO screenshots
or source access, to avoid anchoring on the current UI). Boards on
Postplan:

- fable-5 — https://zei3ppumt27v.postplan.dev
- opus-5 — https://2wvdo907zxo7.postplan.dev
- gpt-5.6 Sol — https://mtnvgwhxswaa.postplan.dev
- grok-4.5 — https://yyuhenv8hb68.postplan.dev

Notable: all four independently converged on a broadcast/studio metaphor
(on-air tally for speaking, persona color as identity-only, state as
light).

**Synthesis pass** (same day): each model was shown all four boards
anonymized (A=opus, B=grok, C=sol, D=fable) and produced a
best-of-everything candidate with a provenance table:

- fable-5 — https://mm3h6ad9wdmb.postplan.dev (A's channel strips in
  D's warm den atmosphere; new copy doctrine: studio nouns only in
  chrome, personality only in character speech; neutral-white mic)
- opus-5 — https://tl9ypflq0vi4.postplan.dev (caught the all-four PTT/
  on-air white collision → luminance inversion for input vs output;
  three-tier density ladder: program strip → attention strips → bench)
- gpt-5.6 Sol — https://hvokx1vs0fet.postplan.dev ("The Cue Room";
  achromatic speech signal, stable seat positions, metaphor only where
  it aids orientation)
- grok-4.5 — https://qg588zjt922a.postplan.dev

**Wildcard pass** (2026-07-25): a fresh blind pass with a deliberately
vague ~40-line brief (product essence + 4 constraints, NO feature
inventory) to escape in-the-weeds framing. It produced the most novel
material:

- opus-5 — https://5po3g3xuk4dn.postplan.dev (the scarce resource is
  THE FLOOR: four places an agent stands — floor/queue/green-room/door;
  politeness ladder: throat-clear 45s → knock 3min → silent forever;
  sound tokens beside color tokens; scrubbable screenplay; ears-only
  earbud-tap phone mode; a "deliberately absent" list)
- fable-5 — https://f9doy4fum0r1.postplan.dev (LAIR FM radio station:
  scrubbable Tape, "unheard debt" paid by catch-up-at-2×, dock as a
  door-ajar showing one moving mouth, walkie-talkie phone, entrance
  stings, voice commands as "errand slips")
- gpt-5.6 Sol — https://dne4nleu0axb.postplan.dev (radio play /
  soundstage: floor + queue + score; "silence is a designed state";
  three distances)
- grok-4.5 — https://0tfse0jlfd67.postplan.dev

That's 12 boards total (4 blind-detailed, 4 synthesis, 4 wildcard).
Owner's first reactions (2026-07-25, pre-review): LAIR FM (fable
wildcard) and the Sol wildcard have "very neat off the wall ideas";
opus-5 wildcard "interesting, not sure as a whole but has neat
elements"; full side-by-side review + picks pending.

**Input-parity requirements for the locked target** (owner, 2026-07-25
— gaps every board missed; these are REQUIREMENTS, not stretch ideas):

1. **Desktop typed chat.** Today the desktop is voice-only (replies
   require the terminal pop-out); mobile has text. The target must
   include a T3-Code-style typed chat experience on desktop — type a
   reply without speaking (headphones on, hear the response; or pure
   text, no voice at all). Not a new feature class — reply parity. The
   terminal pop-out stays as the escape hatch for anything the UI
   doesn't handle.
2. **Attachments everywhere you can reply.** No surface today accepts
   an image/file from the owner (like pasting a screenshot into a
   Claude Code terminal chat). Desktop and mobile composers both need
   image/file attach. (Agent-side drawing/whiteboard remains a backlog
   stretch idea — this item is about owner→agent input.)

**Wildcard round 2 (2026-07-25):** one more open-concept pass, brief
seeded with the future goal states as structural requirements (screen
awareness, two-way drawing, multi-agent group call, desktop typed reply
+ attachments — brief:
archive/reviews/ui-redesign-2026-07/wildcard2-brief.md). Boards:

- fable-5 — https://uz36nbhv8gro.postplan.dev ("One Room, One Tape":
  three attention distances — Strip / Table / phone-as-Earpiece — over
  ONE scrubbable tape where every spoken line, sketch, screen glance,
  and decision is a seekable moment; napkin drawing surface at the
  table's center; violet consent frame IS the screen-share permission;
  working silent / waiting knocks once / only blocked repeats)
- opus-5 — https://3udl7sr120rh.postplan.dev (the room is a TABLE, not
  a timeline: one shared canvas where glances/sketches/pastes/traces
  land — all four future capabilities become "ways an object enters the
  conversation"; deliberately NO per-agent threads so the group call
  can't be a retrofit; state as posture not badges; visible floor +
  speaker queue; consent gesture with redaction brush + 5-min expiry)
- gpt-5.6 Sol — https://bugbi8pyppsb.postplan.dev ("The Studio": the
  room is an instrument — shared audio studio with a quiet visual
  score; notebook-warm ground for ten-hour days, bright color reserved
  for speech/attention/consent; "looking is a moment" consent framing)
- grok-4.5 — https://sj0lol7oubfd.postplan.dev ("a radio play you can
  see": directed ensemble on a sewer-dark stage; huddle = group call
  as a circle; screen glances and drawings as first-class turns)

**Final synthesis pass (2026-07-25):** each model got all three prior
rounds anonymized (detailed brief + 4 synthesis boards; wildcard-1
brief + the owner's 3 favorites — sol/fable/opus; wildcard-2 brief +
fable/opus/grok, sol's round-2 board excluded as a miss) and was asked
to fuse the strongest elements — or re-visualize freely — into the
definitive concept, future goals structural, provenance notes per
surface. Brief: archive/reviews/ui-redesign-2026-07/final-brief.md.

- fable-5 — https://6jox1hvrceaf.postplan.dev ("THE DEN — one floor,
  one tape, one table": Floor = speech turn-taking + politeness
  ladder; Tape = single scrubbable memory, threads demoted to filters
  (the move that makes the group call possible); Table = glances/
  ink/attachments as objects entering the conversation; "what comes
  from you is light" talkback law; Night Booth palette; inline
  provenance chips + cut list)
- opus-5 — https://d7wpykv0js50.postplan.dev ("One floor, one table,
  one tape" — convergent skeleton with three original moves: AMBER as
  the developer's own color (kills the violet-vs-Donnie collision),
  the BATON as one object unifying speak/type/attach/show at three
  sizes, and a spelled-out "type-through" contract for typing on the
  never-focusing sliver; full provenance table + build-first list)
- gpt-5.6 Sol — https://v059dy7f78r7.postplan.dev ("The Workbench")
- grok-4.5 — https://ifjfe2tv0zim.postplan.dev ("Floor & Table")

All 20 boards are grouped on the Postplan dashboard under
`dougiefresh49/room-of-devs-ui-concepts`. Notable: fable and opus
independently converged on the identical floor/table/tape skeleton —
strongest convergence signal of the program.

Next: owner reviews side-by-side and picks/mixes → an agent builds the
locked target as a REAL React + shadcn mock (scratch Vite app, actual
shadcn components + lucide icons — the static boards hand-rolled their
"shadcn", hence wonky buttons/spacing; the real mock doubles as the
step-0 component shopping list) → target locked as
`design-ui-target.md` feeding steps 1-3 below.

## shadcn-first rule (owner call 2026-07-24)

We don't rebuild commodity UI — registry first, custom only for the
genuinely domain-specific magic (avatars/lipsync, PTT, karaoke).

- **Step 0 wires the shadcn CLI into packages/ui**:
  `pnpm dlx shadcn@latest init -c packages/ui` (Tailwind v4, CSS
  variables mapped to our existing `--room-*` tokens in tokens.css —
  tokens.css stays the color authority). Registry auth uses
  `SHAD_CN_REGISTRY_TOKEN` (already in .env) via the registries block in
  components.json.
- Today's primitives were **hand-vendored** (no components.json) — which
  is exactly how they drifted into zero-consumer exports. After step 0
  they're CLI-managed: re-added via `shadcn add`, updatable, and every
  new need starts with `shadcn search` before anyone writes custom UI.
- The installed `shadcn` skill's styling rules (semantic tokens only,
  `cn()` for conditionals, layout-not-style className) become the law
  for all new shared modules.
- Caveat to verify in step 0: registry components assume preflight; we
  run preflight-less while legacy CSS coexists. Mobile already proves
  the primitives work without it — spot-check each newly added
  component the same way. Once style.css dies, enabling preflight
  becomes possible.
- **AI Elements** (the shadcn AI component registry: conversation,
  message, chain-of-thought, etc.) is a strong fit for live-mode
  ChatView/ConvoSheet and for rendering interpreter CommandPlans as
  chain-of-thought steps — flagged as the follow-on round after this
  one, not round-2 scope.

## Build order

### Step 0 — shadcn CLI wiring + housekeeping (small, goes first)

- components.json in packages/ui, registry token config, re-adopt the
  existing primitives under CLI management.
- Delete dead style.css rules + duplicate selectors; prune or adopt
  zero-consumer @room/ui exports (Toast → shadcn/sonner in BOTH apps,
  segmented controls → ToggleGroup where it fits).

### Step 1 — PlayerControls (smallest; proves the loop)

- Today: play/pause/stop implemented in mobile MiniPlayer,
  PlaybackStrip, PlayerSheet AND panel ActionCluster; the stop-✕ SVG
  path inlined 5×; `@room/ui TransportBar` (44 lines) imported by nobody.
- Build ONE `PlayerControls` with size variants (strip / mini / full);
  delete TransportBar and its orphaned CSS (`.hold-control`,
  `.replay-slower-*` rules in style.css).
- Mobile players take callbacks instead of importing `audioController`
  (App/container wires the controller — the seam mobile already claims in
  api.ts:1-2).

### Step 2 — AgentCard + Avatar (the flagship visual)

- Today: two AgentCards (panel 175 / mobile 178 lines) with **zero prop
  overlap in the action half**; avatar-fallback pattern copied 5×.
- One shared AgentCard: agent view + state flags in, callbacks out, two
  slots for real variance — interaction layer (panel gesture via
  `usePttGrant` spread props vs mobile grant button) and name (panel
  rename-capable vs static).
- One shared Avatar whose interface admits both `src` owners (React on
  mobile; the panel stage engine mutates via ref — img refs NEVER go
  through React renders, that constraint stays).
- Delete the card/grid style.css bucket (~419 lines) on adoption.

### Step 3 — PickerFlow (biggest single win)

- Today: PickerView 265 + PickerSheet 392 lines, zero shared model,
  duplicated MODELS tuple and path helpers; round 1 built
  select-then-confirm twice in parallel lanes.
- One `PickerFlow` module: single Selection model, single MODELS list,
  shared path/age helpers; data in (dirs, sessions, personas) +
  callbacks out (onSpawn/onResume/onPickFolder); layout slots for
  window-view (panel) vs sheet (mobile). Flag persistence stays per-app
  behind a tiny storage callback (panel localStorage / mobile prefs.ts).
- Delete the picker style.css bucket (~434 lines) on adoption.

### Riding along with each step

- **Command seam** (candidate 5): every panel `client.send` goes through
  a deepened `commands` module (grow `cluster-actions.ts`); touched
  components stop importing `client`.
- **Icons** (candidate 6): icons carry their own sizing via props — no
  more depending on `.icon-btn svg` ambient CSS; merge the 3 icon files
  into @room/ui as their consumers migrate; delete duplicate glyphs.

### Explicitly out of scope this round

- Dock/spotlight (~559 lines of style.css), settings (~427), shell
  (~161) — migrate view-by-view in later rounds once the shared modules
  exist.
- mobile-http.ts split (server-side tidy, separate concern).
- audio/controller.ts (1,195 lines — its own future review).

## Execution shape

Per docs/reference/worktree-parallel-flow.md, but **steps are sequential**
(each reshapes packages/ui — a hot file). Within a step, one delegated
lane builds; main session reviews the diff and merges. Model pick per the
rubric: user-facing UI needs taste ≥ 7 → sonnet-5 minimum, opus-4.8
preferred for AgentCard/PickerFlow; grok-4.5 acceptable for the
mechanical housekeeping step. Delegates launch with
`--output-format stream-json` for live progress (new skill recipe).

Verification gates per step:
- `pnpm typecheck` clean (root workspace).
- Panel: `pnpm tauri build --debug` + panel-dev-install + relaunch.
- Mobile: `pnpm --filter @room/mobile build` (dist committed) +
  `tts-server.sh restart`.
- Visual check: one codex computer-use round per step (both UIs), not
  per tweak. NO live Gemini/ElevenLabs calls — visual verification only.
- Behavior invariants: lipsync/blink stays ref-driven (no avatar frames
  through React); grant/PTT single-owner (`usePttGrant`) untouched in
  step 2; daemon never imports room-client or ui.

## Definition of done

- Zero duplicated domain components between panel/src/app and
  packages/mobile/src/components for: transport, card, avatar, picker.
- style.css under ~1,200 lines (shell + dock + settings only), zero
  duplicate/dead selectors.
- @room/ui has zero zero-consumer exports.
- CLAUDE.md updated with the layer boundary: primitives (shadcn) →
  domain leaf → domain composite (shared, slots for platform variance) →
  app shell/wiring (per-app).
