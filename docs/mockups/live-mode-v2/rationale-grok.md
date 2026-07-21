# Live mode v2 rationale (Grok)

## What changed from v1
- **Split surfaces.** v1 jammed live into the chat sheet (thread + banner + End + transport + reply + keyboard). That was failure #5. Live is now its own **call view**; chat is the default and the only place the keyboard lives.
- **Dropped the classic dock.** Idle chat has no speed/play circle. Play lives on agent bubbles; a slim now-playing strip appears only while a clip is actually playing (state B).
- **Working is not empty.** Call view shows a display-only tool/activity feed (transcript tailer) so “working…” isn’t dead air — no synthesis cost.
- **One thing mid-screen.** Call body is a single card (intermediate karaoke, activity, or final) — Sesame’s info-card pattern, not a scrolling live thread.
- **Leaner mockup.** Shared panels + state attrs instead of duplicated A–D chrome. Kept green product language and armed “Go live” entry from chat.

## Call ⇄ chat transition
Go live slides the call panel in from the right. The message button slides chat back over the call; a **live pin** (back-to-call, name chip, timer, End) stays at the top so the call never feels abandoned. Keyboard/composer only exist on the chat panel — that kills the stacked-mess layout.

## Cost without eating space
No full-width banner. While live: phone **edge glow** + a small **credits chip** on the name pill (`live · ~N clips`). End live is the only audio stop — one red hang-up, no pause/scrub on the call screen.
