# Spec: Mobile v2 — unified player + device routing

Status: FINAL 2026-07-18 (v2 — incorporates gpt-5.6-sol review [needs-rework → addressed] and grok-4.5 review [approve-with-changes → addressed]; reviews in session scratchpad `reviews/`).

Owner pain points: duplicate speaker card on grant, Play-vs-Grant confusion, "No replay for this member" dead ends, mystery ✋ button, no message clearing, no session spawning or replying from the phone.

## Background (verified against code 2026-07-18)

The mobile page is a single self-contained file `tts-server/mobile.html` served by `tts-server/src/mobile-http.ts` on `0.0.0.0:4785` (phone reaches it via `tailscale serve` at `http://dougiefresh49s-macbook-pro:8785` → `127.0.0.1:4785`). State pushes over SSE (`GET /events` → `buildPanelSnapshot()`); actions go through `POST /action` → `dispatchPanelAction()` (`panel-ws.ts`, whitelist `MOBILE_ACTION_TYPES` at 720-729) → shell scripts, spawned async (`{ok:true}` returned immediately — relevant for reply, see §7).

**The central fact: there are two independent audio planes.**

- *Phone audio* = the page's `<audio>` element playing saved replay MP3s over HTTP (`GET /replay-audio/<file>`). Replays are written by `audio.ts saveReplayFile()` when the Mac speaks a **streamed session item** (not cached phrases, not `playFile` replays); capped at 20 in `~/.cursor/tts/replay/`.
- *Mac audio* = ffplay/afplay child processes on the Mac (live ElevenLabs synthesis of queued items).

Today's UI exposes both planes on one card with no cue: **Play** = phone replay of the last *saved* message (`playForSession`, `mobile.html:1227`); **Grant** = Mac speaks the newest *queued* message (`grant_floor.sh:165` picks newest-by-basename → `play_node.sh`). They can be different messages. Confirmed bugs:

1. **Duplicate card**: `renderSpotlight()` renders the speaking session on top; `visibleAgents()` (`mobile.html:689`) doesn't exclude it → same session twice while speaking.
2. **Grant gives no phone-side feedback** (no toast; audio exits the Mac).
3. **Hold glyph never changes**: `mobile.html:1107` sets `"✋"` in both branches.
4. **Replay match strict on `sessionId`** (`mobile.html:1234`): after a `/clear` sessionId rotation, old-id sidecars don't match → "No replay for this member" (owner's screenshot showed an older build's wording) despite visible history.

## Design north star

Spotify Connect. One **player**, many **output devices**. Docked mini-player → tap to expand full-screen → chevron/swipe-down to collapse. A device chip always shows where sound is actually coming out.

## 0. Player state model (the load-bearing decision)

One discriminated client-side state drives ALL player chrome:

```
playerState: { kind: "none" }
           | { kind: "mac-live",     nowPlaying }         // Mac is speaking (snapshot-driven)
           | { kind: "phone-replay", entry, index }       // local <audio> on a replay file
```

- **Transport always follows `playerState.kind`**, never the output *preference*: `mac-live` → pause/stop dispatch `pause.sh`/`stop.sh`; `phone-replay` → the local `<audio>`. (The preference governs only where *Read update* routes — §1.)
- **Arbitration**: `mac-live` owns the player. When Mac playback begins while a phone replay is playing, pause the phone audio (remember position for manual resume) and switch to `mac-live`. Starting a phone replay while `mac-live` is active is blocked with toast "Mac is speaking — stop it first".
- Do NOT keep separate spotlight/sheet/mac-cluster state variables; render mini + expanded views from this one state.

## 1. Output device model

`localStorage.mobile_output_device`: `"mac" | "phone"`, default `"mac"` on first run (no prompt). Governs **only** where "Read update" (renamed Grant) plays a hand-raised message. Surfaced as the device row in the player (§2) and the sublabel on Read update buttons (§3).

**New server capability — grant-to-phone.** `POST /action {type:"grant", sessionId, output?:"mac"|"phone"}` (absent = `"mac"`, back-compat).

- **Validation**: `validatePanelMessage` currently rejects a third key on grant (`panel-ws.ts:475`, `keys.length !== 2`) — relax to allow optional `output` with those two literal values.
- **Plumbing**: `dispatchPanelAction` passes `CR_OUTPUT=phone` env through `grant_floor.sh` → `play_node.sh` → the node `once` path.
- **Pipeline invariants** (credit rules): dedup already happened at ingest (`ingest.ts:144`) and must NOT be rerun. `claimProcessing`, the mute check, and `waitForLock` (`index.ts:124,140`) stay exactly where they are, before Gemini/ElevenLabs. Grant-to-phone changes ONLY the sink after the existing claim → mute → Gemini → ElevenLabs sequence. It must reuse the single returned synthesis stream — never re-enter synthesis to produce the replay file. (Note: the existing `streamTTSWithTimestamps` → `streamTTS` fallback on error stays as-is; out of scope.)
- **Ordering contract (fixes the SSE race)**: for `sink:"none"` the daemon buffers the full stream, then (a) writes the replay MP3 + sidecar **first**, then (b) writes `.now-playing.json` carrying `output:"phone"`, `replayFile:"<exact filename>"`, and `grantId` (the queue-file basename), then notifies. The phone reacts to `nowPlaying.output === "phone"` by fetching and playing **exactly `replayFile`** — no timestamp matching, no clock skew.
- **Completion = timeout-only** (no ack endpoint): the daemon computes `expiresAt = startedAt + durationMs(from alignment last tuple; fallback 60s) + 5s slack`, keeps the session `speaking` and now-playing active until then, then runs the normal `endSessionPlayback` path (stamp `endedAt`, recompute state). Self-heals if the phone disappears. The **stream lock is released after save** (Mac is free; phone playback doesn't occupy the Mac's audio pipeline) — but a new grant while a phone-grant is unexpired is refused (toast) to keep one now-playing at a time.
- **Skip Mac-side meta audio** for phone output: no victory line (`index.ts:244`), no acks/phrases through Mac speakers as part of this grant.
- **Autoplay reality**: mobile browsers may reject `audio.play()` from an SSE callback. The Read-update tap **primes** the audio element inside the user gesture (play a muted zero-length source, keep the element unlocked); if playback is still rejected when the file arrives, show "Ready — tap to play" on the mini-player. Do not promise unconditional autoplay.

## 2. Unified player (replaces spotlight card, "PLAYING ON PHONE" sheet, and MAC AUDIO bar)

**Mini-player (docked).** Visible when `playerState.kind !== "none"` or a last-played entry exists. One row: avatar, name + one-line preview (marquee), device label ("Mac" in accent green when `mac-live`, "Phone" otherwise), play/pause. Tap elsewhere on the bar → expand.

**Expanded player (full-screen sheet).** Big avatar, karaoke transcript (reuse the existing alignment-driven code), progress bar (seekable only for `phone-replay`; `mac-live` read-only **with pause-anchor compensation** — wall-clock progress must freeze while paused, reuse the desktop panel's pattern since `pause.sh` doesn't touch `startedAt`), prev/next (phone replay browsing only; hidden in `mac-live`), device row (speaker icon + device name → picker: "Mac · Room" / "This phone"), collapse via chevron + swipe-down.

**De-duplication rule.** Member cards NEVER render playback transport. A speaking session's card shows a pulsing `SPEAKING` badge only. `renderSpotlight()` is deleted; `renderMembers()` renders every visible agent exactly once. No third chrome layer: exactly one mini-bar + one sheet.

## 3. Session cards — one primary action, state-driven

| State | Primary button | Behavior |
|---|---|---|
| `hand_raised` | **▶ Read update** (accent) + sublabel "on Mac"/"on this phone" | grant with `output`; toast "Reading on Mac…" or primed phone playback |
| `speaking` | none (badge only) | — |
| `idle` | **Replay last** (ghost style) | phone playback of last replay |

- **Queued preview on the card**: "Waiting: '<first ~120 chars>'" under the name when hand raised. Computed in `state-watch.ts` from the queue directory using **the same newest-by-basename selection rule as `grant_floor.sh:165`** (so the preview always describes the item a grant would speak). Exposed as `queuedPreview` on the snapshot agent. Not duplicated into `state.ts`.
- **Replay match fallback**: exact `sessionId` → newest sidecar with same `sessionName` → toast "No replays yet for <name>". (No prior-id lineage — `session_lineage.json` rekeys in place and retains no history; aliases are a future option if name collisions ever bite.)
- Hide/unhide unchanged.

## 4. Header / status row (replaces "MAC AUDIO:")

- Title row: "Room of Devs" + connection dot + overflow menu (⋮).
- **Room status pill** when held: "Room held ✋ — tap to resume" (amber, tappable). When live, "Hold room" lives in the overflow menu with a text label. (Kills the invisible glyph toggle.)
- Pause/Stop leave the header; they live in the player and act per `playerState.kind`.

## 5. Messages list

- **Clear messages** button beside "Catch up (N)": marks all current entries listened AND adds filenames to a `localStorage` hidden-set (`mobile_cleared_files`). **Prune the hidden-set against every refreshed replay list** (same pattern as the existing listened-set pruning at `mobile.html:728`) so it can't grow stale. Non-destructive; per-device; no server sync.
- Pending hand-raised items appear on the member card only (§3), NOT in Messages — Messages stays replay history.
- Catch-up unchanged.

## 6. New session from phone

- `GET /picker` (mobile-http, token-gated): `{dirs, resumable, personas}` from `session-catalog.ts` (`knownDirs`, `listResumable`).
- Picker sheet: New / Resume tabs, rows with persona chips (desktop semantics, `panel/src/main.ts openPicker()` as reference).
- `POST /action {type:"spawn_session", dir, persona}` / `{type:"resume_session", sessionId, dir, persona}`. **The current spawn/resume validation lives only in the WS `handleMessage` switch (`panel-ws.ts:879-907`) — extract it into shared `validateAndSpawn`/`validateAndResume` functions called from both the WS path and `dispatchPanelAction`**, then add both types to `MOBILE_ACTION_TYPES`. Dispatch to `team.sh` (tmux) as today.

## 7. Reply from phone (text box; Wispr Flow does voice)

- **Reply** on member cards (and expanded player): inline `<textarea>` + Send. Wispr Flow's floating mic attaches to any text field — voice is the phone's job; no whisper, no audio streaming.
- **Server**: replies need a real result, but `dispatch()` spawns async and returns `{ok:true}` unconditionally (`panel-ws.ts:119`, `mobile-http.ts:368`). Add a dedicated **synchronous** handler for `{type:"reply", sessionId, text}` (validate: session in snapshot, non-empty, ≤4000 chars) that runs `inject_prompt.sh --now <sessionId> "<text>"` (**flag first** — the script only accepts `--now` as `$1`, `inject_prompt.sh:21`) and maps exit codes to `{status:"ok"|"not_in_team"|"failed"}` for the UI.
- **Injectable badge**: snapshot gains `injectable: boolean` per agent derived from `team_map.json` presence only (no per-agent `tmux has-session` probes on snapshot builds; staleness surfaces as `not_in_team` at send time). Non-injectable cards show Reply disabled with hint "not in team room — respawn from + to enable".
- No undo window: typed text + Send is the confirmation; synchronous result replaces the delayed-action state machine.

## 8. Bug fixes rolled in

Spotlight/member dedupe (§2 architecture) · grant feedback toast + SSE state flip · hold glyph → textual pill (§4) · sessionName replay fallback (§3) · specific empty-state toast "No replays yet for <name>".

## Non-goals (v2)

No live audio streaming Mac→phone · no auth changes (token + tailnet reachability stays) · no framework/build step (`mobile.html` stays one file) · no replay-file deletion from the phone · no phone-ack endpoint (timeout-only completion) · no server-side cleared-messages sync · desktop panel unchanged except the shared validation refactor.

## Constraints for implementers

- **Credit rules**: one queue item = one pass through the existing synthesis pipeline regardless of output device. Never rerun ingest dedup; never reorder `claimProcessing`/mute/lock relative to API calls; never re-enter synthesis to build a replay. Test with API keys absent (fallbackClean + cached phrases) or `cd tts-server && pnpm exec tsx src/index.ts once <queue-file>` on short text.
- **Two-location gotcha**: edit in the repo. `tts-server.sh restart` syncs `src/*.ts` AND `mobile.html` (`tts-server.sh:23-30`); changed `scripts/*.sh` need `scripts/setup.sh` re-run.
- Gate: `cd tts-server && pnpm exec tsc --noEmit` clean; `bash -n` on changed shell scripts.
- Never mutate live playback state (`.playback-paused`, PID files, `.stream-lock`) during tests — fake sessions/staged files only.
