# Avatar lip-sync (frame-swap) + speaking emphasis

Goal: when an agent speaks, its avatar (a) grows so you can actually see it, and
(b) mouth-flaps in time with the words — PNGTuber style, zero live AI, driven by
the ElevenLabs word alignments the panel already receives in `.now-playing.json`.

## Assets

Existing per character: `panel/public/avatars/tmnt/<char>/{idle,speaking}.png`
(512×512). New third frame per character:

- `panel/public/avatars/tmnt/<char>/mouth-mid.png` — same exact character,
  framing, colors, background; mouth half-open (between idle's closed mouth and
  speaking's fully open mouth).
- Generated once via Gemini image edit (`gemini-3.1-flash-image`, REST
  `:generateContent`, image+text edit off `speaking.png`) — same pipeline as the
  original avatar task. Budget ≤ 12 calls total incl. retries. Normalize to
  512×512 PNG via `sips`.
- Characters (7): leonardo, raphael, donatello, michelangelo, splinter,
  shredder, karai.
- Panel must degrade gracefully: if `mouth-mid.png` 404s, fall back to 2-frame
  flap (idle ↔ speaking).

## Animation engine (panel/src/main.ts)

A single module-level loop; no React-style rerenders — mutate DOM directly.

- **Trigger**: `nowPlaying` present, no `endedAt`, and `nowPlaying.sessionId`
  matches an agent. Stop on `endedAt`, on nowPlaying change, or disconnect.
- **Clock**: `audioMs = (performance.now() - t0) ` where `t0` anchors to when
  the panel first saw this `startedAt`; divide by `nowPlaying.playbackRate`
  only if the existing caption/karaoke code does NOT already bake rate into
  alignment times — reuse whatever elapsed→alignment mapping the captions use
  (single source of truth; do not fork the math).
- **Frame rule** (alignment = `[word, startMs][]`):
  - Inside a word span (startMs ≤ audioMs < next word's startMs, capped at
    +900ms for the last word): alternate `speaking` ↔ `mouth-mid` every 120ms.
  - Gap ≥ 180ms between words: `idle` frame (mouth closed between phrases).
  - No alignment at all (fallback path): flap continuously at 140ms.
- **Targets**: every rendered avatar `<img>` for that session — dock avatar and
  full-mode card — findable via a `data-avatar-session` attribute added at
  render. Loop swaps `src` only when it changes (no thrash). `requestAnimationFrame`
  or 60–80ms `setInterval`; kill the timer when not speaking.
- **Preload** all three frames per character once at startup (`new Image()`)
  so first flap doesn't flicker.
- Re-render safety: a full `render()` may replace the `<img>` nodes at any
  time — the loop must re-query by attribute each tick, and `render()` must
  paint the correct current frame (not always idle) for a speaking agent.

## Speaking emphasis (style.css + minimal TS)

- Dock mode: on the speaking agent's avatar wrapper add class `speaking-pop` →
  `transform: scale(1.6) translateY(-7px)`, `transform-origin: 50% 100%`,
  `z-index` above siblings, `transition: transform 180ms ease-out`. The pill
  and dock window must not clip it: `overflow: visible` up the chain and, if the
  window itself clips, bump the dock window height headroom constant
  (`DOCK_COMPACT_HEIGHT` area in main.ts) by ~14px — verify against the
  hover-cluster and caption bubble which already float above.
- Full room mode: speaking card avatar gets `scale(1.18)` + existing ring; no
  layout shift (avatar container reserves the box; use transform only).
- Reverts cleanly when speaking ends (transition both ways).

## Acceptance

1. `cd panel && pnpm build` clean; `cd tts-server && pnpm exec tsc --noEmit` clean.
2. With a staged `.now-playing.json` (synthetic alignment, startedAt=now, no
   endedAt) + a `speaking` state file: dock avatar visibly enlarged AND the
   `src` cycles through speaking/mouth-mid/idle per the frame rule (verifiable
   by DOM inspection or timed screenshots).
3. On `endedAt`: avatar back to idle frame and normal size within 300ms.
4. Missing `mouth-mid.png` for a character → 2-frame flap, no console errors.
5. No change to server code, no Gemini/ElevenLabs calls at runtime — the
   feature consumes only data already broadcast.
