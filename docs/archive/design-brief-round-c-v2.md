# Design brief v2 — the Room is a character, not a task manager

> Archived 2026-08-29: Round C play-round brief; the settled target is [active/design-ui-target.md](../active/design-ui-target.md).

**This brief replaces [design-brief-round-c.md](design-brief-round-c.md),
which failed.** Read the failure first, because avoiding it is most of
the job.

## What went wrong in round 1

Four capable models drew four boards and the owner's verdict was: *"text
heavy, nothing incorporates the avatars, pure 2014, those designs say
task manager. I can just tie stuff to Linear for that."*

That is the brief's fault, not theirs. It used the words *work board*,
*status surface*, *work item*, *ledger* — and then handed out a
tiebreaker saying a design that needs no new backend beats one that
does. Read together, that says "draw me a cheap Trello." So they did.
The persona — the entire reason this product exists — appeared as a
single bullet about a "presence component."

**Round 2 inverts the failure mode.** The owner would rather see *"whoa,
that's cool, but rein it in"* than *"oh god, not Trello."* Over-reach is
the desired error this round. Reining in is cheap and happens later;
timidity wastes the round.

---

## What this product actually is

An **animated character sitting on top of an agentic workflow.** It
started as visual and voice — TMNT personas with real voices reading
agent work aloud — and that is still the soul of it. The architecture
work in [04](architecture-concepts/04-generalized-model.md)–[09](architecture-concepts/09-spine-validation.md)
gave that character a brain and a memory. It did not turn the product
into a project tracker with a mascot.

So: **Mikey is the interface.** Not a widget in a rail. You talk to him,
he talks back, and he *shows you things*. The work happening underneath
is real and needs to be legible at a glance — but legible the way a ship's
display is legible, not the way a spreadsheet is.

The owner's own words for the target feeling, quoted because they're the
best spec in this document:

> "Like on desktop, I should see something futuristic looking… like all
> the space games and sci-fi movies show space maps and you touch part of
> the stars and it expands and there's more nodes etc… or like the AI
> memory map things, those are futuristic looking. Cards with data is
> totally fine but I just don't want it to be another freaking task board.
> I want to see a high level of the tasks that are in flight, or just talk
> to Mikey, have him show me the visuals, room for transcript, or he can
> give me a live feed of the terminal. Sky is the limit."

Star maps and memory graphs are **examples of a feeling, not a
requirement**. Don't all draw a constellation. Find your own answer to
"what does a living system of in-flight work look like when a character
is showing it to you."

---

## Non-negotiable this round

### 1. The avatar is on screen, animated, and load-bearing

`_avatar-frames.css` in this folder gives you the **real character art**
— Michelangelo (Mikey, the concierge) and Donatello (a checked-out
second voice) — downscaled and inlined as data URIs, with ready-made CSS
keyframes for a lipsync flip-book and a blink. Paste it into your
`<style>` and use it. A board with a grey circle where the face goes has
missed the entire point of round 2.

The publishing host **rejects `<script>` entirely**, so everything moves
via CSS: keyframes, transitions, transforms, `steps()`, SVG `<animate>`.
That constraint is smaller than it sounds — a flip-book lipsync, a
breathing glow, orbiting nodes, a sweeping scan line, and a pulse on
arrival are all pure CSS. **Make the page move.** A static screenshot of
a futuristic UI is not the same as a futuristic UI, and this round is
judged partly on whether it feels alive when it loads.

### 2. Show me, don't list me

The owner wants to **click into a visual and have it expand** — his star
example: touch a star, it opens, there are more nodes underneath. Our
reading, which you should design against and may improve on: a thing on
screen representing live work can be opened *in place* to reveal what's
actually happening inside it — the transcript, a live feed of the
terminal, a diff, an artifact Mikey rendered, the spend so far. Closing
it returns it to the constellation. Depth on demand, not a drill-down
into another page of rows.

Pure CSS can do this convincingly: `<details>`, `:target`, sibling
selectors, hover/focus-within. Show at least one element in both its
collapsed and expanded state.

### 3. Mikey shows you things

Diagrams he rendered, a terminal feed, a transcript, a diff, a plan
awaiting your approval. Design where that surfaces and how it feels when
it arrives. This is the product's central verb and round 1 treated it as
an "artifact card."

### 4. Desktop is where the ambition goes

The panel main window is the hero. Draw it big and draw it properly.

**Mobile: keep it light this round.** The owner is still thinking about
what the phone should be, and his current instinct is "mostly the voice
interface with the Mikey avatar, plus him showing where we are." Give it
one screen, voice-forward, avatar-forward. Do not build a phone
information architecture; do not port the desktop. A thin, beautiful,
obviously-unfinished phone screen is the correct amount of phone.

**The dock** (a small always-visible strip; a macOS panel that never
takes focus) still matters — it's the ambient, glanceable presence when
the main window is closed. Make it feel like something is alive in the
corner of the screen.

### 5. "Live" is a conversation, not a mode

Delete the idea of a separate live/call screen. The real behavior the
owner described:

> "Mikey, I need live updates on that prod bug fix. Keep me posted on
> diagnosis and updates."

That's a **subscription you ask for in words**, after which Mikey narrates
that one thread's progress as it happens, until you tell him to stop.
Design what that looks and feels like — how you know he's watching
something for you, how it reads when updates arrive, how you call it off.

---

## Still true (the architecture, unchanged)

These come from decisions already made and are not up for redesign. They
constrain *what is true*, not *what it looks like*.

- **One voice.** Mikey is always there, cheap, and stateless — his memory
  is the tracker plus the repo, not a context window. Occasionally a
  second voice is **checked out** for a specific 1:1 purpose (walk me
  through this plan), is visibly temporary, and disappears when done.
  **At most two faces on screen, ever**, and voices never talk to each
  other — only to you.
- **The work underneath is silent by default.** Threads don't chatter.
  They surface through Mikey when something genuinely wants you: a
  blocker, a question, a plan to approve, a finish. Everything else waits
  for a lull or is only ever logged. **Controlling that is a real
  feature** — today every finished turn gets spoken, and killing that
  default is a big part of why this round exists.
- **Three dials exist** and need to be visible somewhere, in some form:
  how much process a piece of work gets; which voice is speaking; and how
  smart (and expensive) the current turn is. That last one implies spend
  is visible — this repo has always guarded API cost — but "visible"
  does not mean "a table of numbers." Make it ambient if that's better.
- **Push-to-talk, never always-listening.** Every mic capture starts with
  a deliberate press. It's the privacy boundary and the cost control.
- **No real-time ink or canvas drawing.** Things Mikey shows you are
  rendered files with versions, not a shared whiteboard with strokes.
- **Clients render, the daemon decides.** No conversation state lives in
  the UI; every pixel derives from a snapshot the daemon sends.
- **The work surface mirrors the tracker; it never becomes one.** No
  drag-to-transition, no lanes, no process designer. If it looks like
  something you'd manage a sprint in, you have failed this round twice.

**One anti-goal is deliberately relaxed.** The old rule that lipsync must
stay strictly cosmetic and "never drive presence" was written to prevent
scope creep, and in round 1 it helped produce four faceless boards. For
this round, presence and animation are the *point*. The real constraints
that remain are narrow and technical: avatar frames get swapped by
reference (never re-rendered through the React tree), and we're not
building a gesture or emotion-inference engine.

---

## Wide open — go

The shape of every surface. What the primary thing on screen even is.
How in-flight work is represented spatially. Depth, motion, dimension,
material, palette, type. Whether surfaces share a shape or diverge on
purpose. How the character behaves when idle, listening, speaking,
thinking, or spending real money. What silence looks like. What arrival
feels like. What you cut.

**On cost:** round 1's "needs no new backend wins" tiebreaker is
**revoked** — it suppressed exactly the ambition we want. Still note in
one line anything that needs real new engineering, so we know what we're
buying. But propose it. We'll rein in.

---

## Deliverable

ONE self-contained HTML page. Inline CSS and inline SVG only; **no
`<script>`, no forms, no iframes, no external requests of any kind** —
the host rejects them, so a CDN font simply won't load. Embed the avatar
CSS from `_avatar-frames.css`.

Include:

- **A name and a one-sentence thesis.**
- **The desktop main window, drawn large and in detail**, in its
  load-bearing states: at rest with work in flight; Mikey speaking;
  something waiting on you; your mic open; and one element expanded to
  show what's inside it.
- **The dock strip**, alive.
- **One phone screen**, voice- and avatar-forward, deliberately thin.
- **A short decisions table**: what you chose, what you rejected, the
  one-line tradeoff.
- **One line on anything needing real new engineering.**
- **A "what I'd cut if you told me to rein it in" note** — name the two
  or three most expensive ideas and what the cheap version of each is.
  This is how the owner gets to say "cool, but less" without losing the
  concept.

**Do NOT read `docs/archive/concepts-round-c/`** — that's the rejected
round, and reading it will pull you straight back into the aesthetic
we're trying to escape. **Do not read the other v2 boards** in this
folder either; this round is blind on purpose.

Be strange. Be specific. Draw the thing you'd want open on your own
second monitor all day.
