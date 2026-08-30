# Design Brief — Round C, v5 (mobile concepts, both lanes)

> Archived 2026-08-29: Round C play-round brief; the settled target is [active/design-ui-target.md](../active/design-ui-target.md).

_2026-07-29. Delta on [design-brief-round-c-v4.md](design-brief-round-c-v4.md).
Owner reaction to v4: **"looks awesome, I'm really liking both lanes"** —
no corrections, both aesthetics locked-in-play. v5 takes each lane to the
PHONE. Still the world of play: concept boards, not prototypes._

## What mobile actually is here

Do not shrink the desktop. The phone is a different situation, not a
smaller screen: the owner is away from the Mac — couch, car, errand —
and the room keeps working. The phone's jobs, in order:

1. **Be spoken to.** Audio routing to the phone already exists
   (device toggle, speaker gate, live streams). Turn-finals, watch-order
   narration, and the concierge's voice arrive here first.
2. **Answer from the pocket.** A thread crossed the threshold and needs
   you: held AskUserQuestion options, a text reply, or hold-to-talk —
   thumb-first, one hand, interruptible.
3. **Glance.** The space map at phone scale: is anything drifting toward
   me? What's the spend? One screenful, legible at arm's length.
4. **Start work by voice.** Speak to the concierge from anywhere; saved
   verbs as speakable one-liners.

Deep inspection (live tails, diffs, blueprint schematics) is allowed but
secondary — a "walk to the Mac" handoff is an honest answer for heavy
surfaces. v2's "mobile deliberately thin" stance is now replaced by this
brief; the owner asked for mobile fleshed out.

## Current mobile reality (ground truth, don't contradict)

`packages/mobile/` SPA: token-gated `/`, RoomClient over SSE, one audio
adapter (prime/live-stream/handoff/speaker-gate — only a client whose
device toggle is "phone" auto-plays routed audio), replies inject into
tmux threads, `/thread/<id>` history exists. Design within these bones;
inventing beyond them is fine in play, but flag it in the cut panel.

## Board requirements

- Present as a set of PHONE-FRAME screens (device-width mockups laid out
  on the board with annotations) — 4–7 screens covering at minimum: the
  glance/map screen, a thread needing you (held question + reply +
  PTT), the listening/now-speaking experience (who's talking, what
  arrives as audio, the speaker gate), starting work by voice, and
  spend/dials access.
- Same lane aesthetic as v4, translated to handheld: THE RIG stays
  machined-sparingly + amber digital displays; BLACK // GLASS stays
  black glass + light-as-status.
- Avatars remain unavoidable (frames CSS verbatim, animated) and the
  thread-wears-persona legend carries over.
- Interaction honesty: thumb reach, one-hand use, what happens on a
  lock screen / notification is fair game to sketch.
- Self-contained HTML, zero external requests, PanelSnapshot-shaped
  data, no telemetry theater, visible "WHAT I'D CUT TO REIN IT IN".

## Deliverables

- `concepts-round-c-v5/board-industrial-mobile.html`
- `concepts-round-c-v5/board-cleancyber-mobile.html`

Postplan group `room-of-devs/round-c-v5`. After owner reaction: settle
the play rounds into a design target before any prototyping.
