# Brief v2: redesign the live-mode UI — Sesame-style call view + chat view

Round 2. The v1 conversation view shipped and the owner tested it on a Pixel.
The fundamentals work (reply → ack on phone → working → final auto-plays) but
the owner's verdict: "the UI is extremely difficult to use and quite poorly
laid out, doesn't match any of the concepts." Read your previous concept and
the cross-reviews in <REPO>/docs/mockups/live-mode/ (REPO path given in your
prompt); the current implementation is the `#expanded.convo` section of
<REPO>/tts-server/mobile.html.

## What the owner saw (v1 failures, verbatim issues)

1. Top 1/3 of the screen is wasted: hero avatar (64px, centered, stacked),
   name, status, Go-live pill all stacked vertically. EVERY concept had a
   compact header row instead — small avatar LEFT, name+status beside it,
   live control RIGHT.
2. Bottom 1/4 wasted: a 3-line textarea plus a separate row with Cancel and
   Send buttons. Wanted: 1-line auto-growing input, inline send icon button,
   NO Cancel.
3. Idle thread shows big transport controls (speed pill + 56px play circle)
   even when nothing is playing. They must be hidden unless audio is active.
4. The owner's own sent messages don't appear in the idle thread (history
   came only from the audio replay catalog). All concepts showed both sides.
5. Live mode: the thread + banner + End-live pill + transport + reply box +
   keyboard all stack into an unusable mess on one screen.
6. Live mode with no intermediate messages = dead air: "working…" then
   nothing until the final. The agent's tool activity was invisible.

## The pivot: Sesame-style call view (owner's reference, sesame.com)

The owner uses the Sesame voice-companion app; screenshots described:

- **Call screen**: near-empty, calm. Name chip pinned top-center. Nothing
  else until content matters. Bottom row: end-call button (left), call
  timer, mic + bluetooth buttons (right).
- **Info card**: when the agent does work (e.g. answers a factual question),
  a single rounded card fades in mid-screen with the current result; a small
  "Looking for relevant images" pill shows the in-flight activity below it.
  One thing on screen at a time.
- **Send a text while in call**: the call view slides LEFT, a message thread
  slides in (history, input at bottom); back arrow returns to the call. The
  call continues (shrunk name chip + hang-up stay pinned top).

## Owner's target model for OUR app (their words, condensed)

Two surfaces for a reply-capable agent:

**Chat view** (default when opening an agent, and where replies happen):
- Compact header row like the v1 concepts (small avatar, name + status dot,
  Go live pill, collapse).
- Thread with REAL history — both agent messages and the owner's own sent
  messages (a server endpoint reading the session transcript now exists, so
  history is real, not localStorage scraps).
- In live mode, old messages show NO play buttons (history is reference).
  When not live, agent bubbles keep a small play affordance.
- 1-line growing input, inline send. No transport row unless a clip is
  actually playing (then a slim now-playing strip, not a hero circle).

**Call view** (live mode — the isolated Sesame-like screen):
- Agent avatar top-middle, larger, animation-ready (future lip-sync) — the
  avatar IS the presence, not a list item.
- Below/center: ONE card showing the current thing:
  - agent speaking an intermediate → that text (karaoke as it's spoken)
  - agent working silently → live tool/activity feed (display-only, free —
    e.g. "Editing mobile.html", "Running tsc", from the transcript tailer)
  - final response → the final card (spoken aloud automatically)
- No audio transport in call view. Stopping audio = End live. One button.
- Reply affordance ("send a text") slides to the CHAT view; back arrow
  returns to the call. (Keyboard lives in chat view only — this kills v1
  failure #5.)
- Cost visibility stays: subtle but persistent live indicator (edge glow
  and/or a small credits chip). NOT a full-width banner eating a row.

## Hard constraints (unchanged from round 1 + new)

- Real credit cost per synthesized clip: intermediates only while live is
  on. Tool-activity feed is DISPLAY-ONLY (no synthesis) — that's what fills
  the dead air discovered in testing.
- Replies are typed/dictated (existing input) — no voice streaming. Unlike
  Sesame, a careless prompt costs real tokens: the input stays deliberate
  (type → send), no push-to-talk in this round.
- Single <audio> element; one clip at a time.
- Vanilla JS/CSS in one HTML page; no frameworks. Pixel/Chrome, dark theme.
- The classic (non-team) expanded player is untouched.

## Deliverables (to your assigned output dir)

1. `concept.html` — self-contained, phone-framed (~390px), state switcher
   covering AT LEAST: (A) chat idle w/ history, (B) chat while a clip plays
   (slim strip), (C) call view — working w/ activity feed, (D) call view —
   speaking an intermediate (karaoke), (E) call view — final landed,
   (F) the call⇄chat slide transition (animated or two-state toggle).
2. `rationale.md` — max 40 lines: what you changed from your v1 concept and
   why, how the call⇄chat transition works, how cost stays visible without
   eating space.

Use the app's existing design tokens (read mobile.html: --bg #0f1115,
--surface #1a1d24, --border #2e3340, --text #e8eaed, --muted #9aa0a6,
--accent #3ecf8e, --karaoke #ffe566, avatars as rounded squares).
No live API calls. Do not edit the repo.
