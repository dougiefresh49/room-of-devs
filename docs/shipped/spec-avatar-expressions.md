# Avatar expressions, natural blinks, per-member replay

Round 3 of avatar life. Two halves: an ART half (new frames + a manifest,
produced by a separate agent) and a PANEL half (this spec's implementation
contract). The panel must degrade gracefully when any asset is missing — art
and code land independently.

## Frame vocabulary (per character, under panel/public/avatars/tmnt/<char>/)

Existing: `idle` (relaxed face), `speaking` (talking face, mouth open),
`mouth-mid` (talking face, half open), `mouth-closed` (talking face, closed).

New:
- `blink.png` — talking face, eyes CLOSED, mouth closed. Used as a 130ms
  natural blink.
- Expression sets, 3 frames each: `<expr>-speaking.png`, `<expr>-mouth-mid.png`,
  `<expr>-mouth-closed.png` — same character/framing, a personality-appropriate
  facial expression (eyes/brows consistent WITHIN the set; mouth is the only
  difference between the set's three frames).

## Manifest: panel/public/avatars/tmnt/expressions.json

Written by the art agent, read by the panel (fetch at startup, tolerate 404 →
neutral-only):

```json
{
  "michelangelo": { "excited": "stoked", "confused": "perplexed" },
  "raphael":      { "excited": "fired-up", "confused": "annoyed" },
  "splinter":     {}
}
```

Keys are the two MOOD FAMILIES the panel classifies (`excited`, `confused`);
values are that character's expression-set directory-name prefix (the `<expr>`
in the filenames). A character with `{}` (or absent) never leaves neutral.

## Panel behavior

1. **Per-message mood classification** (pure heuristic, no API): when a new
   nowPlaying arrives (non-ack), classify `rawText ?? text` once and cache by
   summaryKey:
   - `excited`: ≥ 2 `!`, or an all-caps word ≥ 4 letters, or superlatives
     (awesome/amazing/perfect/crushed/nailed/shipped it/boom).
   - `confused`: `?` count > `!` count, or hedges (hmm|not sure|strange|weird|
     unexpected|can't figure|confused).
   - else `neutral`.
2. **Frame resolution**: during that message's playback, the flap pair and gap
   frame come from the mood's expression set when the manifest maps it AND the
   three frames preloaded successfully; otherwise neutral set (current
   behavior). Preload expression frames listed in the manifest at startup with
   per-frame readiness tracking, like mouthMidReady.
3. **Blinks**: a lightweight scheduler gives each VISIBLE avatar an occasional
   blink — every 3.5–7s (randomized per avatar), swap to `blink.png` for
   ~130ms, then back. Blink only when the avatar is NOT mid-word (gap frames,
   paused, idle, hand_raised, working states all fine; skip if blink.png
   failed preload; skip during an expression-set message's open-mouth frames).
   Idle-room blinking is deliberate — the room should feel alive. Implement
   without re-rendering: same direct `src` mutation path as the lip-sync loop;
   one shared interval is fine.
4. **Per-member replay button**: in the idle-mode action cluster (dock hover,
   full-mode card, spotlight lingering row), add a replay button per agent that
   sends `{ type: "replay_session", sessionId }` (server support exists).
   Tooltip "Replay their last message". Disable/omit rather than error when
   irrelevant (e.g., keep it simple: always show; the server no-ops politely if
   that member has no replay history).
5. Paused freeze must keep working: paused → hold the mood-correct
   mouth-closed frame (blinks still allowed — a slow blink while paused reads
   as waiting, not talking).

## Gates

`cd panel && pnpm build` clean. Assets may be absent in your worktree — every
new frame path needs preload-failure fallback to the neutral equivalent.
Commit: `feat(panel): expression sets, natural blinks, per-member replay`.
Print decisions/deviations.
