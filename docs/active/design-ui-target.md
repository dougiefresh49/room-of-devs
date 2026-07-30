# Design UI Target — THE RIG

_2026-07-29. Round C is closed: **THE RIG (industrial / Titanfall 2) is
the locked design target.** This document is the system of record for
prototype work. Sources of truth it distills:
`concepts-round-c-v6/board-rig-refined.html` (desktop, approved),
`concepts-round-c-v5/board-industrial-mobile.html` (mobile),
briefs `design-brief-round-c-v2/v4/v6.md` (incl. the owner's closing
corrections), and the settled #73 architecture
(`architecture-concepts/04–09` — not re-litigated here).
BLACK // GLASS and the other round-C boards are preserved for a future
theme system; the 10,000-ft starmap view is backlogged. Neither is built._

**Status: awaiting owner sign-off.** Prototype phase 1 starts only after
that.

---

## 1. What this UI is

A machined console you own like a titan owns its cockpit: **gunmetal
chassis at the corners, amber instruments carrying everything.** Chrome
is sparing; screens do the talking. Every pixel derives from
`PanelSnapshot` — the metal is decoration, the amber is data.

The product underneath (settled, #73): one always-on concierge voice
(**Mikey**, stateless, immortal) above an interpreter line; the task
manager (GH issues) is the spine; mortal orchestration threads pull work
from it; workers are silent; three dials (ceremony / voice / brain-tier)
each have a visible home. The one question the console answers at a
glance: **how far is this room from needing me?** That quantity —
salience — is ONE daemon-computed number per thread (§6).

Object grammar, used identically at every scale:

> **PILOT** = persona, from the manifest ▸ riveted onto ▸ **CRAFT** =
> one mortal thread (T-####) ▸ feeding ▸ **CONDUIT** to its plan ▸
> **DOCK** = plan clamped to the rail. Live work projects as holo;
> settled work bolts on dark. Settle = conclusions → spine, craft
> scrapped, pilot back on the manifest. **A blip is a node is a face —
> same object, three magnifications.**

## 2. Visual system of record

The v6 board's CSS is the reference implementation; values below are
normative and land in `packages/ui/src/tokens.css` (which stays the
color authority).

### 2.1 Palette

| Token | Value | Use |
|---|---|---|
| `--ink` | `#0b0d0f` | page void |
| `--gun1` / `--gun2` | `#3b4148` / `#23272c` | chassis gradient hi/lo |
| `--gun-edge` | `#12151a` | chassis borders, bezel strokes |
| `--steel` | `#c7ccd2` | stencil paint, callsigns, labels |
| `--steel-dim` | `#7d848c` | captions, inert labels |
| `--amber` | `#ffb347` | **all data** — instruments, conduits, LEDs |
| `--amber-hot` | `#ffd894` | peaks — names, keycap glyphs, needles |
| `--amber-dim` | `#8a5c20` | secondary amber, chip borders |
| `--amber-ghost` | `rgba(255,179,71,.08)` | chip washes |
| `--screen` / `--screen2` | `#160c02` / `#0f0801` | amber CRT bed |
| `--green` / `--green-dim` | `#8fe86e` / `#3d6b2c` | settled / archive |
| `--red` | `#ff5340` | needs-you, threshold, mic-hot, redline |
| `--haz` | `#d9a021` | hazard stripes (45°, with `#151312`) |

Glow constants: hot glow `rgba(255,150,30,…)`, standard amber glow
`rgba(255,179,71,…)`. Screws/bosses: radial `#9aa2ab → #4c5259 → #20242a`.

Reconciliation with today's tokens: the RIG ramp becomes the panel
values of the existing semantic tokens (`--room-bg` → ink-family,
`--room-surface` → gunmetal, `--state-working` → amber, danger → red,
settled/accent → green). The mobile-green `--room-accent` era ends on
desktop; state colors re-cut so `--state-working` amber and the amber
data color don't collide (working = `--amber`, needs-you = `--red`,
speaking = `--amber-hot`, idle = `--steel-dim`, settled = `--green`).
New token **categories** (radii/chamfers, hex tiles, glows, motion
durations) are added — tokens.css today has colors only.

### 2.2 Type

- Stencil family (`"Avenir Next Condensed","Arial Narrow",…`) for all
  headings/labels: uppercase, `letter-spacing:.14em`, weight 800.
- Mono (`"SF Mono",ui-monospace,…`) for all data, at a tiny fixed
  ladder: 7.5–12px with tracked letter-spacing (.1–.3em by role).
- Seven-seg style (`.sseg`): mono 700 amber with
  `text-shadow: 0 0 8px rgba(255,179,71,.55)`.

### 2.3 Corner grammar (the machined signature)

One big radius **top-left** + one chamfer cut **bottom-right**, echoed
at three scales:

| Scale | Chamfer | Radius | Applied to |
|---|---|---|---|
| L | `--cut-l: 20px` | `26px 6px 6px 6px` | window shells, plot bay, spine bay, faceplate |
| M | `--cut-m: 12px` | `16px 5px 5px 5px` | chassis panels, bays, thread nodes, plan cards |
| S | `--cut-s: 7px` | `9px 3px 3px 3px` | screen beds |

Chamfer implementation:
`clip-path: polygon(0 0, 100% 0, 100% calc(100% - VAR), calc(100% - VAR) 100%, 0 100%)`.
Sub-scale echoes on keycaps (`6px 2px 2px 2px`, 5px clip), tags
(`5px 1px 1px 1px`), chips/fields (`8px 2px 2px 2px`).

**Known consequence (handle in the component, not per call site):**
clip-path swallows outer box-shadows, so outer glows move to
`filter: drop-shadow()` on an unclipped wrapper. The corner-grammar
primitive owns this wrapper.

### 2.4 Hex layer

Hexes are **texture, never layout.** Three inline-SVG hex tiles
(24×13.86 tile, stroke `#ffb347`, three stroke opacities: `.5` /
`.13` / `.045`) applied as `background` on: rail shielding (with a
banded vertical mask + slow `shieldshift` drift), THE CORE's shell, and
faint instrument backdrops under screen gradients.

### 2.5 Avatars (unchanged mechanics, new housing)

Real TMNT frames; panel lipsync/blink stay in `src/stage/` — one rAF
loop, direct `<img>` mutation, **never through React renders** (mobile
stays static frames). New: every face sits in an amber CRT housing —
screen-bed background + `filter: sepia(.5) hue-rotate(-12deg)
saturate(1.5)` grade — so characters read as amber phosphor, at fixed
sizes (176 hero / 104 crew / 58 node / 52 dock / 26 legend). Blink
periods stay desynced per persona. Mikey's "stoked" frame is reserved
for real finishes. `prefers-reduced-motion` kills face animation.

### 2.6 Motion budget

The board's animation inventory (conduit `flow` ~1s, beam
`beamflow 1.1s` + `beampulse 3.4s`, radar `rsweep 9s`, threshold
`thrpulse 2.6s`, `holoflick 5s`, `hvburn 3.2s`, LED pulses, screen
sweep 7s, odometer `steps(10)` roll, typewriter tail) is the ceiling,
not a floor. Rules: all motion is CSS, everything honors
`prefers-reduced-motion`, and nothing animates from invented data —
every moving element is driven by a real snapshot fact or is pure
ambience (sweep/scanlines).

## 3. Desktop surfaces (panel main window)

The console's regions, each with its board-defined anatomy:

- **FACEPLATE // CONCIERGE UNIT** — Mikey hero (176px CRT), halo frame,
  name + "ALWAYS ON // STATELESS", talk lamp + 12-bar waveform.
  **Dial 2 home (VOICE).** Second-voice checkout renders as a smaller
  **DONNIE BAY** beside it (purpose line, elapsed, "returns on 'thanks
  Donnie'") — only ever these two faces speaking.
- **THE SPINE // ENERGIZED RAIL** — the one hero hunk of machined
  metal: rail with docking track, beam core (energy flowing up), hex
  shielding, vertical "THE SPINE" stencil, hazard base. Plan cards
  clamp on via **dock boss + projection stem**: live = flowing light
  stem + holo wash + flicker; queued = dashed dim stem; settled = the
  stem becomes a metal strut, boss eye green, card a dark bolted
  plate. Plan card = blueprint bed (amber grid on screen-bed), plan
  id/name, mini schematic SVG, step bars, gear tag (**Dial 1 home:
  CEREMONY**). Threads hang off the active plan on dashed amber
  conduits. New work is born at the **top of the rail** (spawning card:
  dashed border, materialize pulse, "reads the spine, not anyone's
  history").
- **THREAD NODES** — per-craft cards: 58px CRT face, callsign,
  `T-#### · TMUX ✓`, task line, state tag + last-substantive stamp.
  States: working / needs-you (glow + red tag + held duration) /
  settled (dim, "waiting for lull") / spawning / empty. Expanding a
  node (the "open node") reveals: live tail (the one open node only),
  spend strip, diff panel. This is also the thread-tap-in surface (§7).
- **SALIENCE RING** — hero instrument: steel bezel, segmented amber
  arc, needle with idle wobble, **draggable red threshold tab**
  (rendering the config value; dragging it is post-v1), readout
  `58% CLR · TH 35`, contributor lines below.
- **THE CORE** *(renamed — the board's "THE HARVESTER" label is
  retired; in Titanfall the tower is the harvester, not this. The
  harvester-tower language stays available for the spine)* — the spend
  guard: machined conic bezel, radial energy core whose **pulse = the
  burn happening now**, hex shell whose **lit conic fraction = month's
  draw** (e.g. 41% ≡ $4.10/$10). Below it: two half-moon dials
  (ElevenLabs month, Gemini today w/ redline) + voice-chars odometer.
- **REPLY DECK** — three ways to talk back, one interpreter line
  (PTT/text → rules → flash router → command service): text composer
  (screen-bed field + "INJECT ⏎" keycap; lands as a tmux inject bound
  to the **ticket**, serialized via CommandPlan), PTT bar (cold: "MIC
  COLD · HOLD SPACE OR HW KEY"; hot: red lamp, "CAPTURING — RELEASE TO
  SEND", live wave) + green **grant chip** ("SPEAKER GRANT ARMED ·
  device · countdown — the daemon's claim markers stay the billing
  authority"), and **held-question keycaps**: machined 22px keys, big
  option label + spoken phrase hint, the **armed** key = Mikey's spoken
  recommendation (glowing). Click or speak; STT resolves to an option
  id; ambiguity gets a clarify, never a guess.
- **WATCH-ORDER CHIPS** — dashed amber chips with a pulsing eye:
  "WATCH ORDER · T-#### · SAY 'STAND DOWN' TO CANCEL". This is the
  spoken-subscription rendering of the existing live-mode machinery.
- **VERB RACK** — machined toggle levers, one per saved verb; label is
  the utterance; watcher verbs racked with a red `GATED #75` tag.
  "First use is concierge work — you name it; **naming is consent**."
- **TURN CHIP** — "DIAL 3 · THIS TURN: FLASH · $0.002 — routing table,
  not judgment; every escalation logged with cost." **Dial 3 home.**
- **CREW MANIFEST** — 7 persona plates; lit = piloting a craft right
  now; dark = no craft out. Personas are voices + character + spine
  access, never voices in your ear.
- **THE DOCK STRIP** (NSPanel) — ruler-width: 52px Mikey (blinking,
  lipsyncing), the salience LED bar with its red threshold notch, a
  one-line ticker, three LEDs.
- **Load-bearing states** — ARRIVAL (node flares, needle drops, dock
  LED red; **one sentence at the lull, no siren** — unless the needle
  crosses the threshold); MIC OPEN (everything else dims a stop; no
  open-mic state exists in the snapshot, by design); THE LULL (spine
  green top to bottom, 100% clear, stoked frame allowed).

## 4. The LONG-RANGE PLOT (confirmed keep)

Tactical cartography, one screen: **you are the fixed point at
center**; every craft's radius = its salience (distance-from-needing-
you; 0 = needs you NOW, 100 = settle-side rim). The red circle is the
**speak gate at map scale** — cross it and Mikey talks. Anatomy: dashed
range rings (25/50/75/100 CLR), red pulsing threshold ring with a
grab-tab, 9s radar sweep, the spine standing at range as a structure
(plan blocks docked to a rail; settled craft drift toward "ARCHIVE
DRIFT"; a second room renders dim + quiet), diamond craft blips with
leader-line labels, dashed one-off diamonds ("no conduit — dies on
delivery"), a launch rim for newborn craft, and map-callout leader
lines to chamfered annotation boxes. One "FUTURE: 10,000-FT VIEW —
ROOMS AS A STARMAP · NOT BUILT" callout is the only starmap presence.

**Zoom ladder is a contract, not a camera:** three fixed views with
hard cuts — PLOT (all rooms) ↔ RAIL (one room, section-3 console) ↔
NODE (one thread). Buttons / double-click a blip; no pinch-zoom tween
(adopted cut).

## 5. Mobile — THE FIELD UNIT (`packages/mobile` SPA)

Not a small rig — **the field radio for a room that keeps working while
you're gone.** Jobs in order: be spoken to → answer from the pocket →
glance → start work by voice. Deep surfaces (tails, diffs, blueprints)
stay on the big board; **"walk to the rig" is an honest handoff**, said
on-screen. Same palette verbatim; machined chrome only in the bezel,
keycaps, and levers; phone-shaped radii only at the shell and touch
pills; type compresses to the mono micro-ladder; everything actionable
lives in the one-thumb reach arc with the PTT pill riveted to the
bottom of every screen.

Five screens, one job each:

1. **GLANCE** — salience strip (big `% CLR`, LED bar with threshold
   notch), the polar plot at arm's length (fixed camera; **tap a blip →
   that thread's screen**, no pinch), four thread rows. Header LEDs are
   the honest transport story: SSE = RoomClient connected, AUD = this
   phone holds the speaker gate.
2. **ANSWER** — held keycaps first (44pt+, stacked in the thumb arc,
   armed key = Mikey's spoken recommendation), then the text inject
   (live machinery, ticket-bound), then hold-to-talk (drawn, but see
   cuts). Grant chip states the billing authority.
3. **LISTEN** — the face IS the now-playing surface (158px lipsync
   Mikey; Donnie swaps in on checkout), routed chip ("AUDIO → THIS
   PHONE · MAC SPEAKERS COLD"), transcript line + queued-for-lull dim
   line, watch chip, and interrupt rights: a 74px **STOP** key (free —
   the clip is already paid for) + hold-to-duck. **Interruption is a
   right, not a request; nothing here can re-bill.**
4. **START** — speak new work from anywhere: transcript exchange,
   interpreter chip (`NEW WORK → FILE #### → SPAWN · FLASH $0.002 ·
   LOGGED`), the spawning row, and the verb rack as speakable
   one-liners (v1: tap-to-run rows).
5. **GAUGES** — the two spend dials + odometer + the three knobs,
   **read-only out here**; changing a dial is speech or the rig
   ("no pocket-dial disasters on billing-adjacent controls"). Ends in
   the walk-to-the-rig handoff chip.

Lock screen (sketch, gated — see cuts): held question as one
notification with the top keycap as an action; watch-order lines
collapse into a single updating notification; audio IS the notification
in v1.

## 6. Salience — ONE number, daemon-computed

Every board's shared dependency, specced here as the first daemon
change:

- **`AgentViewSchema.salience?: number`** — integer 0–100, "% clear of
  needing you". 0 = needs you NOW; 100 = settled-side. Computed in the
  daemon's snapshot builder, deterministically, from facts it already
  holds. Additive + optional, so older clients ignore it (snapshot
  schemas are non-strict on purpose).
- **`PanelSnapshotSchema.salienceThreshold?: number`** — the speak
  gate (0–100), read from `config.json`. Rendered by the ring tab, the
  plot's red ring, and the LED-bar notch. v1 renders it; dragging it
  writes config later.
- **v1 formula (tunable constants in one daemon module, no tracker
  join required):** base by state — `hand_raised` starts at the
  threshold and **drags down** with hold time (e.g. −1/min, floor 0);
  `speaking` ≈ 55; `working` ≈ 70, +10 if quiet-logged only; watch
  order active (live.on) −8; `idle`/settled = 100. Contributor lines
  ("SPLINTER · PLAN HELD 06:41 −22") derive client-side from the same
  visible facts in v1.
- **Relation to #75:** the full roll-up — joining watcher alerts and
  ticket state into salience — stays gated on #75. The v1 heuristic
  uses only session-state facts the snapshot already carries, so the
  ring, LED bars, and plot light up day 1 without it; positions get
  *smarter*, not *possible*, when #75 lands. (This supersedes the
  mobile board's "plot dark until #75" stencil — that cut assumed no
  interim number at all.)
- Wire-change mechanics: valibot schema + re-captured fixtures
  (`pnpm check-fixtures`), `PROTOCOL_VERSION` untouched (additive).

## 7. The two flows no board showed (owner's closing correction)

### 7.1 Tap-in

Two senses, both specced:

**(a) Ask the room (Mikey tap-in Q&A).** Owner asks by PTT or text —
"where are we on the dock bug?" — the interpreter classifies it as a
question, the daemon runs the tap-in assembly (the `tap-in.ts` flow:
spine + deterministic digest + one flash call, ≤150 words, cites
`#NN`/paths, refuses what the spine doesn't know), and the answer comes
back **as Mikey**: spoken via the normal voice path + rendered as an
interpreter transcript chip under the faceplate (`TAP-IN · FLASH
$0.0019 · LOGGED`, feeding Dial 3's cost log). The heavy threads are
never woken. Mobile: same flow from the START/LISTEN screens; the
answer is audio-first with the chip as the visual receipt.
*Engineering: promote `scripts/tap-in.ts` into a daemon command
(`ask`), wire interpreter routing, speak the result. The assembly and
cost line already exist.*

**(b) Look into a craft (thread tap-in).** Opening a node = attaching
to a running thread to look around: the open node's innards show the
live tail (open node only), the last turns from `/thread/<id>`
history, spend strip, and the diff. No new daemon surface — this is
the existing history + live machinery given the RIG open-node anatomy.

### 7.2 "Let me see a diagram" (artifact flow)

Owner asks Mikey for a diagram/schematic ("draw me the auth flow").
Per the settled model: the interpreter classifies a **one-off** → a
temp agent renders a **versioned Mermaid/SVG file** (render → annotate
→ revise; no real-time ink, no canvas) → the artifact registers in the
snapshot (`artifacts?: {id, title, path, threadId?, at}[]` — additive)
→ Mikey surfaces it: *"Here's the auth flow"* + an **artifact card**
docked beside the relevant plan/thread with the corner grammar and a
blueprint thumbnail. Opening it renders the SVG/Markdown in the
panel's summary pane (the existing sanitized Markdown renderer; docs:
publish already proves Mermaid→SVG rendering). Mobile v1: the artifact
card appears with a "ON THE BIG BOARD" handoff; simple inline SVG
render where trivial. "Keep that" graduates the artifact to a ticket
attachment on the spine; otherwise the craft dies on delivery (dashed
one-off diamond on the plot).

## 8. Day-1 scope line (adopted cuts — binding)

From both boards' cut panels, adopted as scope:

1. **Plot:** static re-place per snapshot rev + CSS transitions; no
   drift trails, no vectors. Zoom = three fixed views, hard cuts.
2. **Multi-room:** one room; other rooms are a dim badge + count. The
   manifest file remains the seam.
3. **Voice option matching:** exact grammar only ("option one/two",
   the option's own short label) in the RuleRouter — zero LLM per
   answer.
4. **CORE cell theater:** one hex texture + conic mask at the month
   fraction + one core pulse; snapshot spend totals only, no per-call
   cell ignition.
5. **Tails:** only the open node tails; docks are static (stem flow is
   the only motion); threshold stays a `config.json` number.
6. **Phone voice (PTT→STT):** v1 phone answers by keycap + text inject
   (both live today); the PTT pill stays drawn but routes to
   walk-to-the-rig until a capture path exists (conversational-layer
   Stage 4).
7. **Lock-screen push:** not in v1 — audio IS the notification; held
   questions wait on the glance screen.
8. **Barge-in ducking:** v1 = STOP + speak after (free by
   construction); ducking when the audio adapter grows it.
9. **Mobile verb rack:** tap-to-run rows with the utterance as label;
   speech arrives with cut 6.
10. **Second-voice checkout on mobile:** face + name swap on the
    LISTEN screen only; no bay, no controls.
11. **Watcher verbs:** racked and visibly `GATED #75` everywhere.

Backlogged, not built: **10,000-ft starmap** (one FUTURE callout
allowed), **theme switching** (BLACK // GLASS preserved in
`concepts-round-c-v4/v5`).

## 9. Prototype phases (cheap-first)

Each phase ships something visible, typechecks clean, and is
independently deployable. UI work and daemon work are separated so
`packages/ui` phases carry zero wire risk.

| Phase | What | Layer |
|---|---|---|
| **P1 — The metal shop** | RIG tokens into `tokens.css` (palette re-cut + new categories: chamfers, hex tiles, glows, motion) + Tailwind `@theme` mapping; corner-grammar primitives in `@room/ui` (`Chassis`, `Bay`, `ScreenBed`, `Tag`, `Keycap`, `Led`, `HexLayer`, `Odometer`, dial/gauge SVG bases — each owning the clip-path/drop-shadow wrapper); amber-CRT avatar housing treatment; a static gallery page proving the system; **dock strip reskinned** as the first live surface. | `packages/ui` + dock CSS only; no daemon |
| **P2 — The console** | Panel main window becomes the RIG console over the **existing** snapshot: faceplate + Donnie bay, thread nodes with open-node innards (existing `/thread` + live tail), crew manifest, watch-order chips (existing `live.on`), reply composer + PTT bar + grant chip reskin, dial homes rendered from what exists (voice home live; ceremony/turn chips static). Kills the corresponding `style.css` buckets on adoption (the round-2 promote-and-replace motion, re-specced against THE RIG — this supersedes steps 1–3 of `spec-ui-consolidation-round2.md`; its input-parity requirements — desktop typed chat, attachments where you can reply — ride along). | panel + `packages/ui`; no daemon |
| **P3 — Salience + instruments** | First daemon change: `salience` + `salienceThreshold` per §6 (+ fixtures); salience ring, LED bars, dock notch; the **LONG-RANGE PLOT** (static re-place, hard-cut zoom ladder). | daemon (small) + panel |
| **P4 — The spine mirror** | Daemon ships plans: open tracker issues w/ `state/*`+`gear/*` labels as a `plans?` snapshot section; the energized rail + docked plan cards (live/queued/settled dock states), birth flow (spawning card at the top of the rail), plot's spine-structure gains real blocks. | daemon + panel |
| **P5 — The reply deck completed** | Held-question options into the snapshot + answer-by-keycap as first-class commands (mobile `/action` allowlist included); armed-key = spoken recommendation; **tap-in Q&A** (`ask` command over the tap-in assembly, spoken as Mikey + turn chip w/ cost) — interpreter Stage 2's `answer_from_context` seam. | daemon + both UIs |
| **P6 — THE FIELD UNIT** | Mobile parity: the five screens per §5 over the same `@room/ui` primitives (GLANCE, ANSWER, LISTEN, START, GAUGES), within the day-1 cuts. Rebuild + commit `dist`. | `packages/mobile` |
| **P7 — Artifacts + verbs** | The diagram flow (§7.2: one-off → artifact registry → artifact card → summary-pane render → "keep that" graduation); verb rack over the saved-verbs registry files; THE CORE fed by real spend counters (ElevenLabs month via `fetchCredits()`, Gemini call log). | daemon + both UIs |

Deferred beyond P7: threshold drag-to-write, multi-room plot, phone
STT, push notifications, ducking, watcher verbs (#75), starmap, themes.

## 10. House rules that bind every phase

Componentized React over the existing stores (`RoomClient` +
view/server/ui stores); components never fetch — platform/adapters own
IO; avatar frames never through React renders; `tokens.css` is the
color authority; no live synthesis for UI work (verify with
`enqueue_manual.sh` short text / `signal.ts replay` / mock-live);
typecheck + `check-fixtures` gates; delegation per Session Token
Hygiene (delegates author against this spec; main session does specs,
review, merges); UI verification via codex computer use.
