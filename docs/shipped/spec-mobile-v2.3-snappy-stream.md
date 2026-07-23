# Spec: mobile v2.3 — snappy phone playback + speed button

Status: FINAL v2 (2026-07-19). Reviewed by grok-4.5 + gpt-5.6 Sol; v1's
Range-over-growing-file design replaced per review (a finite Range response
can't model a live resource on iOS — it fires `ended` at the first boundary).

## Problem

Grant-to-phone takes 45–60s to audio with a forced second tap:
1. `playStreamToPhone` (audio.ts ~:479–555) buffers the ENTIRE ElevenLabs stream
   and only stamps `nowPlaying.replayFile` after the full MP3 is written (~30s).
2. By then iOS rejects the delayed `play()` as autoplay → "Ready — tap to play".
3. `/replay-audio/` serves 200 + pipe with no Range/Content-Length; iOS buffers
   the whole file before starting (~10–15s more).
Applies to any surface granting with output=phone (mobile page on phone or
desktop). The Mac ffplay sink already streams in ~1s and is NOT touched.

## Design: two delivery modes

**Live mode** (synthesis in flight): a chunked HTTP endpoint tails the growing
file — the "radio stream" model iOS handles natively. **Static mode** (complete
file): the existing `/replay-audio/` endpoint upgraded with Range support for
instant start, scrub, and resume.

### Server — audio.ts

- Progressive replay writer: split `saveReplayFile` into open/append/finalize.
  Open `replay/<ts>_<label>.mp3.part` on first chunk, append with awaited
  backpressure, rename to `.mp3` + write final sidecar at stream end. Pruning
  and `/replay-list` must ignore `.part` files.
- Initial sidecar written at open time with everything known pre-synthesis
  (sessionId, sessionName, character, rawText, textPreview, timestamp) so the
  catalog entry the client picks up is never empty (Sol 1.4). Alignment,
  spokenText, playbackRate merged in at finalize (atomic replace).
- `playStreamToPhone`: after the FIRST chunk is written, stamp
  `writeNowPlaying(..., { replayFile, grantId, synthesisComplete: false })`.
  At finalize: re-stamp with `synthesisComplete: true` + real duration/alignment
  (SSE must broadcast this even though nowPlayingKey doesn't change).
- **`onPersisted` (queue retirement) stays at successful finalization** — the
  billed item is only moved to played/ once audio is durably complete (grok 5,
  Sol 1.5). On stream error: delete/mark the `.part`, do NOT retire the item,
  clear the stamp.
- Phone grant window: while `synthesisComplete:false`, don't let the 60s
  no-alignment fallback (audio.ts ~:109–117) expire the grant early; extend the
  window until finalize + normal duration logic.
- Mac ffplay sink unchanged (no progressive-tee refactor — no latency benefit,
  risks the drain logic; grok 12, Sol 1.14).

### Server — mobile-http.ts

- `/replay-audio/<file>` (complete files): honor `Range` → 206 +
  `Accept-Ranges: bytes` + `Content-Range` + correct `Content-Length`; 200 +
  `Content-Length` otherwise.
- NEW `/live-audio/<file>` (in-flight files): chunked response, no
  Content-Length. Send bytes already on disk, then tail the growing file until
  finalize, then end the response. Support `?from=<bytes>` to resume from an
  offset (ElevenLabs MP3 output is CBR, so bytes ≈ seconds × bitrate/8 — good
  enough for reconnect). 404 if neither `.part` nor final file exists; if the
  file completed, redirect (302) to `/replay-audio/`.

### Client — mobile.html

- `maybePlayGrantToPhone`: if `synthesisComplete === false`, set `audio.src` to
  `/live-audio/<file>` and play (stamp now arrives ~1s after the tap, so the
  original gesture usually still covers it; keep the `phonePendingTap` fallback).
  If complete (e.g. replay of an old entry), use `/replay-audio/` as today.
- Live-mode rules:
  - Scrub: allow backward seeks within `audio.buffered`; no forward-past-edge.
  - Intercept `ended`/`stalled` while `!synthesisComplete`: NEVER run
    onTrackEnded / mark-heard / catch-up advance; instead reconnect
    `/live-audio/?from=<offset>` and resume (cache-bust the URL).
  - Pause in live mode: on resume, if now complete → swap src to
    `/replay-audio/` and seek to saved `currentTime`; else reconnect live from
    the saved offset.
  - On the `synthesisComplete` SSE tick: update duration/alignment; let the
    current live stream play out naturally (it ends when the server closes);
    treat its `ended` as a real track end from that point on.
- Progress math: `currentTime`/`duration` are media time — never multiply by
  rate for the progress ratio; only wall-clock estimates use rate (Sol 1.6).

## Speed button (feature)

- Replace `btn-restart` (mobile.html ~:1018; handler `restartTrack` ~:1938;
  binding ~:3069; visibility ~:1712) with `btn-speed` in the same grid slot.
  Text label showing current rate ("1×", "1.25×", …), ghost style. Cycle
  1.0 → 1.25 → 1.5 → 1.75 → 2.0 → 1.0 on tap.
- Effective rate = `entry.playbackRate (baked residual) × chosen multiplier`;
  set `audio.playbackRate` to that product. Persist multiplier in localStorage;
  apply on subsequent tracks.
- Disabled (dimmed) while `!synthesisComplete` (a live stream can't sustain >1×
  — it would starve at the edge) and on the Mac plane (rate is baked/atempo
  there). Enabled for static-mode phone playback.
- `restartTrack()` removed; `#i-rotate-ccw` symbol STAYS (used by the loading
  spinner, mobile.html ~:1555).

## Non-goals

- No MediaSource/HLS (fallback option if physical-device testing rejects
  chunked MP3 — not expected; radio streams are the precedent).
- No Gemini/ElevenLabs usage changes; dedup/mute ordering untouched; API calls
  still happen exactly once per grant.
- Mac live pipeline (ffplay stdin) unchanged.

## Verification (cheap, no API spend)

- `pnpm exec tsc --noEmit` clean.
- Range: `curl -H "Range: bytes=0-99" -sD - -o /dev/null .../replay-audio/<existing>.mp3` → 206.
- Live endpoint without synthesis: simulate a growing file by appending an
  existing replay MP3 into a `.part` in chunks with a shell loop; curl
  `/live-audio/` and confirm tail-until-finalize + `?from=` offsets.
- Grant flow: fake-session state only (verification hygiene); one short live
  `enqueue_manual.sh` check (<200 chars, once) at the very end.
- Phone UX (spinner gone, ~1–2s start, speed cycle) verified via
  codex-computer-use afterwards.
