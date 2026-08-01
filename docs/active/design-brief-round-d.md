# Design Brief — Round D: Rooms, Library, Map

2026-07-31. Four independent design lanes (gpt-5.6 Sol, grok-4.5, opus-5,
fable-5) each produce ONE self-contained HTML concept board answering the
three design problems below. Boards are judged side by side; the winner
(or a synthesis) becomes the next prototype build spec.

## Context — read these first

- `docs/active/design-ui-target.md` — locked design authority for THE RIG.
  §2 is the visual system (gunmetal chassis, amber instruments, machined
  corner grammar, CRT faces, dial gauges). Hard rule §2.6: nothing
  animates from invented data.
- `docs/active/ui-architecture-map.md` — the current architecture map
  (569 lines of text). Its opening "60-second version" and its closing
  "Not yet designed" section (the ALL-PROJECTS VIEW entry) are required
  reading for problems A and C.
- `docs/active/spec-rig-prototype.md` — the prototype vehicle (siloed
  mock-data build in `prototype/`, control deck, port 5180).
- `prototype/src/mock/types.ts` — the wire wishlist. `RoomState` is ONE
  room today; `Plan[]` rendered by SpineRail is the spine.
- Visual vocabulary to reuse: `packages/ui/src/rig/` primitives
  (CutFrame, Chassis, Bay, ScreenBed, Tag, Waveform, Led, Keycap,
  HexLayer, Odometer, DialGauge, CrtFace, SalienceBar), tokens in
  `packages/ui/src/tokens.css`, corner grammar in
  `prototype/src/styles/shape.css` (one big top-left radius + bottom-right
  chamfer, three scales; clip-path swallows box-shadows so glows use
  drop-shadow).

## Problem A — ALL-PROJECTS VIEW + new-project flow

Today the prototype renders exactly one implicit room. Owner wants:

1. A view for every project/room in progress at once, and a way to switch
   between them. A spine (Plan rail) is **per project**. The architecture
   map's sketch: a room is a *manifest* (cast, spine pointer, gear
   default, connectors); the salience queue is shared across rooms with
   per-room attribution; there is one global audio floor (only one room
   speaks at a time). The map has a "10,000-ft view — rooms as a starmap"
   placeholder — you may use, evolve, or discard that framing.
2. A **start-new-project flow**: name/repo, and the config dials — is
   this a *full-ceremony* room (spine, GH issues, standing cast) or a
   *one-off* (mortal thread, no spine)? Include the three dials from the
   architecture: ceremony, voice, brain tier. Show what the flow looks
   like on desktop; a phone (FIELD) variant is a bonus.

Design questions to answer: where does the all-projects view live
(new top-level view next to console/plot? zoom level above the console?),
how does cross-room salience surface without opening each room, what does
switching feel like, and how does a one-off project render differently
from a full-ceremony one.

## Problem B — Component library page

A playground surface to see every core component we've built and know
what shadcn base it's built on. Raw material:

- RIG primitives (list above) — plain React+CSS, no Radix.
- Vendored shadcn primitives in `packages/ui/src/primitives/`: button
  (CVA), dialog, sheet, popover, dropdown-menu, toggle-group, tooltip,
  toast (sonner).
- Domain components in `packages/ui/src/components/` (StateBadge,
  AgentChips, TransportBar, SummaryText, Markdown, …) and prototype
  extensions in `prototype/src/rig-ext/` (FieldCard, FieldCrtFace,
  SessionDial).
- `docs/reference/shadcn-audit.md` — fresh audit of what's vendored,
  what's dead, and which registry components could replace custom code.
  The provenance data your design displays comes from here.
- An existing never-shipped gallery lives at `packages/ui/gallery/`
  (port 5179, every RIG primitive in every state). Your design may evolve
  it or replace it.

Each entry needs: live rendering across its states, a **provenance chip**
(which shadcn/Radix primitive it wraps, or FULLY CUSTOM), where it's used
(console / field / panel / mobile), and file path. Design the browsing
model: category rails? search? a spec-sheet layout per component (this is
an instrument catalog for a machine shop — lean into that)?

## Problem C — Visual architecture map

The ui-architecture-map doc is a giant block of text (see the postplan
render). Owner wants something in the control deck or a similar prototype
surface that **visually connects the pieces**: on-screen surfaces
(console components, the five FIELD screens) ↔ architecture concepts
(Mikey the concierge voice, interpreter line, spine, mortal threads,
silent workers, three dials) ↔ the wire fields each surface needs from
`types.ts`. Interaction sketch: select any node, see what it ties to and
why it exists. Decide where it lives (control-deck layer? dedicated
route like `/map`? zoom-out gesture from the console?) and how much is
diagram vs. inspector panel. It must read as part of THE RIG, not a
generic graph tool.

## Deliverable — per lane

ONE file: `docs/active/concepts-round-d/<lane>.html` (lane name is given
in your prompt). Self-contained: embedded CSS, no external fonts/assets/
CDNs, dark RIG palette (copy token values from tokens.css). Vanilla JS
for tab switching / node selection is fine — no frameworks. Structure:
one section per problem (A, B, C), desktop-width boards plus phone-frame
mockups where relevant, and short design-note callouts explaining each
decision. Static mock content only.

## Rules

- Do NOT edit any app/prototype/package code. Your single deliverable
  file is the only thing you write.
- No live API calls of any kind (no Gemini/ElevenLabs — this is a
  design-only task).
- Mock data must be plausible against `types.ts`; extend it in prose
  (a "wire needs" callout) where the design demands new fields — that
  callout is part of the deliverable.
- Respect §2.6: nothing animates from invented data — animation in the
  concept is fine only where a real data feed would exist.
