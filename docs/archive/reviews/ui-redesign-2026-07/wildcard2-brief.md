# Design brief — "Room of Devs" (open concept pass, round 2)

You're designing a personal tool for one developer. Deliberately short
brief: we want to see where YOU take it. No other designs exist as far
as you're concerned. Do not look at any source code or other design
files in this or any directory besides this brief; no network calls.

## The product, in essence

The developer runs several AI coding agents at once. This tool turns
them into a **room of characters** — the TMNT cast — each with a voice.
When an agent finishes something, its character says it out loud. The
developer mostly *hears* the room while doing other work, *glances* at
it occasionally, and sometimes *talks back* — holding a key or a card to
speak to one agent, or giving the room voice commands ("pause the room,
then replay Donnie's last message") that get carried out as a little
plan. Agents sometimes finish and wait politely for attention, or need
a decision before they can continue.

It lives on the Mac (a window, plus some small always-visible presence
while the dev works in other apps) and on the phone (check the room,
listen, reply, start new agents from the couch). It's playful — the
characters matter — but it's a serious daily tool the developer stares
at all day.

## Where this is headed

These four capabilities are the product's near future. Design them as
**first-class, structural parts of your concept** — not bolt-ons or
footnotes. How they fit should shape your whole direction:

1. **Screen awareness.** The developer can let an agent see what
   they're looking at — "look at this error", "what do you think of
   this page" — a quick, consentful glance at the screen, as natural
   as turning your laptop toward a coworker.
2. **Drawing.** Agents can sketch — an on-the-fly diagram, a boxes-and-
   arrows explanation, a scribble over a screenshot — and the developer
   can draw back. Explaining with pictures, both directions.
3. **The group call.** Several agents and the developer in ONE
   conversation — a real multi-voice call where characters can build on
   each other, not sequential monologues into separate threads.
4. **Typed replies + attachments, everywhere.** On the Mac you can type
   to an agent instead of speaking (headphones on, hear the reply — or
   pure text, silent room). Every place you can reply — Mac or phone —
   accepts a pasted image or file.

Design the experience. You decide what the surfaces are, what deserves
prominence, how sound and sight relate, how the characters express
state, what the phone is *for*. Surprise us — the interesting outcome
is a direction we haven't considered, not coverage of an assumed
feature list.

## Constraints (the only ones)

- Audio is the primary channel; the UI is its companion.
- Character avatars are images that can swap frames for lip-sync.
- One small Mac surface must stay visible over other apps without ever
  stealing focus.
- Phone use is one-handed.
- Implementation will be React + Tailwind + shadcn/ui — but do NOT let
  that limit the concept.

## Deliverable

EXACTLY ONE fully self-contained HTML concept board written to the
output path you were given: inline CSS, no external requests, system
fonts, placeholder avatars (initials in colored circles — don't draw
turtles), real sample copy (never lorem ipsum), responsive with no
horizontal page scroll. Include: your thesis, your tokens (palette +
type), mockups of every surface you propose, and a short rationale.
Opinionated beats complete.
