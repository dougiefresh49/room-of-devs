# Design Brief — Round C, v4 (feature build-out on the v3 winners)

> Archived 2026-08-29: Round C play-round brief; the settled target is [active/design-ui-target.md](../active/design-ui-target.md).

_2026-07-29. Delta on [design-brief-round-c-v3.md](design-brief-round-c-v3.md)
and, through it, v2. Owner reaction to v3: **"I like them both a lot"** —
BOTH lanes survive. This round is ADDITIVE: same two boards, same
aesthetics, now carrying the features the v3 boards skipped. A mobile
concept round (v5) follows after the owner reacts to v4. We stay in the
world of play — concept boards, not prototypes._

## Owner's v3 reaction (binding)

1. **Aesthetics: keep.** Do not restyle THE RIG or BLACK // GLASS. Extend
   them in their own language.
2. **Confusion to fix:** in THE RIG's center, the owner couldn't tell
   what the avatar rows were ("are those just worker threads?"). Yes —
   mortal threads wearing the persona that runs them — but the design
   never said so. Both boards must make the thread/persona relationship
   **self-evident** (legend, labeling, framing — designer's choice).
3. **Missing features to add** (below).

## Features every v4 board must show

Pull details from `architecture-concepts/04`–`09` (the settled #73
model) and `design-conversational-layer.md`. Required:

- **Replying.** The full input story on desktop: a text reply into a
  thread (tmux inject), PTT/voice reply with the grant affordance, and
  **answering a held question** — the NEEDS-YOU thread is holding an
  AskUserQuestion; show its options as first-class controls, answerable
  by click or by voice.
- **The zoomed-out map** — owner's words: *"a zoomed out view of the
  spine and work in progress — like a space map."* Everything in flight
  at a glance: the spine(s) at distance, plans as structures, threads as
  craft/nodes positioned by salience (distance-from-needing-you), the
  threshold visible at map scale. Show the zoom relationship: map ↔
  rail/room ↔ single-thread detail. This is the board's headline
  addition — give it real estate.
- **Starting work.** How new work is born: speaking to the concierge
  (voice-above-orchestration), saved verbs, and where a freshly spawned
  thread appears.
- **The three dials** (brain tier and friends — take the real set from
  the architecture docs) with visible homes, not buried in a settings
  page.
- Keep what v3 already did well: salience instrument, spend pressure,
  watch orders/spoken subscriptions, live tail on the open node.

## Rules carried forward

Self-contained HTML, zero external requests, avatar frames inlined
verbatim + all 7 personas animated, PanelSnapshot-shaped data, no
telemetry theater, visible "WHAT I'D CUT TO REIN IT IN" panel (updated
for the new features). Industrial lane: machined chrome sparingly,
data on digital displays, don't chase 3D.

## Deliverables

- `concepts-round-c-v4/board-industrial.html` (THE RIG, extended)
- `concepts-round-c-v4/board-cleancyber.html` (BLACK // GLASS, extended)

Postplan group `room-of-devs/round-c-v4`. v3 boards stay up for
comparison. Then: **v5 = mobile concepts** in both lanes, same
world-of-play footing, before any prototyping.
