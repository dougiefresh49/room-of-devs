# UI ↔ architecture map — what each piece on screen is actually rendering

_2026-07-31. Written for you, three months from now, staring at THE RIG
prototype and asking "why is that thing there?"_

Every surface in the prototype exists because something in the settled
architecture ([architecture-concepts/04–09](architecture-concepts/)) needed
a home. This doc walks piece by piece — desktop first, then the five phone
screens — and for each one answers four questions:

1. **What you see** — plain language.
2. **Why it exists** — the job it does for you.
3. **Architecture tie** — which concept it renders, with a link.
4. **Wire needs** — the fields in
   [`prototype/src/mock/types.ts`](../../prototype/src/mock/types.ts) it
   consumes. That file is the wishlist; those fields are the contract the
   daemon eventually has to provide.

Design spec for all of it:
[design-ui-target.md](design-ui-target.md) (§3 desktop, §4 plot, §5
mobile, §6 salience, §7 the two flows, §8 the day-1 cuts).

---

## The 60-second version of the architecture

One always-on concierge voice (**Mikey**) sits above everything. Under him
is an interpreter line that classifies what you say. Under that is the
**spine** — the task manager (GH issues + repo docs), which is the room's
only durable mind. Mortal **orchestration threads** pull work from the
spine, do it, write conclusions back, and die. Workers under them are
silent. Three dials configure the whole thing: **ceremony** (how much
process a thread runs), **voice** (who's speaking — Mikey, or a
checked-out second voice), and **brain tier** (how smart this one turn
gets). See [04-generalized-model.md](architecture-concepts/04-generalized-model.md)
for the layering and the settle rule, and
[05-rooms-brains-sentinels.md](architecture-concepts/05-rooms-brains-sentinels.md)
for the third dial, watcher threads, and saved verbs.

The UI's object grammar maps onto that one-to-one:

> **PILOT** (persona, from the room manifest) rides a **CRAFT** (one
> mortal thread, `T-####`) which is fed by a **CONDUIT** from its
> **PLAN** (the ticket) **DOCKED** on the spine rail.

The single question the console answers at a glance is **"how far is this
room from needing me?"** — that number is *salience*, and most of the
instruments are different magnifications of it.

---

# Desktop — the console

## FACEPLATE // CONCIERGE UNIT (`Faceplate.tsx`)

**What you see.** Mikey's face, big, in an amber CRT housing, with a talk
lamp and a waveform under it. Labelled ALWAYS ON // STATELESS.

**Why it exists.** He is the one thing in the room that never dies and
never has to be caught up. The faceplate is the "the room is here and
listening" anchor — the thing you look at when you talk.

**Architecture tie.** The voice layer of
[04](architecture-concepts/04-generalized-model.md). "Stateless" is
literal and load-bearing: Mikey survives every `/clear` *because* he
doesn't live in a context window — his mind is the spine (the settle-rule
table in 04, bottom row). This is also **Dial 2's home (VOICE)**.

**Wire needs.** `speakingPersona`, `mood` (drives the "stoked" frame at
the lull).

## DONNIE BAY (second-voice checkout, same file)

**What you see.** A smaller face bay that appears beside the faceplate
when a second voice is checked out, showing its purpose, elapsed time, and
"RETURNS ON 'THANKS DONNIE'".

**Why it exists.** Sometimes you want someone to *walk you through* a
plan, 1:1. The bay makes that borrowed voice visibly temporary — you can
see it's out, why, and how long.

**Architecture tie.** The checked-out voice in
[04](architecture-concepts/04-generalized-model.md) ("The checked-out
voice"): fresh context, not the plan's author, exists for one purpose,
settles with a written summary onto the ticket, then dies. It is the
*only* second voice — no huddles, no agents talking to each other
([07-not-building.md](architecture-concepts/07-not-building.md), items 2).

**Wire needs.** `donnieCheckout {purpose, elapsed}`, `speakingPersona`.

## THE SPINE // ENERGIZED RAIL (`SpineRail.tsx`)

**What you see.** The one big hunk of machined metal: a vertical rail with
energy flowing up it, plan cards clamped onto it, and thread nodes hanging
off the live plan on dashed conduits.

**Why it exists.** So the room's memory is a *place* you can see. Work
isn't a list of sessions; it's plans docked on a spine, with mortal craft
flying them. New work is born at the top of the rail; settled work bolts
on dark below.

**Architecture tie.** This IS the task-manager spine of
[04](architecture-concepts/04-generalized-model.md) — the green box, the
room's durable mind — with its mechanics detailed in
[08-spine-mechanics.md](architecture-concepts/08-spine-mechanics.md)
(tracker = index, repo = body, transcripts = raw history; nothing
important lives only in a context window). The dock states are the settle
rule made visual: live = holo projection, queued = dashed dim stem,
settled = the stem turns to a metal strut and the card becomes a dark
bolted plate. A spawning card reading "reads the spine, not anyone's
history" is the mortality property stated on-screen.

**Wire needs.** `plans[]` (`id, name, dock, steps, stepLabel, gearTag,
status, schematic`), `crafts[].planId`, `crafts[].oneOff`.

## PLAN CARD (`PlanCard.tsx`)

**What you see.** A blueprint-bed card on the rail: plan id and name, a
mini schematic, step bars (done / live / todo), and a gear tag.

**Why it exists.** A ticket you can read at a glance — what it is, how far
along, and how much process it's running.

**Architecture tie.** The ticket on the spine. The **gear tag is Dial 1's
home (CEREMONY)** — bare one-off vs light (spec→build→verify) vs full
Ptheory, per
[04](architecture-concepts/04-generalized-model.md) ("One layering, two
dials", item 1).

**Wire needs.** `Plan.*` (all of it), especially `gearTag` and `steps`.

## THREAD NODE + the open node (`ThreadNode.tsx`)

**What you see.** A card per running craft: 58px face, callsign,
`T-#### · TMUX ✓`, the task line, a state tag (WORKING / NEEDS YOU /
SETTLED / SPAWNING / EMPTY) and a timestamp. Click to expand and you get
the live tail, a spend strip, and a diff.

**Why it exists.** This is the row you actually act on — it tells you
whether a thread is fine, blocked on you, or done. Expanding is how you
look *inside* a running thread without interrupting it.

**Architecture tie.** A node is a **mortal orchestration thread**
([04](architecture-concepts/04-generalized-model.md)) — explicitly the
session, never the task (the task is the plan card above it). The
persona on it is a pilot, not a model: a persona is a voice + character +
spine access, per the third-dial section of
[05](architecture-concepts/05-rooms-brains-sentinels.md). Expanding a node
is **tap-in sense (b)** from
[design-ui-target.md §7.1](design-ui-target.md) — attaching to a running
thread to look around, over the existing `/thread` history + live-tail
machinery. The NEEDS-YOU state is one of the four operator gates that are
allowed to interrupt you at all
([04](architecture-concepts/04-generalized-model.md), "Tap-in, not
play-by-play": `blocker`, `needs-feedback`, `plan-review`,
`settled/failed`).

**Wire needs.** `Craft.*` — `persona, callsign, ticket, task, state,
salience, planId, lastStamp, holdSeconds, watched, open, tmux, tokens,
spendUsd, turns, tail[], diff, oneOff`.

## SALIENCE RING (`SalienceRing.tsx`)

**What you see.** The hero gauge: a segmented amber arc with a needle, a
draggable red threshold tab, a readout like `58% CLR · TH 35`, and
contributor lines below ("SPLINTER · PLAN HELD 06:41 −22").

**Why it exists.** It answers the console's one question — *how far is
this room from needing me* — as a single number, and it shows you where
the speak gate sits. Below the threshold, Mikey talks; above it, he waits
for the lull.

**Architecture tie.** The **salience filter** — the anti-chatterbox — is a
first-class box in the [04](architecture-concepts/04-generalized-model.md)
diagram, sitting inside the voice layer: speak now / queue for lull / log
silently. The ring is that filter's instrument. The number's definition
and v1 formula are specced in
[design-ui-target.md §6](design-ui-target.md): one daemon-computed integer
0–100 per thread, plus `salienceThreshold` from config. The smarter
roll-up (joining watcher alerts and ticket state) stays gated on #75.

**Wire needs.** `salience: {clearPct, threshold, contributors[]}`, plus
per-craft `Craft.salience`.

## THE CORE (`TheCore.tsx`)

**What you see.** A machined reactor: a hex shell whose lit fraction is
total spend draw, an energy ball whose size/brightness is how much of the
7-day window is still ahead, a "tightest guard" readout, two half-moon
dials (ElevenLabs 30-day cycle, Gemini month-to-date against *our* goal),
and a voice-chars odometer that rolls while burning.

**Why it exists.** Every clip costs real money and every provider has a
different clock. The CORE is the one glance that says "are we fine on
spend, and which provider is the tightest right now."

**Architecture tie.** This is the *cost honesty* thread that runs through
the whole architecture rather than one named box: the brain-tier dial in
[05](architecture-concepts/05-rooms-brains-sentinels.md) is explicitly "a
routing table, not model judgment," with **every escalation a logged event
with its cost** — the CORE is where those logs surface as a live read. It
also enforces the repo's standing credit-efficiency rules by making the
bill visible rather than discovered. The provider-window modelling
(session buckets vs rolling windows vs a self-imposed Gemini goal) is a
prototype-era refinement, documented in the `GuardWindow` /
`ProviderGuard` comments, not in docs 04–09.

**Wire needs.** `spend: {monthFraction, elevenlabsUsd, elevenlabsCap,
geminiUsd, geminiGoalUsd, voiceCharsToday, burning, windowResetFraction,
windowResetLabel, guards[]}` where each guard has `id, label, windows[],
sessionFraction`.

## REPLY DECK (`ReplyDeck.tsx`)

**What you see.** Three stacked cards: a text composer bound to a thread
("INJECT ⏎"), a push-to-talk bar with a mic-cold/mic-hot lamp and a green
speaker-grant chip, and the held-question keycaps.

**Why it exists.** Three ways to say something back, in one place, with
the cost and safety story printed on them.

**Architecture tie.** All three feed **one interpreter line** —
PTT/text → rules → flash router → command service — which is the
classifier in
[04](architecture-concepts/04-generalized-model.md)'s "two flows" diagram
(command / question / new work / talk-back / one-off ask). Specifics:

- The composer is **talk-back to a thread**, bound to the *ticket*, not
  the session — the same distinction 04 draws.
- PTT is the intent signal and privacy boundary; always-listening is an
  explicit anti-goal
  ([07-not-building.md](architecture-concepts/07-not-building.md), item
  5). "No open-mic state exists in the snapshot, by design."
- The grant chip renders the existing speaker-gate/grant flow; the
  daemon's claim markers stay the billing authority.
- **Held-question keycaps** are the `needs-feedback` operator gate turned
  into one-tap answers. The *armed* (glowing) key is Mikey's spoken
  recommendation. Voice matching is exact-grammar only in v1 — zero LLM
  per answer ([design-ui-target.md §8](design-ui-target.md), cut 3).

**Wire needs.** `heldQuestion {craftId, prompt, options[{id, label,
detail, speakHint, armed}]}`, `micHot`, `grantArmed`, `grantCountdown`,
`composerText`, `focusCraftId`.

## WATCH-ORDER CHIPS (`WatchChips.tsx`)

**What you see.** A dashed amber chip with a pulsing eye: "WATCH ORDER ·
T-#### · SAY 'STAND DOWN' TO CANCEL", plus a live clip ticker.

**Why it exists.** When you've asked to be kept in the loop on one thread,
you should be able to see that subscription — and cancel it by voice.

**Architecture tie.** The spoken-subscription rendering of the existing
live-mode machinery (`live.on`). Concept-side it's the near neighbour of
the **watcher thread** in
[05](architecture-concepts/05-rooms-brains-sentinels.md) — same
watch-then-push shape, same "stand down" verb — but a watch order is you
subscribing to a running thread, not a separate long-lived watcher thread
(those stay gated on #75).

**Wire needs.** `crafts[].watched`, `liveClip`.

## VERB RACK (`VerbRack.tsx`)

**What you see.** Machined toggle levers, one per saved verb, labelled
with the *utterance* you'd say. Watcher verbs are racked but wear a red
`GATED #75` tag and can't be flipped. Header: "NAMING IS CONSENT".

**Why it exists.** The room learns tools from conversation, and you should
be able to see the whole learned vocabulary in one rack — and delete from
it.

**Architecture tie.** Saved verbs in
[05](architecture-concepts/05-rooms-brains-sentinels.md) ("Saved verbs —
the room learns tools from conversation"): verbs live in the spine as
files, git-versioned and deletable; saving is always offered, never
silent, and you name it — which is the consent. Silent capability growth
is an explicit anti-goal
([07](architecture-concepts/07-not-building.md), item 10). The GATED tag
renders the hard sequencing gate: no watcher threads until the spine is
validated.

**Wire needs.** `verbs[] {id, utterance, params, on, gatedIssue}`.

## TURN CHIP (`TurnChip.tsx`)

**What you see.** A small chip: "DIAL 3 · THIS TURN: FLASH · $0.002 —
ROUTING TABLE, NOT JUDGMENT". When a tap-in is running, it expands to show
the question, the interpreter's classification, and the answer.

**Why it exists.** Every turn spends something. This is the receipt, and
it's where you catch the router escalating to an expensive brain.

**Architecture tie.** **Dial 3's home (BRAIN TIER)** from
[05](architecture-concepts/05-rooms-brains-sentinels.md): a persona is not
a set of weights — Mikey borrows brains per turn, escalation criteria live
in config, and every escalation is a logged event with its cost. The
tap-in expansion is **tap-in sense (a)** from
[design-ui-target.md §7.1](design-ui-target.md) — ask the room, answered
from the spine for pennies, heavy threads never woken
([06-scenario-flows.md](architecture-concepts/06-scenario-flows.md),
scenario 2).

**Wire needs.** `turnChip {model, costUsd}`, `tapIn {question,
interpreter, answer}`.

## CREW MANIFEST (`CrewManifest.tsx`)

**What you see.** Seven persona plates in amber CRT housings; lit = that
persona is piloting a craft right now, dark = on the rack.

**Why it exists.** Cast roster at a glance — who's out, who's available.

**Architecture tie.** The **cast** half of a room's manifest file in
[05](architecture-concepts/05-rooms-brains-sentinels.md) ("Rooms — Option
C arrives as configuration"): one lead voice plus alternates that exist
only for checkout. Crucially, being lit means *piloting a craft*, not
*talking in your ear* — the manifest is not a set of voices; it's the
persona pool.

**Wire needs.** `crew[] {id, callsign, role, piloting}`.

## DOCK MINI BAR (`DockMiniBar.tsx`)

**What you see.** The always-on strip (NSPanel in the real app): a 52px
blinking Mikey, a 16-segment salience LED bar with a red threshold notch,
a one-line ticker, three LEDs.

**Why it exists.** The ambient version of the whole console — the thing
that's on screen while you work in another app. It's the room's peripheral
vision.

**Architecture tie.** Same salience number as the ring, at the smallest
magnification ([design-ui-target.md §6](design-ui-target.md)). The red LED
is the arrival signal; the load-bearing rule is that arrival is *one
sentence at the lull, no siren*, unless the needle actually crosses the
threshold — the anti-chatterbox contract from
[04](architecture-concepts/04-generalized-model.md) rendered as restraint.

**Wire needs.** `salience.{clearPct,threshold}`, `dockTicker`,
`dockLedRed`, `mood`, `speakingPersona`.

## LONG-RANGE PLOT (`FieldPlot.tsx` on mobile, plot view on desktop)

**What you see.** A radar-style map: you are the fixed point at center,
each craft is a diamond blip, its distance from center is its salience.
A red pulsing ring marks the speak gate. Settled craft drift to the rim.

**Why it exists.** The spatial reading of the same one number. Anything
close to the middle is about to need you; the rim is fine.

**Architecture tie.** [design-ui-target.md §4](design-ui-target.md).
Radius = salience = distance-from-needing-you; the red circle is the
salience threshold at map scale. The spine renders at range as a
structure, and dashed one-off diamonds carry the Flow-1 rule from
[04](architecture-concepts/04-generalized-model.md) — no ticket, no
conduit, dies on delivery. The zoom ladder is a **contract, not a camera**:
three fixed views (PLOT ↔ RAIL ↔ NODE) with hard cuts, no pinch-zoom.
A second room renders dim; multi-room is deliberately a badge in v1
([§8](design-ui-target.md) cut 2).

**Wire needs.** `crafts[].salience`, `crafts[].plotAngle`,
`crafts[].oneOff`, `salience.threshold`, `view`.

## Load-bearing room moods

Three states change the whole console at once, and each encodes a rule:
**ARRIVAL** (node flares, needle drops, dock LED red — but only one
sentence, at the lull, unless the threshold is crossed), **MIC OPEN**
(everything else dims a stop — the mic being hot is a foreground fact,
never ambient), and **THE LULL** (spine green top to bottom, 100% clear,
Mikey's stoked frame allowed — reserved for real finishes). These render
the salience filter's three outcomes: speak now, queue for the lull, log
silently ([04](architecture-concepts/04-generalized-model.md)).

**Wire needs.** `mood`, `micHot`, `queuedForLull[]`.

---

# Mobile — THE FIELD UNIT

The phone is **not a small rig**. It's the field radio for a room that
keeps working while you're gone. Its jobs, in order: be spoken to → answer
from the pocket → glance → start work by voice. Deep surfaces (tails,
diffs, blueprints) stay on the big board, and the UI says so out loud —
"walk to the rig" is an honest handoff, not a missing feature
([design-ui-target.md §5](design-ui-target.md)).

Architecturally the whole unit is
[06-scenario-flows.md](architecture-concepts/06-scenario-flows.md)
scenario 4 — supervision from the phone — and it obeys the standing rule
that **no conversation state lives in clients**
([07](architecture-concepts/07-not-building.md), item 8): every screen
renders a snapshot and routes input.

## 1 · GLANCE (`GlanceScreen.tsx`)

**What you see.** A salience strip (`% CLR`, LED bar with threshold
notch, the biggest negative contributor as a DRAG readout), the polar plot
at arm's length, and thread rows you can tap. Header LEDs: SSE = connected,
AUD = this phone holds the speaker gate.

**Why it exists.** The "is anything on fire" screen. Two seconds, pocket
to answer.

**Architecture tie.** Salience again ([§6](design-ui-target.md)), at phone
scale — same number as the ring and the dock bar. The header LEDs are
deliberately the honest transport story rather than decoration.

**Wire needs.** `salience.*`, `crafts[]` (state, callsign, ticket, task,
persona, watched, salience, plotAngle), `audio.route`, `clock`.

## 2 · ANSWER (`AnswerScreen.tsx`)

**What you see.** The focused thread's row with a HELD timer, the question
Mikey is holding, big 44pt keycaps (the armed one glowing), the
conversation thread with the session's tail echoed under it, and the grant
chip.

**Why it exists.** The single most valuable thing the phone can do:
unblock a thread from the couch without opening a laptop.

**Architecture tie.** The `needs-feedback` operator gate
([04](architecture-concepts/04-generalized-model.md), "Tap-in, not
play-by-play") answered in one tap. The armed key is Mikey's spoken
recommendation. The text inject below it is talk-back bound to the ticket.
Keycap answering as a first-class command (with the mobile `/action`
allowlist) is P5 in [§9](design-ui-target.md).

**Wire needs.** `heldQuestion.*`, `focusCraftId`, `crafts[].holdSeconds`,
`crafts[].tail[]`, `transcript[]`, `grantArmed`, `grantCountdown`.

## 3 · LISTEN (`ListenScreen.tsx`)

**What you see.** The face IS the now-playing surface — a 148px lipsyncing
Mikey (Donnie swaps in on checkout), a synth light bar, a phone|mac audio
route toggle with a GATE HELD/OPEN readout, the transcript, a dim
"QUEUED FOR THE LULL" line, the watch chip, and free STOP + replay keys in
the dock.

**Why it exists.** Interruption is a **right, not a request**. If the room
is talking and you want it to stop, that's one 74px key away — and it
costs nothing, because the clip is already paid for.

**Architecture tie.** The audio path plus the speaker-gate/device-routing
machinery that already exists. The queued-for-lull line is the salience
filter's middle outcome made visible
([04](architecture-concepts/04-generalized-model.md)). The Donnie swap is
the checked-out voice at mobile scope — face + name only, no bay, no
controls ([§8](design-ui-target.md), cut 10). Lipsync stays cosmetic and
never becomes a "presence" subsystem
([07](architecture-concepts/07-not-building.md), item 4).

**Wire needs.** `speakingPersona`, `donnieCheckout`, `audio {route,
gateCountdown}`, `transcript[]`, `queuedForLull[]`, `crafts[].watched`,
`liveClip`, `mood`.

## 4 · START (`StartScreen.tsx`)

**What you see.** A transcript exchange (you / Mikey), an interpreter chip
reading `NEW WORK → FILE #### → SPAWN · FLASH $0.002 · LOGGED`, the
spawning row that persists once it materializes, and the verb rack as
tappable rows.

**Why it exists.** Start real work from anywhere, by talking. Also where a
tap-in question and its answer land.

**Architecture tie.** The interpreter's fan-out in
[04](architecture-concepts/04-generalized-model.md)'s two-flows diagram —
this screen shows the classification *out loud* (question → tap-in vs new
work → file a ticket → spawn), which is what makes the routing auditable
rather than magic. The verb rack is [05](architecture-concepts/05-rooms-brains-sentinels.md)'s
saved verbs; on mobile they're tap-to-run rows in v1, speech arrives with
cut 6 ([§8](design-ui-target.md)).

**Wire needs.** `tapIn {question, interpreter, answer}`, `transcript[]`,
`crafts[]` (spawning state, ticket, persona), `verbs[]`.

## 5 · GAUGES (`GaugesScreen.tsx`)

**What you see.** Two session dials (Claude, Codex — amber arc = the long
window, blue arc = this session's share), a guard board of rolling-window
tiles for the providers with no session reset (Cursor, ElevenLabs,
Gemini), the voice-chars odometer, and the three dials as **read-only
knobs** with their homes printed on them.

**Why it exists.** Spend awareness away from the desk — and a deliberate
refusal to let you change billing-adjacent settings by thumb. Changing a
dial is speech or the rig: "no pocket-dial disasters."

**Architecture tie.** Same cost-honesty story as THE CORE. The three knobs
are the literal index to the three dials from
[04](architecture-concepts/04-generalized-model.md) and
[05](architecture-concepts/05-rooms-brains-sentinels.md), each naming
where it actually lives (ceremony → plan card, voice → faceplate, brain →
turn chip) — which is why this screen doubles as the map you're reading
right now, in-product. Read-only is [§8](design-ui-target.md) cut logic
plus §5's mobile scope.

**Wire needs.** `spend.guards[]` (with `windows[]` and `sessionFraction`),
`spend.voiceCharsToday`, `spend.burning`, `turnChip`.

## FIELD DOCK + PTT pill (`FieldDock.tsx`, `PttPill.tsx`)

**What you see.** A dock riveted to the bottom of every screen: Mikey's
52px chip, then one segmented capsule — a chat key that slides a composer
up, and a HOLD TO TALK pill. On LISTEN it swaps in STOP + replay keys and
shrinks the PTT to a mic key.

**Why it exists.** One place to get words into the room, identical on
every screen, always in the thumb arc. Type it or say it is *one*
decision, so it's one control.

**Architecture tie.** The interpreter entry point, mobile edition — the
same line the desktop reply deck feeds. Two honesty rules are baked in:
the composer lands as a tmux inject bound to the ticket, and the PTT pill
**never fakes a hot mic** — pressing it shows an amber "VOICE LIVES AT THE
RIG" handoff, because phone STT isn't built yet ([§8](design-ui-target.md),
cut 6; red only ever mirrors the room's real MIC OPEN). Replay is free by
construction; nothing on this dock can re-bill.

**Wire needs.** `composerText`, `micHot`, `speakingPersona`,
`donnieCheckout`, `mood`.

---

## A note on what's pure aesthetics

Some of THE RIG has no architecture tie and doesn't need one: the corner
grammar (big top-left radius + bottom-right chamfer), the hex texture
layer, screws and bosses, hazard stripes, scanlines, the radar sweep, and
the amber-phosphor grade on every avatar. These are the visual system from
[design-ui-target.md §2](design-ui-target.md) — the "gunmetal chassis at
the corners, amber instruments carrying everything" rule. The binding
constraint is §2.6: **nothing animates from invented data.** Every moving
element is either driven by a real snapshot fact or is pure ambience.

---

## Not yet designed

Two known gaps, recorded here so they don't get lost:

**1. The ALL-PROJECTS VIEW** (owner-raised 2026-07-31). Today the console
shows one room. The real scenario is switching between projects — the
comic reader, podlink, room-of-devs — and knowing which one is talking to
you. The architecture already accounts for this: a **room** is a manifest
file (cast, spine pointer, gear default, connectors), the salience queue
is shared across rooms with room attribution, and there is one audio floor
globally
([05](architecture-concepts/05-rooms-brains-sentinels.md), "Rooms — Option
C arrives as configuration"). But the *UI* for it does not exist. What
exists today: [§8](design-ui-target.md) cut 2 says v1 renders one room
with others as a dim badge + count, and the plot has a single
"FUTURE: 10,000-FT VIEW — ROOMS AS A STARMAP · NOT BUILT" callout. That
callout is a placeholder, not a design. **No design exists for
multi-project switching, cross-room attribution in the dock strip, or how
a second room's threads appear on the plot.** This is the next design
round to spec.

**2. THE CORE / helix-orb visual polish.** The CORE currently reads as a
hex shell + energy ball + two half-moon dials, and it's the piece that has
been iterated on most (the "HARVESTER" name was already retired). The
provider-window model behind it — session buckets vs rolling windows vs a
self-imposed Gemini goal — got sharper than the visual did, and the desktop
CORE and the mobile GAUGES board are now telling the same story two
different ways. A revisit is owed: one visual language for spend across
both surfaces, and a decision on whether the orb stays a hex reactor or
becomes something else.
