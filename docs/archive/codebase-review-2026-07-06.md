# Codebase Review — 2026-07-06

Scope: `tts-server/src/*.ts`, `plugins/cursor-read-aloud.5s.sh`, all of `scripts/`, `config/`.
Weighting: API credit efficiency first, then correctness, then perf/cleanup. This is a personal tool — no production-hardening recommendations.

## Top items at a glance

| # | Severity | Area | Finding |
|---|----------|------|---------|
| C1 | High | Credits | "Start Over" / rewind key re-runs the full Gemini + ElevenLabs pipeline instead of replaying the mp3 already saved in `replay/` |
| C2 | High | Credits | Every `UserPromptSubmit` fires a Gemini call + ElevenLabs TTS (when a character voice is active) with no mute check, no config toggle, no caching |
| C3 | High | Credits | When Gemini fails, up to 4,800 chars of barely-cleaned raw markdown is sent to ElevenLabs v3 anyway |
| B1 | High | Bug | `loadConfig()` uses file *length* as its cache key — a voice-ID change (always 20 chars) is invisible to a running server |
| B2 | High | Bug | Node server writes `.stream-playback-pid`, but pause/media-key/Now-Playing/Hammerspoon all read `.playback-pid` → playback controls are dead for the primary streaming path |
| C4 | Medium | Credits | Stopped/failed playback leaves the queue file in place; re-clicking it re-buys the same Gemini + TTS even though the audio is already in `replay/` |
| B3 | Medium | Bug | `playStreamBuffer` has no `error` handlers — missing ffplay wedges the queue forever; killing playback mid-stream risks an unhandled EPIPE crash of the watcher |
| B6 | Medium | Bug | `tts-server.sh stop` kills the `pnpm` wrapper PID (with `kill -9` fallback) — can orphan the actual `tsx` watcher → two watchers → double API spend |
| P1 | Medium | Perf | SwiftBar plugin spawns up to ~13 `python3` interpreters every 5 seconds; 5 of them just to read `config.json` |

---

## 1. API credit efficiency (top priority)

### C1 — HIGH: "Start Over" re-buys Gemini + ElevenLabs for audio you already have
- `scripts/restart.sh:27` → `play_node.sh` → `tts-server/src/index.ts` (`once` mode) → `processWithGemini` + `streamTTS`. Same for the Hammerspoon PREVIOUS media key (`config/hammerspoon-tts.lua:197-204` runs `restart.sh`).
- But `audio.ts:206-213` already saves every streamed playback as an mp3 + metadata in `~/.cursor/tts/replay/` (kept 20 deep). Restart of a message that just played = a second full Gemini call and a second full ElevenLabs charge for identical text.
- **Fix direction:** have `restart.sh` stop current playback and play the newest file in `replay/` (or match by queue filename in the replay meta), falling back to the full pipeline only if no replay exists. Note the replay file is only written on ffplay close, so "restart mid-playback" needs stop-then-replay ordering.

### C2 — HIGH: dynamic prompt-acks cost Gemini + ElevenLabs on *every* prompt, ungated
- `scripts/hook_prompt.sh` → `signal.ts:15-18` → `dynamic-response.ts:88-127`. If the resolved voice has an entry in `characters.json` (i.e. your default voice is a character), **every prompt you submit in every Claude Code session** triggers one Gemini `generateContent` and one ElevenLabs stream (~100+ billed chars each).
- No checks at all on this path: `signal.ts` never consults `muted_sessions.json` (a muted session still speaks acks and questions), there is no `streaming_enabled`/dedicated config toggle, and the free cached-phrase path (`playRandomPhrase`) is only used as a *fallback* rather than the default.
- Same for `hook_ask_user.sh` → `handleAskUser` (`dynamic-response.ts:129-193`): Gemini + TTS per AskUserQuestion, no mute check. Worse, on Gemini failure it streams the **raw question text** — question + every option label + description — to ElevenLabs (`dynamic-response.ts:151, 184, 191`), which can be long.
- **Fix direction:** (1) check `loadMutedSessions()` in `signal.ts` before doing anything; (2) add a config flag like `dynamic_responses: "always" | "cached" | "off"`; (3) invert the default — play a cached phrase most of the time and only generate fresh acks occasionally (e.g. 1 in 5), or cache generated acks and reuse; (4) for ask-user fallback, truncate to the question line only.

### C3 — HIGH: Gemini failure path sends near-raw markdown to ElevenLabs v3
- `index.ts:112-114`: `processWithGemini(...) ?? fallbackClean(item.text)`. `fallbackClean` (`gemini.ts:94-104`) only strips fenced code, headers, bold, inline backticks, links — it keeps file paths, bullet lists, tables, code-like lines. Result then goes to `truncateForTTS` (4,800 cap) and straight to v3 TTS.
- So a Gemini hiccup on a long response = up to 4,800 chars billed on the *expensive* v3 model for audio that reads paths and table pipes aloud.
- **Fix direction:** the good cleaner already exists — `scripts/clean_text.py` does tables→prose, code-line stripping, path humanization. Port `clean()` to TS for the fallback, and/or use a much lower char cap (e.g. 1,200) when Gemini failed, or skip TTS and only notify.

### C4 — MEDIUM: stopped/failed playback strands the queue file → replays re-buy credits
- `index.ts:147-152`: `moveToPlayed` only on ffplay exit code 0. Stopping playback (stop.sh, media key) yields nonzero exit → the file stays in `queue/`. Credits for Gemini + TTS were already spent and the mp3 is saved in `replay/`, but clicking the item in the menu later runs the entire pipeline again.
- **Fix direction:** once `streamTTS` succeeded, move to `played/` regardless of playback exit code (the user chose to stop it; replay exists in `replay/`). Optionally log "stopped" in the replay meta.

### C5 — MEDIUM: full raw response sent to Gemini with no input cap
- `index.ts:113` sends `item.text` unbounded (`truncateForTTS` runs *after* Gemini). A 50k-char agent response is all billed as Gemini input even though the spoken output is capped at ~4,800 chars. Flash-lite is cheap, but it's free to pre-truncate.
- **Fix direction:** cap input at ~3–4× the TTS cap (e.g. 15–20k chars) before calling Gemini; same in `scripts/gemini_process.py:192`.

### C6 — MEDIUM: clicking a voice in the menu silently spends 8 TTS generations
- `set_voice.sh:46-49` and `set_session_voice.sh:52-55` background-run `phrases.ts`, which generates 8 phrases via `generateTTS` for any voice without a cached set (`phrases.ts:43-58`). Browsing/auditioning voices from the SwiftBar submenu burns ~8 ElevenLabs calls per previously-unused voice, invisibly.
- **Fix direction:** generate lazily on first `playRandomPhrase` miss, or make it an explicit menu action ("Generate phrases for this voice").

### C7 — LOW: `generate_sfx.sh --force` regenerates everything and never prunes
- `generate_sfx.sh:56-92`: with `--force`, all 12 prompts are generated (12 SFX API calls) but old files are never deleted (`--force` skips the count check *and* the existing files stay). "Regenerate All SFX" grows `sounds/default/` forever and random picks still include the old sounds you wanted replaced.
- **Fix direction:** on `--force`, clear the directory first (or move old files aside).

### C8 — LOW: v3 character limit vs. 4,800 truncation — worth verifying
- `index.ts:48` truncates to 4,800; `play.sh:142` comments "v3 has a 5000 char limit". If the current `eleven_v3` per-request limit is lower (it has been 3,000 in some releases), long messages fail with a 400 after the Gemini call already ran, then strand the file (see C4/B5). Verify against current docs and align the constant.

---

## 2. Real bugs

### B1 — HIGH: `loadConfig()` cache keyed on file *length*, not mtime
- `config.ts:48-58`:
  ```ts
  const mtime = existsSync(CONFIG_PATH) ? readFileSync(CONFIG_PATH).length : 0;
  if (cachedConfig && mtime === configMtime) return cachedConfig;
  ```
  Two problems: (1) it reads the entire file just to compute the "cache key", so the cache saves nothing; (2) any same-length edit is invisible. ElevenLabs voice IDs are always 20 chars, so `set_voice.sh` **has no effect on a running server** until some other edit changes the file length or the server restarts. Same for speed changes like `1.25 → 1.75`, `"auto" → "none"`-style same-length swaps.
- **Fix direction:** `statSync(CONFIG_PATH).mtimeMs` as the key; only read+parse on change.
- Related dead code: `invalidateConfigCache` (`config.ts:64-67`) is exported but never called anywhere.

### B2 — HIGH: PID-file split-brain — playback controls dead for the streaming path
- The Node server writes `.stream-playback-pid` (`config.ts:17`, `audio.ts:200`). But:
  - `plugins/cursor-read-aloud.5s.sh:12,57-62` — `IS_PLAYING`, therefore the Pause/Start Over/Stop section and "Now Playing" line, reads `.playback-pid`
  - `scripts/pause.sh:8` — pause/resume reads `.playback-pid`
  - `scripts/media_control.sh:12` — media key smart toggle reads `.playback-pid`
  - `config/hammerspoon-tts.lua:8` — `ttsPlaybackAlive()` reads `.playback-pid`
- Only legacy `play.sh` writes `.playback-pid`. Since the Node server is the primary path, pause, the ⏯ media key toggle, and the "Now Playing" menu section silently never work during normal playback. (Only `stop.sh` checks both files.)
- **Fix direction:** either have `audio.ts` also write `.playback-pid`, or make the four readers check both files (SIGSTOP/SIGCONT works fine on ffplay).

### B3 — MEDIUM: `playStreamBuffer` has no error handlers — hangs or crashes
- `audio.ts:195-226`: no `child.on("error", ...)`. If `ffplay` isn't installed/on PATH, spawn emits `error`, `close` never fires, the promise never resolves → `drainQueue` is wedged forever (and the stream lock is held until the 120s steal).
- Also no `child.stdin.on("error", ...)`. When the user stops playback mid-stream (stop.sh kills ffplay), the next `child.stdin.write(chunk)` at `audio.ts:218` can emit an unhandled `EPIPE` `error` event on the socket, which crashes the whole watcher process. The `try/catch` around the loop only catches iterator errors, not async stream-error events.
- Same shape in `playMp3Buffer` (`audio.ts:247-271`).
- **Fix direction:** add `child.on("error", () => resolve(1))` and `child.stdin?.on("error", () => {})`, and consider a resolve-once guard.

### B4 — MEDIUM: 120s lock steal is shorter than a long message's playback
- `audio.ts:57-73`: `waitForLock` force-steals the lock after 120s and writes its own PID over a *live* holder. A 4,800-char message is ~4–5 minutes of audio. Concretely: click a message from a notification (`once` process holds the lock and plays for 5 min) while the watcher has a queued item — after 120s the watcher steals the lock and plays **over** the current audio; both "holders" then fight over `releaseLock`.
- **Fix direction:** raise the timeout above max playback length (e.g. 10 min), or check whether the holder PID is a live ffplay session before stealing.

### B5 — MEDIUM: failure paths strand queue files forever
- Files stay in `queue/` when: voice unset (`index.ts:102-105`), stream/TTS failure (`index.ts:132-135`), playback exit ≠ 0 (`index.ts:151`), JSON parse failure (`index.ts:81-84`), or the session is muted and never manually played. The watcher uses `ignoreInitial: true` (`index.ts:211`), so after a server restart these files are never revisited — but they permanently inflate the menu-bar queue count and keep the "queued" icon lit. Only `played/` has retention cleanup (`cleanup_played.sh`); `queue/` has none.
- **Fix direction:** on unrecoverable errors move the file to `played/` (or a `failed/` dir); optionally scan the queue dir once on startup instead of `ignoreInitial: true` (mute/dedup checks already make that safe).

### B6 — MEDIUM: stopping the server can orphan the real watcher process
- `tts-server.sh:51-53` stores the PID of the `nohup pnpm start` wrapper; `stop_server` (`:67-91`) TERMs it and falls back to `kill -9`. `pnpm start` runs `tsx` as a child — SIGKILL on the wrapper definitely orphans the `tsx`/node watcher, and TERM-forwarding through pnpm is not guaranteed. An orphaned watcher keeps consuming queue files invisibly; after a restart you have **two** watchers racing on every file (the `.processing` marker narrows but doesn't eliminate the double-Gemini/TTS race — both can pass the `isProcessing` check before either calls `markProcessing`, `index.ts:75-97`).
- **Fix direction:** launch `node_modules/.bin/tsx src/index.ts` directly under nohup (so the PID file holds the real process), and/or kill the process group (`kill -- -$pid` after `set -m`).

### B7 — LOW: pkill patterns match nothing; `index.ts stop` can't stop streaming
- `audio.ts:88` pkills `'ffplay.*cursor-tts'` and `stop.sh:43` pkills `'ffplay.*cursor-tts-stream'` — but the ffplay cmdline is `ffplay -nodisp -autoexit -loglevel quiet -i pipe:0` (`audio.ts:182-189`); neither pattern can ever match. Consequently `tsx src/index.ts stop` (`index.ts:188-192`) run as a fresh process (where `currentProcess` is null) stops nothing except… every `afplay` on the machine (`audio.ts:93` `pkill -f afplay` is system-wide and will also kill unrelated afplay users and in-flight notification SFX).
- **Fix direction:** read `.stream-playback-pid` in `stopCurrent()` and kill that PID; drop the bogus pkill patterns (or tag ffplay with a marker arg you can match).

### B8 — LOW: queue filename collision within one second
- `ingest.ts:105-107` (`${epoch}-cc-${shortSession}.json`) and `ingest.sh:44-47`: two responses in the same epoch second for the same session overwrite each other. Rare, but a subagent + main-response burst can hit it. Add ms or a counter.

### B9 — LOW: wrong file can be notified after Claude Code ingest
- `ingest_claude_code.sh:181` notifies `ls -t "$QUEUE_DIR"/*-cc-*.json | head -1` — the newest cc file overall, which under concurrent sessions may not be the file this run wrote (the Python block knows the exact path but doesn't return it). The Node path (`ingest.ts:125-135`) does this correctly.

### B10 — LOW: `phrases.ts` CLI self-detection is fragile
- `phrases.ts:78`: `import.meta.url === \`file://${process.argv[1]}\`` breaks for relative invocation or path-encoding differences → the generate block silently doesn't run and voices end up with no cached phrases (which then makes every prompt-ack fall back to silence, or worse, pushes you toward the paid dynamic path). Use `pathToFileURL(process.argv[1]).href`.

### B11 — LOW: signal.ts playback ignores the stream lock
- `signal.ts` → `handleDynamicResponse`/`handleAskUser` → `playStreamBuffer` without `waitForLock()` — prompt acks and question readouts can talk over queue playback in progress.

---

## 3. Efficiency / performance

### P1 — MEDIUM: SwiftBar plugin spawns ~10–13 python3 interpreters every 5 seconds
Counted per refresh in `plugins/cursor-read-aloud.5s.sh`:
1–5. Five separate `python3 -c` calls to read the *same* `config.json` (lines 32–36)
6. Now-Playing line (line 145, when playing)
7. Queue listing heredoc (line 172, when queued)
8. Replay listing (line 311, when replays exist — effectively always)
9. Voice-name lookup (line 391)
10. Voice submenu (line 412)
11. Session-voices submenu (line 471)
12. Notification-sound submenu (line 590)
13. Credits parse (line 687) — plus `fetch_credits.sh` itself (another python3 on cache-miss)

That's ~150k+ interpreter launches/day for a menu. **Fix direction:** collapse lines 32–36 into one python call that prints all five values (`print(speed); print(vid); ...` → `read -r` them), and longer-term emit the whole menu from a single python script. Also `fetch_credits.sh`'s curl (line 39) has no `--max-time`, so a bad network can hang the entire menu refresh on cache-miss.

### P2 — LOW: every hook spawns `pnpm exec tsx` (cold TS toolchain)
- `hook_stop.sh:26`, `hook_prompt.sh:31`, `hook_ask_user.sh:58`, `play_node.sh:22` each pay ~1s+ of pnpm+tsx startup. `hook_prompt.sh` adds that latency to *every prompt you submit*. Since the watcher daemon is usually already running, a cheap alternative is dropping signal files into a watched directory (the chokidar watcher is already there) instead of booting a new Node per event. At minimum, `replay.sh:19` uses `npx tsx` (can hit the network) while everything else uses `pnpm exec tsx` — make it consistent.

### P3 — LOW: Cursor ingest does heavy per-response work
- `ingest.sh` parses the same stdin payload with 5 separate python3 spawns (lines 29–42), then scans **every** directory under `~/Library/Application Support/Cursor/User/workspaceStorage`, opening `state.vscdb` SQLite DBs, per response (lines 127–159). One python process doing payload parse + title lookup would do; the title lookup result could also be cached per conversation_id.

### P4 — LOW: `ingest.ts` fixed 800ms sleep vs bash 1s
- `ingest.ts:92` sleeps 800ms on every Stop hook before reading the transcript (bash fallback sleeps 1s, `ingest_claude_code.sh:32`). Harmless but this stalls hook completion; a short retry loop ("re-read until an assistant entry newer than N appears, max 1s") would usually return immediately.

---

## 4. Cleanup / dead code

### D1 — Piper-era leftovers (project migrated to ElevenLabs)
- `scripts/piper_http_launch.sh` — only referenced by the Piper LaunchAgent template.
- `config/com.local.piper-tts-server.plist.template` + `setup.sh` §3 (lines 52–58) and §7 (lines 162–179) install-and-load logic.
- `set_listening.sh:21-40, 48-70` — `piper_port`, `wait_for_piper`, launchctl load/unload of the Piper agent on every listening toggle (its header still says "unload Piper to free RAM").
- Config keys: `sfx_categories` (`config/config.json:11`, `setup.sh:126`) is read by nothing — `generate_sfx.sh` hardcodes its prompts. `model`/`piper_port` referenced only by the Piper scripts.
- **Fix direction:** delete the Piper scripts/template and the related setup/set_listening blocks; drop `sfx_categories`.

### D2 — `lookupSessionName` implemented four times
- `config.ts:125-129` (via `getActiveSessions`), `ingest.ts:14-29`, the plugin's python `lookup_session_name` (`cursor-read-aloud.5s.sh:207-225`), and `ingest_claude_code.sh:142-159`. The two TS copies should share `config.ts`'s (the ingest one differs only in defaulting to "Claude Code").

### D3 — Three parallel ingest implementations, two parallel playback pipelines
- Claude Code ingest exists as `ingest.ts` (primary), `ingest_claude_code.sh` (fallback), with duplicated transcript-parsing/dedup/session-name logic. `play.sh` (291 lines) re-implements the whole Gemini→ElevenLabs→playback pipeline in bash (including its own chunking) and is only reached if pnpm is missing (`play_node.sh:20-26`) — but it drifts (e.g. it doesn't check `muted_sessions`, doesn't save replays, no character support). Given pnpm is required for everything else anyway, consider deleting `play.sh` + `gemini_process.py` (its Gemini prompt is a stale copy of `gemini.ts`'s) and letting `play_node.sh` be the only path. Keep `clean_text.py` — it's used by `notify_queued.sh` for previews (and is the best cleaner in the repo; see C3).

### D4 — Small dead code in tts-server
- `config.ts:1` imports `writeFileSync`, never used. `index.ts:7` imports `TTS_DIR`, never used. `package.json` dependency `dotenv` unused (custom `loadEnv`). `config.ts:98` uses `require("fs")` inside an ESM module — works only because tsx shims `require` (verified); `readdirSync` is already importable at the top like everywhere else.
- `shouldAddPrefix(config, sessionId, title)` (`index.ts:59`) never uses `sessionId`.
- `restart.sh:3` comment says "Re-run play.sh" but it calls `play_node.sh`.

### D5 — Inconsistencies
- `replay.sh` uses `npx`; everything else `pnpm exec` (see P2).
- `plugins` PID/paused/audio ref filenames are duplicated string literals across audio.ts, plugin, and five shell scripts — one wrong copy already caused B2.
- `elevenlabs.ts` clamps speed to 1.2 and `playStreamBuffer` compensates with `atempo`, but `playMp3Buffer`/`playFile`-of-replays apply no tempo compensation → replays and phrases play slower than live playback when `default_speed` > 1.2.

---

## 5. Minor robustness (cheap fixes only)

- **M1** — `hook_prompt.sh:22` / `hook_ask_user.sh:25` use `read -t 1 PAYLOAD`, which reads a single line; a multi-line prompt payload truncates → JSON parse fails → prompt treated as empty (falls back to a cached phrase — at least it fails cheap). Use `PAYLOAD=$(cat)` (hooks close stdin) or parse stdin directly in python.
- **M2** — `isDuplicate` (`ingest.ts:63-73`) is a single global slot: alternating responses from two sessions never dedup (fine), but two sessions finishing with the same text (e.g. "Done.") in sequence dedup across sessions. Key the hash file by session ID if it ever annoys you.
- **M3** — `setup.sh:84` does `rm -rf` + full `pnpm install` of the server on every run; `tts-server.sh sync_source` (lines 23–29) copies `src/*.ts` but not `package.json`, so a dependency bump silently requires a full re-setup. Cheap fix: also copy `package.json` and run `pnpm install` when it changed.
- **M4** — `stop.sh` deletes `STREAM_LOCK` unconditionally (line 49) even if a live watcher holds it — harmless today (the holder's `releaseLock` no-ops on mismatch) but it lets a second processor start mid-pipeline; consider leaving the lock alone and letting the owner clean up.

---

## Tally

- **High:** 5 (C1, C2, C3, B1, B2)
- **Medium:** 8 (C4, C5, C6, B3, B4, B5, B6, P1)
- **Low:** 15 (C7, C8, B7–B11, P2–P4, D1–D5 grouped, M1–M4 grouped)

Biggest wins for credit spend, in order: fix restart-to-replay (C1), gate/cached-default the prompt-ack path (C2), harden the Gemini-failure fallback (C3), and move stopped items to `played/` (C4). Biggest correctness wins: mtime cache key (B1) and unifying the playback PID file (B2).
