# Design Brief — Round C, v3 (reference-seeded)

> Archived 2026-08-29: Round C play-round brief; the settled target is [active/design-ui-target.md](../active/design-ui-target.md).

_2026-07-29. Delta on [design-brief-round-c-v2.md](design-brief-round-c-v2.md):
everything in the v2 brief about what the product IS, the settled
architecture (#73), the required surfaces, avatars-unavoidable, the
revoked cost tiebreaker, and the "what I'd cut" note still applies
verbatim. What changes in v3: the visual direction is no longer open —
each board is seeded with owner-reviewed reference images generated for
this purpose (Nano Banana Pro, batch 1, 2026-07-29)._

## Why v3

v2's four futurist boards were **better but still missed the mark**
(owner, 2026-07-29). Rather than hunt screenshots from the shows/games
the owner had in mind (Altered Carbon, Foundation, Halo, Titanfall 2),
we generated concept images of individual UI *fragments* in two style
lanes and the owner reacted to those. This round builds one board per
lane, borrowing directly from the approved fragments.

## The reference fragments

`concepts-round-c-v3/refs/` — 5 pieces × 2 lanes (640px previews;
full-res originals live outside the repo). Pieces: the SPINE, a
TERMINAL NODE card, the SALIENCE RING, an avatar FACEPLATE housing, a
SPEND PRESSURE gauge cluster.

**These are style seeds, not screenshots to reproduce.** They are 3D
photoreal renders; the board is HTML/CSS. Translate the *language* —
palette, materials, typography, information design, how a component
carries authority — and do not attempt CSS photorealism. If a fragment's
idea survives translation but its render style doesn't, keep the idea.

## Lane A — INDUSTRIAL (Titanfall 2)

Machined gunmetal chassis, amber/warm-white light, stencil military
type, hazard chevrons, hardware that reads as loved field equipment.

Owner direction (2026-07-29, verbatim intent):

- **Mechanical-looking pieces used SPARINGLY.** The machined
  bezels/screws/rusted plates in the refs are accents — chassis corners,
  one or two hero housings — not the texture of every element.
- **Digital displays carry most of the information**: amber monochrome
  screens, dot-matrix/seven-seg readouts, terminal text. Think BT's
  cockpit: metal frame, glowing instruments inside.
- **Don't lean on 3D-heavy styling.** Flat/2.5D CSS that *evokes*
  machined metal (borders, subtle gradients, stencil type) beats
  laboring at photoreal depth. Owner: "can always work backward if it's
  too hard to match the concept" — so err toward what CSS does well.

## Lane B — CLEAN CYBER (Altered Carbon / Foundation)

Deep black glass, hairline white/cool-cyan light, thin elegant type,
floating translucent layers, generous negative space — "a neural
interface designed in Cupertino." Owner had **no extra notes** on this
lane: follow the fragments.

## Board requirements (same as v2, restated short)

- One self-contained HTML file, no external requests; inline the avatar
  frames CSS from `concepts-round-c-v2/_avatar-frames.css` **verbatim**
  and use the real animated avatars — all 7, lipsync/blink working.
- Show the real product: the room of personas, the spine with plans as
  blueprint/schematic nodes, mortal threads as terminal nodes on data
  channels, the salience quantity (distance-from-needing-you) as a
  first-class instrument, spend pressure as instrumentation, voice/live
  as a spoken subscription not a mode.
- Real data shapes from `PanelSnapshot` thinking; no invented telemetry
  theater (THE BRIDGE rule from v2 stands).
- End with a visible **"what I'd cut to rein it in"** panel.

## Deliverables

- `concepts-round-c-v3/board-industrial.html`
- `concepts-round-c-v3/board-cleancyber.html`

Published to Postplan group `room-of-devs/round-c-v3` for owner review.
