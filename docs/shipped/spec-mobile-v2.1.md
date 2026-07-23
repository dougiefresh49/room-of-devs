# Spec: Mobile v2.1 — device handoff, player polish, picker fixes

Status: FINAL 2026-07-18. Addendum to spec-mobile-v2.md after owner's real-device testing round. Fixes 12 owner-reported issues + adds live device handoff.

## A. Output device: visible before playback + live handoff

1. **Header device toggle** (owner's doodle): a compact two-segment icon toggle in the header row (laptop icon | smartphone icon), always visible, left of the connection dot. Drives `localStorage.mobile_output_device`. Selected segment gets the accent treatment. This is THE place to pick output before playback; "Read update" sublabels keep reflecting it.

2. **Expanded player layout change**: device row moves DOWN below the transport controls (Spotify pattern — see owner's reference screenshot). It shows the actual current source (green when Mac) and tapping the other device performs a **live handoff**, not just a preference change.

3. **Handoff semantics (Spotify model — pause at position, resume on other device):**
   - **Mac → phone**: client captures `macElapsedMs` → POST `{type:"stop"}` → server drains the remaining synthesis stream to completion (see B1) and saves the FULL replay, stamping `replayFile` into the ended now-playing (B2) → client sees `endedAt` + `replayFile` via SSE → plays that exact file locally, seeked to the captured position (rate-adjusted: divide by `playbackRate`). UI shows "Moving to this phone…" on the player until audio starts (autoplay-primed by the tap that initiated the switch).
   - **Phone → Mac**: client pauses local audio at `currentTime` → POST `{type:"play_replay", file, offsetSec}` (B3) → Mac plays the same replay MP3 from that offset. Client clears local playback (the mini-player flips to mac-live when now-playing appears).
   - Handoff only offered when a track is actually loaded/playing; otherwise the row is just the preference toggle mirror.

## B. Server changes

1. **Full-drain on early stop** (`audio.ts` ffplay path): when the player process is killed (stop button / handoff) before the stream ends, KEEP consuming the ElevenLabs stream into `replayChunks` until it completes (bounded: 90s hard cap), then save the complete replay + sidecar as usual. Credits are already spent on the full message — never save a truncated file again. The stream lock may release at player-kill (so the room isn't blocked by draining); guard against the next playback starting mid-drain clobbering state (drain continues detached; only the replay save + now-playing replayFile stamp happen at completion, and the stamp is CAS on matching sessionId+startedAt).
2. **`replayFile` on all session now-playing records**: when a session playback's replay is saved, stamp `replayFile` into `.now-playing.json` (live if still current, or into the endedAt record — CAS as above). This makes mac→phone handoff (and future features) possible for every message, not just phone grants.
3. **New action `play_replay`**: `{type:"play_replay", file, offsetSec?}` in MOBILE_ACTION_TYPES. Validate: `file` is a bare filename that exists in `~/.cursor/tts/replay/` (no path separators), `offsetSec` finite ≥0. Refuse if something is currently playing (stream lock held) — return 400. Plays via ffplay `-ss <offset>` with the sidecar's session attribution (writes now-playing so the room lights up, kind/state as a normal replay). Free — no synthesis.
4. **`GET /picker` adds `projectsDirs`**: `[{name, dir}]` — directories directly under `~/projects` (skip hidden), so the mobile picker can start a session in any project, not only known dirs. Cheap `readdirSync` at request time.

## C. Client (mobile.html)

1. **Icon system**: replace ALL emoji glyphs with inline SVG icons (lucide outline style, `stroke="currentColor"`, 24px viewBox): play, pause, skip-back, skip-forward, rotate-ccw (restart), laptop, smartphone, chevron-down, plus, more-vertical, send, x. Transport buttons lose their background fills — ghost/borderless icon buttons; ONLY the central play/pause keeps a filled circle (Spotify-style, accent). Mini-player icons get the same treatment.
2. **Mini-player**: NO karaoke, NO marquee — static one-line text preview (CSS ellipsis) + a thin (2-3px) progress bar along the mini-player's top edge + device glyph + play/pause icon. (Kills the lightning-speed flying transcript.)
3. **Expanded player layout** (top→bottom): chevron; avatar (smaller than v2 — leave room); session name; **Transcript | Message toggle** — Transcript = existing karaoke view; Message = the sidecar `rawText` (fallback `spokenText`) rendered as scrollable prose; progress bar + times (seek by tap AND drag for phone playback); transport row: restart · prev · play/pause · next; **device row below transport** (A2). No background colors on chips/buttons beyond the accent play circle and the active device highlight.
4. **Transport correctness**: play/pause NEVER reloads the source — strict pause()/play() toggle on the loaded file; only the restart button (and track end → play) starts from 0. Fix the current inconsistency where play sometimes restarts.
5. **Messages header**: remove "Catch up" button → ⋮ overflow item "Catch up (N unheard)". Clear stays; first tap shows inline confirm "Hide all from this list? Audio files stay on the Mac." with Confirm/Cancel.
6. **Picker sheet**: body scroll-lock while open + `overscroll-behavior: contain` (background must not scroll); persona chips become avatar-image chips (48px avatar, selected ring, name as tiny caption under); New tab gains an "All projects" section from `projectsDirs` below known dirs.
7. Everything else from v2 unchanged (cards, reply, hold pill, clear pruning).

## D. Constraints (unchanged from v2 + notes)

- Credit rules absolute: B1 spends ZERO new credits (the stream is already billed); `play_replay` is free; no new synthesis paths. claim/mute/lock ordering untouched.
- Single-file mobile.html, no framework, no icon-font/CDN — SVGs inlined once as `<symbol>` defs + `<use>`.
- Gates: `pnpm exec tsc --noEmit`, `bash -n` changed scripts, inline-JS parse check.
- Verify with fake sessions/staged replays only; the ONE live check allowed is a stop-mid-playback drain test on a short message if needed.

## Backlog (docs/reference/ideas-backlog.md)

- Mobile lip-sync in the expanded player (alignment-driven frame swap; desktop code exists in panel).
