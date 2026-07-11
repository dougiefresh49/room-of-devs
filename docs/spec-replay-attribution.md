# Replay attribution + replay_slower (tts-server only)

Goal: "Replay latest" should light up the room like live speech — speaking state,
spotlight, mouth flap, live controls — because replays are free and should feel
first-class. Currently `replayLast` plays with ctx `"meta"`, so the panel sees
nothing.

## Scope

`tts-server/src/audio.ts` and `tts-server/src/panel-ws.ts` ONLY. Do not touch
panel/. NO Gemini/ElevenLabs calls anywhere — replay must stay a pure local
file playback.

## 1. Session-attributed replay (audio.ts)

In `replayLast(nth, speedFactor)`:

- The target `.mp3` has a `.json` sidecar next to it (same basename) with
  `ReplayMeta` — load it (tolerate missing/corrupt → behave as today).
- If the sidecar has a `sessionId` AND a state file exists for it under
  `STATE_DIR` (a dead session must not resurrect a ghost card): play with
  ctx `{ sessionId }` instead of `"meta"`, passing the sidecar as the
  `ReplayMeta` so `beginSessionPlayback`/`writeNowPlaying` publish
  name/rawText/alignment. Otherwise keep `"meta"` exactly as today.
- **playbackRate correctness**: `.now-playing.json`'s `playbackRate` must be
  the atempo factor ACTUALLY applied to ffplay in THIS replay (the panel maps
  wall time → alignment timeline by multiplying by it). The replay mp3 is the
  raw streamed audio; whatever atempo the replay path applies (config
  default_speed × the `speedFactor` argument, or however `playFile`/
  `playMp3Buffer` compute it today — read the code, don't guess) is the value
  to publish. The sidecar's stored `playbackRate` describes the ORIGINAL
  playback, not this one — do not copy it blindly.
- Speaking state on the session must set on start and recompute on close —
  the existing `beginSessionPlayback`/`endSessionPlayback` pair handles this if
  wired through; verify the ctx path you use actually calls them.
- Interrupt semantics unchanged (replay replaces current playback).

## 2. `replay_slower` WS message (panel-ws.ts)

- New message `{ type: "replay_slower" }` (validation: exactly 1 key, like
  `replay`).
- Dispatch mirrors `runSignalReplay()` but passes speed `0.8`:
  `pnpm exec tsx src/signal.ts replay "" 1` → same with a trailing speed arg —
  read signal.ts's arg parsing to pass it correctly.

## Gates

- `pnpm exec tsc --noEmit` clean.
- Free end-to-end check allowed and encouraged:
  `cd ~/.cursor/tts/tts-server && pnpm exec tsx src/signal.ts replay "" 1`
  after copying your changed src there — then confirm `.now-playing.json` has
  the replayed session's id + alignment and the session's state file flips to
  speaking and back. (This plays a short audio aloud once — acceptable.)
  If you'd rather not run it, static-verify carefully and say so.
- Commit message: `feat(server): session-attributed replay + replay_slower dispatch`.
