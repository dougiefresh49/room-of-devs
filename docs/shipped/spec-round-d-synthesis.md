# Build spec — Round D synthesis: HANGAR · TOOL CRIB · SERVICE SCHEMATIC

_2026-08-01. Round D ran four blind design lanes against
[design-brief-round-d.md](design-brief-round-d.md). The owner picked the
**fable lane** as the winner — best layout, best match to the rest of the
app. `docs/active/concepts-round-d/fable.html` is the **base**; the other
three boards (opus, grok, sol) are donors only. This spec is the build
order for `prototype/` (siloed, mock-data only — no daemon/panel/mobile
changes)._

Authorities that still bind everything below:
[design-ui-target.md](design-ui-target.md) §2 (visual system; **§2.6 —
nothing animates from invented data**), the corner grammar in
`prototype/src/styles/shape.css`, [spec-rig-prototype.md](spec-rig-prototype.md)
(the vehicle: no real contracts, no wire, no API calls),
[ui-architecture-map.md](ui-architecture-map.md) (prose authority for
problem C), [shadcn-audit.md](../reference/shadcn-audit.md) (provenance
data for problem B).

---

## TL;DR (the whole spec in 60 seconds)

Three new prototype surfaces, all fable's designs with a handful of opus
grafts (grok/sol contributed nothing that beat fable):

- **THE HANGAR** — the all-projects view, added as a fourth rung on the
  zoom ladder (HANGAR ↔ PLOT ↔ RAIL ↔ NODE). Rooms are berths in a grid,
  each with a mini spine, crew, and salience; a traffic strip shows the
  shared cross-room queue; one audio-floor bus shows who's speaking.
  New projects start at a **commissioning bay**: name + repo, ceremony
  choice (full room vs one-off), three dials — and the form's preview
  pane IS the manifest file being written (opus graft), with each dial
  printing what it costs in real units (opus graft).
- **THE TOOL CRIB** (`/crib`) — the component library: every RIG
  primitive, shadcn primitive, and domain component on a spec plate with
  live states, a provenance stamp (RADIX / CVA / LIB / FULLY CUSTOM), a
  stock lamp (used-widely / one-consumer / dead), a dead-stock bin
  naming what hand-rolls each dead part, and a work-orders drawer with
  the audit's top-5 adoptions. Replaces the old port-5179 gallery.
- **THE SERVICE SCHEMATIC** (`/map`) — the architecture map as a cutaway
  plate, not a text doc: surfaces ↔ machine layers ↔ wire-field terminal
  strip; select anything and unrelated parts dim. Every console/field
  housing gets a stencilled part number; **shift-click any housing to
  open the map with that part selected** (opus graft, the round's best
  idea).

Build = 4 phases for delegated lanes: (1) fleet data seam + hangar,
(2) commissioning bay + phone variants, (3) tool crib (parallel),
(4) schematic + deep links. Along the way the build adopts the three
dead vendored shadcn primitives (dialog, tooltip, sonner) plus `command`
— closing the audit's top findings.

---

## 0. Synthesis decisions

The rule applied throughout: **a coherent fable-flavored whole beats a
feature stew.** A donor idea was grafted only where it (a) answers a
question fable's version leaves open, and (b) costs one component or one
field, not a second layout grammar.

### Problem A — THE HANGAR (all-projects view + commissioning)

**Stays from fable, verbatim:**

1. **The hangar is the fourth rung of the zoom ladder** — HANGAR ↔ PLOT ↔
   RAIL ↔ NODE, hard cuts, no tween. Not a new window, not a mode: same
   console shell, one cut up. Plot and below stay per-room; the hangar is
   the only surface where all rooms exist at once. (All four lanes
   converged on this; fable's is the base.)
2. **Berths, not a starmap.** The `10,000-FT VIEW — ROOMS AS A STARMAP`
   callout on the plot retires. Spatial position carries no meaning for
   rooms, so inventing distance would violate §2.6 in spirit. Berth
   numbers are stable addresses (⌘0 hangar, ⌘1–⌘n berths).
3. **The vertical AUDIO FLOOR BUS rail** down the left of the berth grid
   (`grid-template-columns: 26px 1fr 1fr 1fr`, bus spans all rows) — the
   one-global-audio-floor rule made physical, with the lit tap stub on
   whichever berth holds the floor.
4. **Berth card anatomy**: berth no. + name, floor lamp, lead face in a
   CRT housing, spine glyph (live / queued / settled blocks on a stub
   rail), craft + watcher counts, salience bar + %, gear tag, one ticker
   line, hazard footer strip.
5. **Scratch berths look mortal**: dashed border, un-numbered, no spine
   glyph, no gear tag, no standing cast — "MIKEY NARRATES · DIES ON
   DELIVERY". When its craft settles the berth dissolves; nothing bolts on.
6. **The shared traffic strip** across the top of the hangar = the one
   salience queue, worst-first, room-attributed, with floor state per row
   (HAS FLOOR / QUEUED FOR FLOOR / AT THE LULL).
7. **Berth tabs ride the console header everywhere**, each carrying its
   room's needs-you LED — a cross-room arrival is one red dot in
   peripheral vision, not a modal.
8. **The dock strip carries the worst room, not the active one**: its LED
   bar renders `min(rooms[].salience.clearPct)` and the ticker prefixes
   the owning room (`PODLINK ▸ …`). The room you're staring at doesn't
   need an ambient channel; the ones you're not do. Derived — no new wire.
9. **Commissioning bay** = name/repo → the ceremony fork (two big cards:
   full-ceremony vs one-off) → the three dials with their architectural
   **homes printed on each** (D1 gear default → PLAN CARD, D2 voice/cast
   → FACEPLATE, D3 brain table → TURN CHIP) → connectors → `STRIKE BERTH`.
10. **Rooms are config, not architecture**: the commission writes
    `rooms/<name>/manifest.json` and nothing else. A new manifest = a new
    berth on the next snapshot; decommission = delete the file (spine
    survives in the tracker). One-offs never write at all.
11. **The voice-first path panel** beside the form: the same form,
    prefilled by Mikey, with the interpreter receipt line.
12. **FIELD variants**: GLANCE gains room pills + a cross-room
    attribution block ("other rooms — attributed, not rendered"); START
    commissions by voice with the manifest draft read-only out here
    ("adjust dials at the RIG").

**Grafted from donors:**

| # | Graft | From | Why it beats fable's version |
|---|---|---|---|
| A1 | **The manifest pane IS the form's output, live-bound.** Every control on the bay edits the pane; the pane header prints the real path. Two consequences printed as a design note: a free second entrance (hand-edit the file) and a free undo (`git checkout`). | opus (commissioning bench) | Fable shows a manifest *preview* — a static illustration of what will be written. Opus's binding is what kills new-project anxiety ("what did that wizard just configure?") and it matches the architecture exactly: rooms arrive as configuration. Cost: bind one JSON renderer to draft state. |
| A2 | **Each dial prints its consequence in the unit that bites** — ceremony in extra turns per piece of work, voice in per-character billing, brain tier in $/turn. | opus | The dials are the only place a person can accidentally make a project expensive, and cost honesty is already THE CORE's whole thread. Fable prints the dial's *home*; keep that and add the consequence line under the active detent. One line of copy per detent. |
| A3 | **`belowGate` on every traffic row** — the shared queue is the one place the speak gate applies fleet-wide, and red rows are exactly the set Mikey may speak about unprompted. | opus (muster strip) | Fable's traffic rows carry clear-% and floor state but nothing that ties them to `salience.threshold`, which already exists in `types.ts`. With the gate marker the strip answers "what is Mikey allowed to interrupt me about," which is the actual operator question. One boolean. |
| A4 | **ESC climbs one rung** (NODE → RAIL → PLOT → HANGAR); coupling into a berth is a hard cut down. | opus | Fable specifies ⌘0–⌘n addressing but no way *out*. The prototype has no keyboard model at all today; one keydown handler completes the ladder contract. |
| A5 | **`parentRoomId` on a scratch berth** — a one-off spawned from inside a room shows `FROM R-DEVS` on its dashed plate. | opus (skiff rows carry `· RM-01`) | One-offs are usually born inside a room ("draw me the auth flow"); without attribution a scratch berth looks like an orphan project. One optional field. |

**Considered and dropped (do not build):**

- **opus's audio floor as a hazard-striped bar along the bottom.** Fable's
  vertical bus rail already carries holder + waiting queue and costs 26px
  instead of a full row. Two renderings of the same fact would double-tell.
- **opus's three-LED room spur on the dock strip.** Fable's worst-room
  rule plus the room prefix already gives attribution, and the dock is
  ruler-width by design.
- **opus's "ceremony is one knob, not two flows"** (BARE detent = skiff).
  It conflates two different things: *room durability* (is a manifest
  checked in) and *per-thread gear default*. Fable is right to fork first
  and dial second.
- **opus's separate SKIFF LANE.** A second layout grammar for what is
  normally 0–2 items. Fable's inline dashed berth keeps one grid.
- **sol's "orbital switchyard" / pressure vessels.** A spatial metaphor
  that invents distance — the exact framing fable and opus both rejected
  on §2.6 grounds.
- **grok's marquee FLOOR QUEUE ticker.** Scrolling repeated text scans
  worse than fable's static worst-first rows and animates for its own sake.

### Problem B — THE TOOL CRIB (component library)

**Stays from fable, verbatim:** the crib framing (a machine-shop parts
crib, not a storybook — "no knob panels, no prop playgrounds"); the
three-column layout (drawer rail · search platen + card grid · sticky
spec plate); category **drawers** as the browsing model with surface
filter pins (C / F / P / M); provenance as a stamped plate class; the
red DEAD STOCK band; the generated `crib-manifest.ts` whose dead-stock
lamp comes from the audit's own grep (`grep -rn 'from "@room/ui"'`), so
the page cannot drift without the file drifting first; **the states row
IS the API surface** ("if a state isn't on the plate, it doesn't exist");
registry-rejection verdicts printed verbatim from the audit; the honesty
rule that a catalog animates only what the component itself animates.

**Grafted from donors:**

| # | Graft | From | Why |
|---|---|---|---|
| B1 | **A fourth provenance stamp class: `LIB ▸ <name>`** (green) for third-party non-shadcn bases — `Markdown` (react-markdown + rehype-sanitize), `toast` (sonner). | opus | Fable's three classes (FORGED IN-HOUSE / RADIX ▸ x / CVA) have no home for the components the audit explicitly calls "not a registry concept". A taxonomy with a hole mis-stamps real parts. |
| B2 | **Stock lamp with three states** — green ≥2 consumers, amber exactly 1 ("one deletion from dead"), red 0. | opus | Fable's dead-stock signal is binary. The amber/fragile state is the maintenance fact you actually want (`button` has exactly one consumer today), and it's the existing `Led` primitive at zero cost. |
| B3 | **A DEAD STOCK bin drawer** that prints, per entry, *what hand-rolls it instead* + an ADOPT/SCRAP verdict. | opus | Fable stamps dead stock on the card; opus supplies the actionable half. "`dialog` — hand-rolled by `ControlDeck.tsx` (role=dialog + manual keydown). VERDICT: ADOPT" is the sentence that gets it fixed. |
| B4 | **A WORK ORDERS drawer** carrying the audit §3 top-5 with real call sites and the adoption caveat printed on every order. | opus | Fable's crib answers "what do we have and what is it made of" but has no home for "what should we adopt next", which is half of what the audit is for. One extra drawer, static content. |
| B5 | **TOLERANCES — a props table on the spec plate** (name / type / note), plus an optional `KNOWN DEFECT` row. | opus | A parts catalog with no tolerances is incomplete; the prop surface is exactly what you need at the moment of reuse. Fable's plate has states/provenance/where-used/path and stops one field short. |
| B6 | **The crib lives at `/crib` on the prototype (port 5180)**, beside `/console` and `/field` — not on the gallery's port 5179. | opus | It ships with the thing it documents, reuses `App.tsx`'s existing path-sniff, and avoids a second dev server. `packages/ui/gallery/` is superseded — leave it in place with a pointer in its README until the crib lands, then it is a deletion candidate. |

**Cut from fable:** the port-5179 hosting decision (see B6) and the
hardcoded "33 INSTRUMENTS · 3 DEAD STOCK" counters — all counts render
from the generated manifest, never from prose.

**Dropped from donors:** grok's `/library` naming and quarantine-only
treatment (B3 is strictly richer); sol's "REJECTED ANALOGS" as a
first-class drawer (the rejection belongs on the plate of the part that
rejected it, per fable, not in its own bin).

### Problem C — THE SERVICE SCHEMATIC (visual architecture map)

**Stays from fable, verbatim:** route **`/map`**, opened by a `SCHEMATIC`
keycap in the console header *and* a control-deck trigger; **not a rung
on the zoom ladder** ("the ladder is operational magnification of live
work; the schematic is the service door you open when you've forgotten
why a gauge exists"); three columns — ON-SCREEN SURFACES (left) · THE
SETTLED ARCHITECTURE in three strata, voice over spine over mortal, with
the three dials drawn as physical knobs (center) · WIRE TERMINALS, one
screw per `types.ts` field (right); select any node → its harness lights,
everything else drops out; **diagram over inspector, ~70/30**, with the
inspector bed holding exactly three cells (why / architecture tie / wire
needs) plus a doc pointer; **solid pins = exists in the mock today,
dashed pins = Round-D wishlist**, carried on the same terminal block so
the gap is visible; selecting a wire pin **reverses the question** —
"who consumes this field"; the whole thing renders **no live data**, so
it can never lie about the room ("the one screen allowed to be a
document"); `map-data.ts` is checked in and mirrors the prose doc, which
stays the authority.

**Grafted from donors:**

| # | Graft | From | Why |
|---|---|---|---|
| C1 | **Part numbers stencilled on every housing, and shift-click any housing → `/map` opens with that part selected.** (`S-01…S-14` console, `F-01…F-06` field, `M-01…` machine, `R-01…` rules.) | opus | This is the single strongest idea in the donor set: it makes the console its own index, and answers "why is that thing there?" *from where you asked it*. Fable listed it as deferred; promote it to the build (its own phase, since it touches console/field housings). |
| C2 | **Phase tags on wishlist terminals** (`WISH · P3`), turning the terminal strip into a planning tool. | opus | Fable's solid/dashed pin taxonomy says *whether* a field exists; the phase tag says *when it's owed*, which makes "what does P3 unblock?" a thing you click rather than grep. Additive to a taxonomy already in the base. |
| C3 | **The plate shows its own holes** — the doc's "Not yet designed" entries render as red rivets in the middle column; a filled hole goes amber and joins the plate. Rivet 1 (all-projects view) ships stamped `FILLED · ROUND D`; rivet 2 (CORE vs GAUGES telling one spend story two ways) stays red. | opus | "A map that only shows finished parts quietly lies about the machine." Fable's map marks `The Hangar ◂ NEW` but has no home for known gaps. The gaps list becomes a UI state instead of a maintenance chore. |

**Dropped from donors:** opus's `/plate` route naming (fable's `/map`
matches grok and sol and reads better in the header keycap); opus's
**live LEDs on stratum I** (a lamp showing whether a surface is currently
rendering) — it would make the map read live data and forfeit fable's
"it can never lie" property; opus itself calls it a late nicety. sol's
"signal loom" harness-run rendering and grok's dim-unrelated behavior are
already what fable's harness lighting does.

---

## 1. Build plan against the prototype

`prototype/` is siloed mock-data only. No daemon, panel, mobile, or
`packages/*` changes except **additive props on `@room/ui` rig
primitives**, which must be called out in the PR.

### 1.1 Routing + the fleet seam

`App.tsx` today sniffs one path (`/field`). Replace with a tiny table in
a new `prototype/src/routes.ts`:

```ts
export type Route = "console" | "field" | "crib" | "map";
export function currentRoute(): Route;   // path-sniff, default "console"
```

- `/field` → `<FieldView/>` (unchanged)
- `/crib`  → `<CribView/>`   (problem B, no store access at all)
- `/map`   → `<MapView/>`    (problem C, no store access at all)
- default  → hangar **or** console/plot/node, per the fleet zoom

**The hangar is not a route.** It is the top rung of the zoom ladder, so
it lives on view state, and switching rooms must not carry it. The store
grows one level, additively:

```ts
interface AppState {
  fleet: FleetState;                 // NEW
  rooms: Record<RoomId, RoomState>;  // today's RoomState, now keyed
}
```

- `useRoom()` keeps its exact signature and returns the **active room's**
  `RoomState` — every existing console/plot/field component compiles
  untouched. `patchRoom` / `setRoom` patch the active room.
- New `useFleet()` for the hangar, berth tabs, traffic strip, dock strip.
- `fleet.zoom: "hangar" | "room"`. When `zoom === "room"`, the active
  room's existing `view` (`plot | console | node`) drives the lower three
  rungs. `ViewMode` does **not** gain a `"hangar"` member — that would
  put a fleet fact on a per-room object.
- `setView("hangar")` sets `fleet.zoom`; every other `setView` sets
  `zoom: "room"` plus `rooms[active].view`. `coupleRoom(id)` sets
  `activeRoomId` + `zoom: "room"` + that room's `view: "console"` (the
  hard cut lands on the rail, per fable).

Fixtures become `makeFixtures(roomId)`: `room-of-devs` is today's rich
room verbatim; `podlink` and `comic-reader` are thinner full-ceremony
rooms (1–2 plans, 1–2 crafts) so that "the spine is per project" is
visibly true when you switch; the scratch room has `plans: []` and one
one-off craft. Every `Craft` gains `roomId`.

### 1.2 Component inventory

**Reused unchanged from `@room/ui/rig`:** `CutFrame` (every new housing —
it owns the clip-path + drop-shadow wrapper), `Chassis` (berth plates,
crib bays, map columns), `Bay`, `ScreenBed` (traffic strip, manifest
pane, inspector bed), `Tag` (gear tags, provenance stamps, part
numbers), `Led` (floor lamps, berth needs-you dots, stock lamps),
`SalienceBar` (berth salience row, traffic rows), `CrtFace` (berth lead
face), `Keycap` (`STRIKE BERTH`, `SCHEMATIC`), `DialGauge` (crib
specimen; **not** used decoratively in the hangar), `Waveform` (floor
holder only), `Odometer`, `HexLayer` (crib + map backdrops).

**Reused from `prototype/`:** `AvatarFace` (berth lead face inside
`CrtFace`), `FieldCard` / `FieldCrtFace` (FIELD variants), `DockMiniBar`
(gains the room prefix + worst-room source), `GlanceScreen` /
`StartScreen` (extended, not replaced), `ControlDeck` (new triggers).

**Genuinely new:**

```
prototype/src/hangar/
  HangarView.tsx        shell + berth grid + ⌘/ESC key handling
  BerthCard.tsx         berth · scratch · empty variants
  FloorBus.tsx          the 26px vertical audio-floor rail
  TrafficStrip.tsx      shared salience queue, worst-first, gate-marked
  BerthTabs.tsx         header strip (also rendered by the console shell)
prototype/src/hangar/commission/
  CommissioningBay.tsx  the bench
  CeremonyFork.tsx      the two big cards
  DialRow.tsx           three dials + home label + consequence line
  ManifestPreview.tsx   live-bound JSON pane (graft A1)
  VoicePath.tsx         the prefilled-by-Mikey panel
prototype/src/crib/
  CribView.tsx  DrawerRail.tsx  InstrumentCard.tsx  SpecPlate.tsx
  DeadStockBin.tsx  WorkOrders.tsx
  crib-manifest.ts      generated data (see 1.4)
  specimens.tsx         per-instrument fixed-state render fixtures
prototype/src/map/
  MapView.tsx  StratumColumn.tsx  TerminalStrip.tsx  Inspector.tsx
  map-data.ts           ~35 nodes + terminals + gaps, mirrors the prose doc
prototype/src/map/PartNo.tsx   stencil badge + shift-click deep link (C1)
prototype/src/styles/{hangar,crib,map}.css   imported by proto.css
```

**Corner grammar for the new housings** (do not re-derive; reuse
`shape.css` scales): hangar shell = L (`.mainwin`), berth plate / crib
bay / map column = M (`.chassis`), traffic strip / manifest pane /
inspector bed = S (`.screenbed`), stamps + part numbers = tag sub-scale
(`5px 1px 1px 1px`). Anything needing an outer glow on a cut card uses
`filter: drop-shadow()`, never `box-shadow` — and prefers `CutFrame`
over new CSS rules, per the note at the top of `shape.css`.

### 1.3 Mock-data extensions — `prototype/src/mock/types.ts`

Additive. Keep the file's convention: a comment per invented field.

```ts
export type RoomId = string;
export type Ceremony = "full" | "one-off";
export type GearDefault = "bare" | "light" | "full";
export type BrainTable = "lean" | "std" | "deep";
export type FloorState = "has" | "queued" | "lull";

/** The file a commission writes: rooms/<name>/manifest.json. */
export interface RoomManifest {
  room: RoomId;
  name: string;
  repo: string;
  ceremony: Ceremony;
  /** null ⇒ scratch room; nothing durable is written. */
  spine: { tracker: "github"; repo: string } | null;
  cast: { lead: PersonaId; checkout: PersonaId[] };
  gearDefault: GearDefault;   // dial 1 — home: PLAN CARD
  brainTable: BrainTable;     // dial 3 — home: TURN CHIP
  connectors: string[];       // "gh-issues" | "tmux" | "vercel" | "sentry"
}

/** One berth on the hangar floor — manifest + the rollups a plate reads. */
export interface RoomBerth {
  id: RoomId;
  manifest: RoomManifest;
  /** null = scratch berth: dashed, un-numbered, dissolves on settle. */
  berth: number | null;
  /** Scratch spawned from inside a room — "FROM R-DEVS". */
  parentRoomId: RoomId | null;
  salience: { clearPct: number; worstCraftId: string | null };
  counts: { working: number; needsYou: number; settled: number; watchers: number };
  /** Spine glyph blocks. Scratch berths report zeroes and render none. */
  docked: { live: number; queued: number; settled: number };
  ticker: string;
}

/** One row of the ONE shared salience queue, room-attributed, worst-first. */
export interface TrafficRow {
  roomId: RoomId;
  craftId: string | null;
  label: string;
  salience: number;
  /** Below the single fleet-wide speak gate — Mikey may raise it unprompted. */
  belowGate: boolean;
  floorState: FloorState;
}

/** Exactly one holder or null — the global audio floor made explicit. */
export interface AudioFloor {
  roomId: RoomId | null;
  persona: PersonaId | null;
  elapsed: string;
  route: "phone" | "mac";
  queue: { roomId: RoomId; reason: string }[];
}

export interface CommissionDraft {
  berth: number | null;
  name: string;
  repo: string;
  ceremony: Ceremony;
  gearDefault: GearDefault;
  lead: PersonaId;
  checkout: PersonaId[];
  brainTable: BrainTable;
  connectors: Record<string, boolean>;
  /** "voice" ⇒ prefilled by Mikey; drives the receipt line. */
  source: "rig" | "voice";
}

export interface FleetState {
  zoom: "hangar" | "room";
  activeRoomId: RoomId;
  rooms: RoomBerth[];
  traffic: TrafficRow[];
  audioFloor: AudioFloor;
  /** ONE gate, fleet-wide. Mirrors salience.threshold; not per-room. */
  threshold: number;
  commission: CommissionDraft | null;
}
```

**Changed:** `Craft` gains `roomId: RoomId`. `RoomState` is otherwise
untouched — it simply becomes *the coupled room's* state. Nothing that
exists today changes shape.

**Derived, not wired:** the dock strip reads
`min(rooms[].salience.clearPct)` plus the owning `roomId`. Do not add a
field for it.

Crib and map types live with their surfaces (`crib/crib-manifest.ts`,
`map/map-data.ts`), **not** in `mock/types.ts` — neither is a wire wish:

```ts
// crib
type Provenance =
  | { kind: "custom" }
  | { kind: "radix"; base: string }
  | { kind: "cva" }
  | { kind: "lib"; base: string };          // graft B1
interface Instrument {
  id: string; name: string;
  drawer: "rig" | "shadcn" | "domain" | "proto-ext";
  provenance: Provenance;
  registryEquivalent?: string; verdict?: string;   // audit verbatim
  path: string; consumers: string[];
  surfaces: ("console" | "field" | "panel" | "mobile")[];
  states: string[];
  props: { name: string; type: string; note: string }[];   // graft B5
  defect?: string;
}
interface WorkOrder { id, title, callSites: string[], payoff, caveat }

// map
type Stratum = "surface" | "machine" | "wire";
interface MapNode { id, partNo, stratum, group, title, see?, why, tie,
                    ties: string[], terminals: string[], src }
interface Terminal { id, field, status: "live" | "wish",
                     phase?: string, consumers: string[] }   // graft C2
interface Gap { id, title, filledBy?: string }               // graft C3
```

### 1.4 The crib manifest is generated, not written

`crib-manifest.ts` is produced by a small dev script
(`prototype/scripts/build-crib-manifest.ts`, run by hand, output checked
in) that unions:

1. exports of `packages/ui/src/index.ts` + `rig/index.ts` + prototype
   `rig-ext/`;
2. the audit's own detector,
   `grep -rn 'from "@room/ui"' panel/src packages/mobile/src prototype/src`,
   for `consumers[]` / `surfaces[]` (zero hits ⇒ dead stock);
3. a hand-kept provenance + verdict table transcribed from
   `docs/reference/shadcn-audit.md`.

No counts are ever hardcoded in JSX. The script makes **no** network
calls and never runs `shadcn add`.

### 1.5 New ControlDeck triggers

Existing triggers keep operating on the **active room**. New ones:

| Trigger | What it demonstrates |
|---|---|
| `OPEN HANGAR` | zoom to the fourth rung (also ⌘0 / ESC from RAIL) |
| `COUPLE ROOM ▸ PODLINK` | the hard cut: hangar → that room's rail, spine visibly different |
| `CROSS-ROOM ARRIVAL` | podlink's watcher logs an anomaly while you're in r-devs: traffic row drops below gate, podlink's berth + tab LED go red, dock ticker flips to `PODLINK ▸ …`. **The money demo for problem A.** |
| `FLOOR HANDOFF` | r-devs releases the floor, podlink takes it — bus beam moves, exactly one holder, the other room shows QUEUED FOR FLOOR |
| `COMMISSION ▸ VOICE` | opens the bay prefilled from Mikey's path (`source: "voice"`) |
| `STRIKE BERTH` | draft → new berth appears + toast receipt |
| `ONE-OFF SPAWN` / `ONE-OFF SETTLES` | scratch berth appears with `FROM R-DEVS`, then dissolves |
| `OPEN CRIB` / `OPEN SCHEMATIC` | route jumps to `/crib` and `/map` |

### 1.6 §2.6 compliance — what is allowed to move

- **Hangar:** the floor-bus beam only while a room actually holds the
  floor; the holder's `Waveform`; berth floor lamps and needs-you LEDs
  driven by real mock facts; CRT sweep/scanlines as ambience. The traffic
  strip is **static rows — no marquee** (grok's ticker explicitly
  rejected). Cold berths have no beam. Scratch dashes are static.
- **Commissioning bay:** the text caret and the detent transition on a
  knob *you turned*. Nothing else.
- **Crib:** each specimen runs its own real animation at its true rate —
  that is the spec. **No gauge climbs, no simulated data**; every state
  rack is a set of fixed fixtures shown at once.
- **Map:** zero ambient motion. Selection lighting is driven by your
  click; strata links are static; CRT texture is ambience. No live lamps
  on stratum I.

---

## 2. shadcn pulls

Per `docs/reference/shadcn-audit.md`. **Adoption caveat, every time:**
vendor the Radix behavior, drop shadcn's palette, restyle against
`packages/ui/src/tokens.css`. Never run `shadcn add` with a theme.

| Pull | Where | Note |
|---|---|---|
| **`command` (cmdk)** — new | Rebuild `ControlDeck.tsx` on it, and use it for a ⌘K **room switcher palette** in the hangar. | Audit top-5 #4: "the control deck IS a command palette hand-built from a backtick keydown listener." Fuzzy filtering for free; the room palette is a second consumer on day one. |
| **`dialog`** — vendored, **dead** | The control deck's shell (it currently hand-rolls `role="dialog"` + manual keydown) and the `/map` full-bleed layer when opened as an overlay from the console. | Audit: "exactly what `ControlDeck.tsx` rebuilds." Adopting kills one dead-stock entry. |
| **`tooltip`** — vendored, **dead** | Provenance stamps and part-number stencils (hover → the audit verdict / the part's title). | Kills a second dead-stock entry, and lets the crib demo its own tooltip honestly instead of stamping it red. |
| **`toast` (sonner)** — vendored, **dead** | The `STRIKE BERTH` receipt ("MANIFEST CHECKED IN · MIKEY ANNOUNCES THE BERTH AT THE LULL"). | Audit #2, "highest effort-to-payoff in the audit; the dep is already paid for." Kills the third dead-stock entry. |
| **`tabs`** — new | The crib's drawer rail (it is a real tablist and needs roving focus). | Audit top-5 #1. |
| **`collapsible`** — new | Crib spec-plate open/close in place, and the map inspector's cells. | Audit runner-up; three hand-rolled expanders already exist elsewhere. |
| **`toggle-group`** — already vendored + live | The ceremony fork and all three dial detent rows. | Reuse, not a pull — it already ships in `ListenScreen.tsx`. |
| **`scroll-area`** — optional | Crib card grid and map columns. | Nice-to-have; skip if it costs layout fights with the chamfer. |
| **`input` / `native-select`** — optional | Commissioning bay name/repo + connector selects. | Styling-only win per the audit; hand-styled fields are acceptable here. |

**Do not adopt:** `badge`, `card`, `progress`, `chart`, `avatar`,
`theme-*` — the audit rules each of these out explicitly, and the RIG
primitives they'd replace are the product.

Nice side effect worth noting in the crib copy: after this build all
three dead primitives have a consumer, so their stock lamps go from red
to **amber** (exactly one consumer) — fragile, not dead. The crib should
show that honestly rather than claiming a clean sheet.

---

## 3. Phasing

Sized for delegated implementation lanes (composer-2.5 / grok-4.5 via
`cursor-agent --worktree -p --force`). File ownership is disjoint per
lane except where noted. **No lane makes live Gemini/ElevenLabs calls —
this is a mock-data prototype.**

### Phase 1 — Fleet seam + hangar floor  _(grok-4.5; run first, alone)_

Owns: `prototype/src/mock/{types,fixtures,store,scenario}.ts`,
`prototype/src/App.tsx`, `prototype/src/routes.ts`,
`prototype/src/hangar/*` (not `commission/`),
`prototype/src/console/DockMiniBar.tsx`,
`prototype/src/styles/hangar.css`.

Delivers: the `AppState`/`FleetState` split with `useRoom()` unchanged;
per-room fixtures; `routes.ts` with **all four routes stubbed** (`/crib`
and `/map` render a placeholder so later lanes only fill their own file);
hangar view (floor bus, berth grid incl. scratch + empty berths, traffic
strip with `belowGate`); berth tabs in the console header; ⌘0/⌘1–n and
ESC-climbs-a-rung; worst-room dock strip; the `OPEN HANGAR`,
`COUPLE ROOM`, `CROSS-ROOM ARRIVAL`, `FLOOR HANDOFF`, `ONE-OFF
SPAWN/SETTLES` triggers.

This phase is the only one that touches shared files, which is why it
runs alone.

### Phase 2 — Commissioning bay + FIELD variants  _(grok-4.5)_

Owns: `prototype/src/hangar/commission/*`,
`prototype/src/field/{GlanceScreen,StartScreen}.tsx`, its own CSS block
in `hangar.css`. Adds only new triggers to `scenario.ts` (append-only
region at the bottom of `TRIGGERS`).

Delivers: the bench (name/repo → ceremony fork → three dials with homes
**and consequence lines** → connectors → `STRIKE BERTH` with a sonner
receipt); the live-bound manifest pane with its real path in the header;
the voice-path panel; GLANCE room pills + cross-room attribution rows;
START's voice commission with the read-only manifest draft.

### Phase 3 — The tool crib  _(composer-2.5; runs in parallel with Phase 2)_

Owns: `prototype/src/crib/*`, `prototype/scripts/build-crib-manifest.ts`,
`prototype/src/styles/crib.css`, a pointer line in
`packages/ui/gallery/README.md`. Touches `routes.ts` only to replace the
`/crib` stub with the real import (one line).

Delivers: drawer rail (RIG · SHADCN · DOMAIN · PROTO-EXT · **DEAD STOCK**
· **WORK ORDERS**), search platen, surface pins, card grid, sticky spec
plate with states / four-class provenance stamp / stock lamp / where-used
/ path / **tolerances table** / optional defect row; the dead-stock bin
with "hand-rolled by" + verdict; the work-order drawer from audit §3;
the generated manifest.

Zero daemon dependency, zero shared state — the safest lane in the round.

### Phase 4 — Service schematic + console deep links  _(grok-4.5 or opus subagent; runs last)_

Owns: `prototype/src/map/*`, `prototype/src/styles/map.css`, the
`SCHEMATIC` keycap in the console header, and a **surgical** `<PartNo/>`
insertion into each console/field housing (one badge element per
component — nothing else in those files changes). Touches `routes.ts`
only to replace the `/map` stub.

Delivers: three-column plate; harness lighting on select; inspector bed
(why / tie / wire + doc pointer); terminal strip with solid/dashed pins
and phase tags; reverse selection ("who consumes this field"); the two
gap rivets with rivet 1 stamped `FILLED · ROUND D`; part numbers on
housings and shift-click deep links; deck trigger + header keycap.

Runs last because the `<PartNo/>` insertion touches files Phases 1–2 own.

### Verification (every phase)

```bash
pnpm typecheck                              # root workspace, must be clean
pnpm --filter @room/prototype build         # tsc + vite build, clean
pnpm --filter @room/prototype dev           # port 5180
```

Browser round per phase: every new deck trigger fired once; a screenshot
per new surface and per load-bearing state (hangar with a cross-room
arrival, the floor handoff, a scratch berth appearing and dissolving, the
bay in both ceremony classes, the crib with a plate open and the dead-stock
bin, the map with a surface selected and with a terminal selected).
`prefers-reduced-motion` honored on every new surface. Zero diffs outside
`prototype/` (plus `packages/ui` **only** for additive primitive props or
newly vendored shadcn primitives, and `packages/ui/gallery/README.md`).
UI verification that needs real interaction goes to codex computer use in
**one** batched round per phase.

---

## 4. Wire needs — consolidated

What the daemon would eventually have to provide for the hangar to be
real. **Problems B and C need nothing** — the crib renders a generated
file, the map renders a checked-in one; both are pure dev surfaces.

1. **`rooms[]` — manifests, parsed.** A watched `rooms/` directory of
   `manifest.json` files, the same way `queue/` is watched today. A new
   file = a new berth on the next snapshot; a deleted file = a
   decommissioned berth. This is the whole "rooms are config" claim, and
   it fits the existing filesystem-as-IPC contract exactly.
2. **Per-room rollups on each berth**: `salience.clearPct` (min over that
   room's craft, same 0–100 scale), `counts`, `docked`. Server-side —
   the client must not sum across rooms.
3. **`traffic[]` — the daemon's own ordering**, worst-first, with
   `roomId` attribution and `belowGate` computed against **one**
   fleet-wide threshold. Not per-room summaries stitched client-side;
   not a per-room threshold.
4. **`audioFloor`** — holder room + persona + elapsed + the waiting
   queue. The daemon already enforces single playback via playback locks
   and `.now-playing.json`; this exposes what it already knows.
5. **`Craft.roomId`** on every craft.
6. **Snapshot shape:** full `RoomState` for the coupled room only, plus
   `RoomBerth` summaries for the rest. Do not ship N full rooms.
7. **Commission = one file write** (`rooms/<name>/manifest.json`) from a
   panel/mobile action; one-offs write nothing (scratch manifest in
   memory). Decommission = delete the file; the spine stays in the
   tracker. Deferred: decommission UI, per-room themes, cross-room
   artifact moves.
8. **No new wire for the dock strip** — it derives from (2).

Nothing here changes `PanelSnapshot` semantics for the single-room case:
`design-ui-target.md` §8 cut 2 (v1 renders one room, others as a dim
badge) **evolves into** the hangar rather than being broken by it.
