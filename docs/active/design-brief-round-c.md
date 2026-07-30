# Design brief — Round C concept round (v1, SUPERSEDED)

> **SUPERSEDED 2026-07-29 by
> [design-brief-round-c-v2.md](design-brief-round-c-v2.md).** This brief
> produced four boards the owner rejected as *"text heavy, nothing
> incorporates the avatars, pure 2014 — those designs say task manager."*
> The fault was this document: it used the words *work board*, *status
> surface*, *work item*, and *ledger*, and then added a tiebreaker
> rewarding designs that needed no new backend — which together read as
> "draw me a cheap Trello," and buried the animated persona that is the
> whole point of the product. Kept for its Part 1 constraints (still
> accurate) and as a record of the failure. **Nothing about the UI design
> is locked.**

**Status of the design itself: WIDE OPEN — no concept has been chosen.**

This is the constitution every concept board must obey, and nothing more.
It exists because the first attempt at a design target locked the layout
too — which would have made every board the same board. Constraints here
are the ones that fall out of the picked architecture ([#73], docs
[04](architecture-concepts/04-generalized-model.md)–[08](architecture-concepts/08-spine-mechanics.md))
or out of code that already ships. Everything not named here is yours to
invent.

---

## Part 1 — LOCKED. Do not re-litigate.

### The architecture you are drawing a face for

One always-on concierge voice above the orchestration line. The task
manager (GitHub issues) is the spine and the room's durable mind. N
mortal orchestration threads are pulled from it; silent ephemeral workers
run under them. Everything with a context window dies and settles by
writing conclusions back. The voice is immortal *because* it is stateless.

The old premise — N agents, each a card, each a voice, each talking to
you — is **cancelled**. A design that recreates a grid of talking
personas fails this brief.

### The anti-goals, as things a reviewer can check on a screen

| # | Anti-goal | The screen test |
| --- | --- | --- |
| 1 | Not a voice+KB chatbot | The conversation is never the whole app; work state is visible without asking anyone |
| 2 | No multi-voice theater | **At most two avatars on screen, ever.** No floor, no speaker queue, no huddle, no hand-raise, no agents talking to each other |
| 3 | No real-time ink | No canvas, no strokes, no stroke timing, no scrub-synced replay |
| 4 | No lipsync escalation | Lipsync stays a cosmetic rAF loop; it never drives layout or logic |
| 5 | No always-listening mic | Every capture starts with a deliberate press. No VAD, no wake word |
| 6 | No resident orchestrator brain | Nothing implies a long-lived mind you can ask anything; answers cite the spine |
| 7 | No new orchestrator runtime | The work surface **mirrors** the tracker; it never becomes one (no drag-to-transition, no process designer) |
| 8 | No conversation state in clients | Every pixel derives from the daemon snapshot; clients hold view state only |
| 9 | No database for room state | If a view needs an index the filesystem can't serve, that's a design bug |
| 10 | No silent capability growth | "Save that as a tool" is always visible, named, and confirmed |

### What the UI must let a person do

Not *how* — that's your job. But a board that can't do one of these is
incomplete:

1. **Talk to the concierge** from any surface, by voice or by typing,
   with attachments, cheaply.
2. **See what's true underneath without asking** — what work exists, what
   state it's in, what wants attention, what it cost.
3. **Control salience** — what gets spoken now, what waits for a lull,
   what is only ever logged. Today the filter is `true`: every turn-final
   becomes speech. Killing that default is *the reason this round
   exists*, so a board that doesn't design this is missing its centre.
4. **Receive, question, and keep artifacts** — a rendered diagram or doc
   arrives, you ask about it, a new version arrives, you keep it. It is a
   file loop, never ink.
5. **See and steer the three dials** (below).

### The three dials each need a home

From [04](architecture-concepts/04-generalized-model.md)/[05](architecture-concepts/05-rooms-brains-sentinels.md).
Where they live and what they look like is open; *that* they are visible
and steerable is not.

- **Ceremony per thread** (`one-off` / `light` / `full`) — how much
  process a piece of work gets. A spawn-time decision.
- **Voice attachment** — the concierge by default; occasionally a 1:1
  voice **checked out** for one purpose, visibly temporary, which settles
  by writing a summary. Never two voices in conversation with each other.
- **Brain tier per turn** (`rules` / `flash` / borrowed frontier) — **a
  routing table in config, never a model's opinion of its own
  difficulty**, and every escalation is a logged event with its cost.
  Spend is a first-class product concern in this repo, not telemetry.

### Hard technical constraints

- **Three surfaces**: the desktop panel main window; the **dock**, a
  non-activating NSPanel that must never steal focus; the mobile SPA.
  Two windows, one bundle, two JS realms, coordinating only through
  daemon snapshots.
- **Avatar frames are mutated by ref and never pass through a React
  render** (the stage engine). Any presence component must admit that.
- `usePttGrant` stays the single owner of grant/PTT, including its
  portaled-content event firewall.
- `@room/ui` components take domain values + callbacks only — no fetch,
  no WS, no Tauri, no audio inside. The daemon never imports
  `room-client` or `@room/ui`.
- **Input parity is a requirement, not a feature**: typed chat on
  desktop, and attachments on *every* surface where you can reply.
- Build reality: this lands via promote-and-replace over
  [spec-ui-consolidation-round2.md](spec-ui-consolidation-round2.md)
  (shadcn CLI components, `--room-*` tokens, delete-on-adopt). Assume
  shadcn/Radix primitives and lucide icons.

### One strong default you may challenge, but must beat

The first candidate argues the **primary object is the work item** —
ticket + its thread + activity + artifacts + spend — and not the session
card, because a card is keyed to a context window and in this
architecture every context window is mortal, so a UI whose primary noun
dies at `/clear` rebuilds the failure #73 rejected.

That argument is strong and you should probably accept it. But the
*primary object* is a design decision, so if you have a better one —
the ticket, the conversation, the day, the room itself, a stream of
events — you may propose it. You must then beat the mortality argument
explicitly. "Session cards, but nicer" is not an answer.

---

## Part 2 — WIDE OPEN. This is what you're for.

Everything below is undecided. Disagree with the other boards on purpose.

- **The shape of each surface.** What is on screen at rest? What is the
  window actually *for* versus the dock versus the phone? Is the main
  view a board, a list, a feed, a timeline, a single focused thing, a
  split? Should the three surfaces even share a shape?
- **The concierge's physical presence.** How big, where, how much
  personality, what it looks like when idle, listening, speaking,
  thinking, or borrowing an expensive brain. Whether it's persistent
  chrome or something you summon.
- **How work reads.** Grouping, sorting, density, what a single unit of
  work shows at a glance versus on inspection, how state and ceremony
  are expressed, how you tell "waiting on me" from "grinding" from
  "done" without reading words.
- **The salience surface.** What a queue of unspoken things looks like,
  how you drain or mute it, how "speak / queue / silent" per event class
  is expressed and edited, and how silence itself is designed. An empty
  queue is the room working correctly.
- **The cost readout.** Whether spend is a number, a meter, a texture, a
  ledger, or ambient; how an escalation to an expensive brain is made
  legible and auditable; how honest estimates are distinguished from
  billed truth.
- **The artifact loop.** How a rendered diagram arrives, how you ask
  about it, how versions read, how "keep this" feels.
- **Material and voice.** Palette, type, motion, density, copy doctrine,
  how confirmation reads, what the product sounds like in text.
- **Rooms.** v1 has one, but the design must not hard-assume one.
  Attribution is your problem to solve gracefully.
- **What to cut.** Naming something today's UI should lose is a
  contribution, not a gap.

---

## Part 3 — Rules of the round

1. **One board per agent, drawn blind.** Do **not** read
   `docs/active/concepts-round-c/` — those are competing entries and
   reading them collapses the round into consensus. Read the
   architecture docs, this brief, and the current UI.
2. **Deliverable**: one self-contained HTML page (inline CSS, no external
   requests), published to Postplan. Show the surfaces — real layout,
   real hierarchy, real copy. Static mockups in HTML/SVG, not
   screenshots, not code.
3. **Price what you invent.** If your design implies a new subsystem
   (timing capture, a seek engine, a capture pipeline, new daemon
   capability), say so in one line with its cost. The last round's
   failure mode was subsystems presented as motion budget. A design that
   needs no new backend beats an equally good one that does.
4. **Include a decisions table**: what you chose, what you rejected, and
   the one-line tradeoff for each. This is the raw material for the pick
   matrix, and it matters as much as the pixels.
5. **Self-check against the ten anti-goals** before you publish, and say
   which one you came closest to violating.
6. **Have an opinion.** Convergent boards are worthless to this round.
   If you see a genuinely different reading of what this product is,
   draw *that*.

## What happens next

Boards get published side by side with a pick matrix, the owner picks a
base and grafts rows from the others, and *then* `design-ui-target.md`
gets written and locked from the winning mix. Only after that does the
React + shadcn mock get built, and only then do build steps 0–3 launch.

_(That sequence never happened — this round was rejected. See the v2
brief and, after it, a third round seeded with the owner's own visual
references. No target document exists.)_

[#73]: https://github.com/dougiefresh49/room-of-devs/issues/73
