# Spec: Live mode + conversation view for reply-capable agents

> **SUPERSEDED** by [../shipped/spec-live-mode-v2.md](../shipped/spec-live-mode-v2.md) (2026-07-21). Server cost guards described here are still valid.


Owner ask (2026-07-20): replying to a tmux agent then tapping play "felt like
sending an email." Reply-capable agents should feel like an ongoing
conversation — closer to a call with transcripts. Opt-in per-agent **live
mode** speaks intermediate progress messages as the agent works; exiting
returns to normal single-play. Non-injectable sessions keep the existing
expanded player untouched.

Design source: three concept mockups (gpt-5.6, grok-4.5, fable) + cross-reviews
(scratchpad `concepts/`; keepers below). Final direction — **fable's thread
minimalism** (left/right bubbles, dim progress bubbles, in-thread ack chip,
working as inline thread state, no modal working card) + **grok's armed LIVE
button** (off → armed invite while working → on) and per-turn clip count +
**gpt's cost signaling** (edge glow + "LIVE — intermediates use credits"
banner). Green LIVE, not red. Word-karaoke only on the actively speaking
bubble. No scrubber in the conversation sheet; play chips live on bubbles.

## Server

### 1. Live-session store — `~/.cursor/tts/live_sessions.json`

`{ "<sessionId>": { "on": true, "since": iso, "toolCount": n, "turnStartedAt": iso|null } }`
Mirrors the muted_sessions.json pattern (flat file, atomic tmp+rename). New
module `tts-server/src/live-mode.ts` owns read/write. Added to state-watch.ts
root watch list; buildSnapshot() exposes per-agent `live: { on, toolCount }`.
Auto-off: on cleanupSession(), and when the transcript shows no new entries for
30 min (cost safety valve). Mute wins: a muted session is never live-spoken.

### 2. Toggle action

Mobile `POST /action { type: "set_live", sessionId, on }` → validatePanelMessage
(exact keys, boolean, session must be injectable) → dispatchPanelAction →
live-mode store write → snapshot broadcast. Also accepted over the panel WS.

### 3. Transcript tailer — `tts-server/src/live-tail.ts`

- On live-on: resolve transcript by glob `~/.claude/projects/*/<sessionId>.jsonl`
  (sessionId is globally unique; cache the hit). fs.watch the file; read from a
  byte offset; parse only complete new lines.
- Entry filter: `type === "assistant"`, not `isSidechain` (subagent chatter),
  content blocks `type: "text"`. Count `tool_use` blocks → toolCount.
- **Hold-one buffer** (avoids double-speaking the final message): a new text
  block is held, not enqueued. It flushes to the queue only when a *subsequent*
  transcript line arrives (proving it was intermediate). When the session's
  state flips to `hand_raised` (Stop hook fired → final path owns the text),
  drop the held text.
- Intermediate queue items: normal queue-file shape with `source: "live-cc"`.
  Dedup via the existing per-session hash file. No hand-raise, no notify.

### 4. Pipeline gates (index.ts)

- `source === "live-cc"`: process only if the session is still live (flag
  re-checked at processing time — flag off → move to played, no API calls).
  Auto-granted: sink `"none"` (phone stream via existing v2.3 first-chunk
  stamp + `/live-audio/`), `kind: "live"` on nowPlaying so the client can
  distinguish. Char cap 1000 (intermediates are narration, not essays).
- **Stale-skip**: before synthesizing a live item, if a newer `live-cc` item
  for the same session is already queued, skip the older one (move to played).
  Prevents backlog reading + saves credits.
- **Final auto-grant**: when a Stop-ingested item for a live session raises its
  hand, grant it to phone automatically (respecting the stream lock) — the
  owner just listens; no tap. Live OFF keeps today's tap-to-grant.

### 5. Ack routing to phone

- `handleReplyAction` (reply came from the phone) writes a 30s marker
  `~/.cursor/tts/.pending-phone-ack.json` `{ sessionId, at }`.
- `handleDynamicResponse` (fires on the resulting UserPromptSubmit): if a fresh
  marker matches the session, play the cached ack phrase to the **phone**:
  stamp nowPlaying `{ kind: "ack", output: "phone", ackFile: "<voiceId>/<file>" }`
  instead of ffplay. New route `GET /phrase-audio/<voiceId>/<file>` (traversal-
  guarded, mirrors /replay-audio/). Cached phrases only — never paid synthesis
  for acks (dynamic_responses "always" falls back to cached on the phone path).
- No marker → Mac ffplay exactly as today.

## Client (mobile.html)

### 6. Conversation sheet (injectable agents only)

`openExpanded()` branches: `agent.injectable` → conversation layout; else the
existing player DOM untouched. Layout: header (avatar + name + status dot +
LIVE button), scrollable thread, bottom dock (reply row always; slim
play/pause+speed row only when a finished clip is loaded and live is off; live
dock — pause + End live — when live is on).

Thread sources (client-assembled, no new server history API):
- Agent finished messages: replayList filtered by sessionId (existing catalog).
- My replies: stored locally on send (`localStorage` per session, cap 20).
- Ack chips: nowPlaying `kind:"ack"` frames for this session (also auto-play
  the clip when the sheet is open or live is on).
- Live progress bubbles: nowPlaying `kind:"live"` frames append dim bubbles;
  the speaking one gets word-karaoke from its alignment; done → "spoken ✓".
- Working row: agent.state === "working" → inline "Karai is working…" row with
  toolCount; the LIVE button glows (armed) in this state.

### 7. LIVE button + cost signals

Off (outline, "Go live") → armed (glowing "Go live" invite while agent works)
→ on (filled green "LIVE" + pulsing orb; phone-edge glow strip; banner
"LIVE — intermediates use credits · N clips this turn", where N is a plain
client-side count of live frames, no meter graphics — a meter implies a budget
scale that doesn't exist). Tapping toggles `set_live`; "End live" also in the
live dock. Entering live primes the audio element in the tap gesture.

### 8. Playback behavior in live

Each live/final frame auto-plays through the existing single <audio> live-
stream path (maybePlayGrantToPhone already handles output:"phone" frames; it
learns to accept kind live/ack when the conversation sheet or live flag is
active). Pause pauses the current clip only; new clips still queue. No scrub,
no prev/next in live. Exiting live returns the sheet to normal chips + slim
dock.

## Out of scope (this round)

- Mac Tauri panel: no conversation view (mobile-first); panel keeps working as
  is. Follow-up if the phone flow proves out.
- Hands-free voice; changes to the whisperflow reply input.
- History persistence beyond the replay catalog + local reply cache.
- Tool-level narration ("running tests…" synthesized from tool names) — only
  real assistant text is spoken.

## Cost guards (recap)

Tailer runs only for live sessions; intermediates synthesized only while the
flag is on (re-checked at processing time); stale-skip; 1000-char cap;
cached-only acks; auto-off on session end + 30-min silence; mute wins.

## Verification (no-credit)

- tsc --noEmit clean (tts-server, panel untouched); bash -n on touched scripts.
- Tailer unit-ish check: `pnpm exec tsx src/live-tail.ts once <transcript>`
  dev entry that parses a real transcript and prints would-enqueue decisions
  (no API keys → fallbackClean path anyway).
- End-to-end dry: with keys absent, enqueue a fake live item → verify gating,
  stale-skip, and nowPlaying stamps in hook.log; signal.ts replay for audio.
