# Implementation Spec: Phases 1-2 (Hand-Raise Mode + Voice Control)

*Companion to docs/plan-room-of-devs.md — 2026-07-06 — rev 3 — post multi-agent review*

Everything below follows house style: filesystem state (JSON files, flag files, PID files), no servers or databases beyond the existing tts-server daemon, and no new API spend paths without an explicit note.

**Environment facts verified while writing this:**

- `~/.claude/sessions/*.json` is written by Claude Code itself and already contains `pid`, `sessionId`, `cwd`, `name`, and `status: "busy"|"idle"` — this does a lot of work for us (state derivation, session→process mapping).
- Installed: Raycast, ffmpeg (mic capture via avfoundation). NOT installed: tmux, whisper.cpp, skhd, Superwhisper. Phase 2 setup needs `brew install tmux whisper-cpp`.
- Hammerspoon is banned (owner removed it). The stale hammerspoon references in comments in `audio.ts`/`config.ts` can be cleaned opportunistically.

---

## Phase 1 — Hand-Raise Mode

### 1. Config / mode design

Add to `Config` in `tts-server/src/config.ts`:

```ts
playback_mode: "auto" | "announce" | "silent";   // default: "auto"
```

**Interaction with `streaming_enabled` (migration path):** one derived accessor, used everywhere instead of raw reads:

```ts
// config.ts
export function effectivePlaybackMode(): "auto" | "announce" | "silent" {
  const c = loadConfig();
  if (rawConfigHas("playback_mode")) return c.playback_mode;
  return c.streaming_enabled ? "auto" : "silent";   // legacy mapping
}
```

- `streaming_enabled=false` has always meant "queue but don't auto-play" — that IS silent mode. `announce` is the genuinely new state in between.
- New script `scripts/set_playback_mode.sh auto|announce|silent` writes **both** keys (`playback_mode`, and `streaming_enabled = (mode == "auto")`) so anything still reading the old key stays coherent. `scripts/set_streaming.sh` becomes a 3-line shim: `on → set_playback_mode.sh auto`, `off → set_playback_mode.sh silent`. Existing muscle memory and any external callers keep working.
- **Daemon lifecycle change:** today `set_streaming.sh off` stops the tts-server. In announce mode the server must run (it plays the announce chime and maintains state files), and even in silent mode we want state tracking for the menu. New rule: `set_playback_mode.sh` always ensures the server is started; the daemon itself is what gates behavior. "Quit" in the menu remains the way to actually stop it. Simpler mental model: one always-on tiny daemon, mode decides what it does with arrivals.
- SwiftBar plugin (`plugins/cursor-read-aloud.5s.sh`): replace the two-state "Streaming: On/Off" line with `Playback: Auto ▸ / Announce ▸ / Silent ▸` submenu (three items calling `set_playback_mode.sh`, ✓ on current). The python config-read block already exists — add `playback_mode` to the batch read.

**Files:** `config.ts` (+field, +accessor, ~15 lines), new `scripts/set_playback_mode.sh` (~40 lines, clone of set_streaming.sh), `scripts/set_streaming.sh` (gut to shim), plugin (~20 line diff).
**Effort:** ~1.5h. **Credits:** none.

### 2. Session state file

**Location:** `~/.cursor/tts/state/<sessionId>.json` — one file per session. This shape is right, for one decisive reason: **the writers are separate processes** (Stop-hook ingest, UserPromptSubmit signal, the daemon, manual `play_node.sh` invocations). A single combined file would need read-modify-write locking across processes; per-session files mean each write replaces the whole file and the only conflict window is two writers on the *same session*, which the lifecycle makes nearly impossible (a session can't Stop and receive a prompt in the same instant).

**Schema (keep it minimal — derive, don't duplicate):**

```json
{
  "sessionId": "67ed12f4-...",
  "name": "cursor-read-aloud",
  "state": "working" | "hand_raised" | "speaking" | "idle",
  "raisedAt": "2026-07-06T18:22:01Z",
  "updatedAt": "2026-07-06T18:22:01Z"
}
```

- `raisedAt` set when entering `hand_raised`, null otherwise → gives FIFO floor-grant ordering for free.
- `updatedAt` bumped on **every** write — lets consumers (and us, debugging) spot stale files at a glance.
- **No `queueCount` field** — pending-update count is derived by counting `queue/*-cc-<shortSession>.json` files, which can never drift from reality. Consumers (menu, later LEDs) do one `ls`. With supersede-on-arrival (§4), a Claude Code session holds at most one queued file, so for CC items the "count" is effectively a boolean.
- **Scope note (be honest about it):** hand-raise state, counts, and announces cover **Claude Code items only** (`*-cc-*` queue files). Cursor items and manual enqueues keep their legacy behavior — they auto-play or sit in the queue as today, and don't raise hands.
- `name` is denormalized from `~/.claude/sessions` at write time so consumers don't need a join.

**Transition ownership (exactly one writer per transition):**

| Transition | Writer | Where |
|---|---|---|
| → `working` | UserPromptSubmit hook | `signal.ts` `prompt-submitted` branch (already execs there). **Also purges the session's pending queue item first** (same session-scoped clear as `clear_session_queue.sh`, §4) — supersede-consistent: you just gave the agent new instructions, so its stale progress report is moot. Explicit tradeoff, accepted: engaging with a session dismisses its undelivered update (it's still in `played/` for replay). Without the purge, the stale file re-raises the hand at the next recompute and a grant would play the obsolete pre-prompt update |
| → `hand_raised` | Stop hook, after queue file written | `ingest.ts` (mode-agnostic: it means "has undelivered update"; in auto mode it lives ~2s before the watcher flips it). **Mute check comes first**: `muted_sessions.json` is consulted before any state write or announce — muted sessions never raise hands. If the session is already `hand_raised`, the new item **supersedes** the old (§4) |
| → `speaking` | the playback wrapper in `audio.ts` | implemented **once**, in the wrapper every audible path goes through. The wrapper takes an **explicit context parameter** — a `sessionId` for session-attributed audio (queue items, dynamic acks, ask-user readouts) or the literal `"meta"` for room-level audio (announce phrases, SFX, `say` output). Session context sets `speaking` and drives the recompute after; **meta audio never touches session state** — it only respects the playback lock (announce chimes use the try-once check, §3). Callers must pass one or the other, so no playback surface can forget to declare itself |
| → `idle` / `hand_raised` / `working` | same wrapper, after session-context playback | recompute **inside the write** + post-write verify (below) |

**End-of-playback recompute (the one race that matters):** never write `idle` blind. `state.ts` exposes `recomputeAfterPlayback(sessionId)` which, *inside the write operation itself* — i.e. between deciding and `rename`-ing, not from a value computed before playback ended — does: re-scan `queue/` → files present → `hand_raised` (keep oldest `raisedAt`); else read the session's `~/.claude/sessions` file → `status: "busy"` → `working` (the agent is mid-task; calling it idle would lie to the menu and LEDs); else `idle`. There is still a millisecond window between the scan and the rename where a fresh Stop hook can land and get overwritten, so the recompute ends with a **post-write verification pass**: after the rename, re-scan `queue/` once more and re-derive; if the derived state differs from what was just written, write again (the second derive sees the new queue file, so the rewrite is the truth). No lockfile — a verify-and-rewrite is cheaper than cross-process locking and stays in house style.

**Race handling:** new `tts-server/src/state.ts` (~80 lines) with `setSessionState(sessionId, state)` doing atomic write (`writeFileSync(tmp)` + `renameSync`) — readers never see partial JSON. Last-writer-wins is then correct because the one racy pair (playback-end recompute vs. a fresh Stop-hook `hand_raised`) **converges**: both sides derive from the queue directory at write time, and the verification pass above closes the scan→write window. No locks needed.

**Hygiene + seeding:** on daemon start, reconcile the state dir against `~/.claude/sessions/` in both directions. Delete state files whose sessionId is missing there (dead sessions), and **seed a state file for every live session that lacks one**: `status: "busy"` → `working`, else `idle`; a pending `queue/` file for the session → `hand_raised` instead. Without seeding, the menu/panel/LEDs show an empty room after a daemon restart until each agent happens to fire a hook. Claude Code's own `status: busy|idle` is consulted by the recompute and the seeder (busy → `working`) but is not the source of truth for `hand_raised`/`speaking` (its "busy" ≠ our "hand_raised").

**Files:** new `state.ts`; playback wrapper (context param) in `audio.ts`; 1-3 line touches in `ingest.ts`, `signal.ts` (incl. the prompt-submitted purge), `index.ts`.
**Effort:** ~3h. **Credits:** none.

### 3. Announce flow

**Where the announce fires — `notify_queued.sh` IS the trigger, but the logic lives in a dedicated helper.** Ingest already calls `notify_queued.sh` on arrival, which today plays a random cached SFX and posts the banner notification. One integration point, so use it — but `notify_queued.sh` is a python-heavy script and the announce branch has to be lock-aware, mode-aware, voice-aware, and deferred-aware, so that logic gets its own small home: **new `scripts/announce.sh <sessionId>`** (or `tsx src/announce.ts` if the voice/lock helpers make TS easier), which `notify_queued.sh` invokes with a 2-line hook. In announce mode the helper plays the character's **cached announce phrase** instead of the random SFX. No second code path, no double-fire (SFX *or* announce, never both).

**Gating (important restructure):** `notify_queued.sh` currently exits early unless `notifications_enabled` — which defaults false, so a naive announce branch would ship silent. The announce call keys on `playback_mode == "announce"` and runs **before and independent of** the `notifications_enabled` gate; the banner notification keeps its own toggle untouched. Announce mode without announces would be no mode at all.

**Notification click = floor grant.** In announce mode the banner's `-execute` runs `grant_floor.sh <sessionId>` (granting that session's single pending item), not `play_node.sh <file>` directly — every surface funnels through the grant path (Decision 8), so state transitions, FIFO bookkeeping, and the lead-in all apply no matter how you answered the hand. Auto mode keeps the existing direct-play click.

Muted sessions never get here — ingest checks `muted_sessions.json` before any state write or notify (§2). Scope note per §2: this covers Claude Code arrivals; Cursor/manual enqueues keep the legacy SFX behavior.

`index.ts` `processQueueFile` then only needs the mode gate — replace the current `streaming_enabled` gate (line ~91). The gate currently runs before parsing; keep the new one after parse + mute check but **before** `claimProcessing` and **before any Gemini/ElevenLabs call** (preserving the credit-efficiency invariant in CLAUDE.md):

```
parse → mute check → [auto=true only] mode gate:
  silent | announce → log "queued without auto-play", return
                      (file stays in queue/; announce audio was already
                       handled at ingest time by notify_queued.sh)
  auto              → fall through to existing claim/lock/Gemini/EL path
```

`once` mode (`play_node.sh`, grant-floor) passes `auto=false` and skips the gate entirely — exactly the existing manual-play semantics, unchanged.

`announce.sh` behavior (~50 lines — it earns its own file precisely because it isn't a 15-line diff): try-once check of the playback lock (same pattern as dynamic acks); floor free → play a cached `announce_N.mp3` for the session's voice **as meta audio** (context `"meta"` per §2 — an announce chime never sets `speaking` on anyone); floor busy (someone speaking, or another announce mid-play) → record the deferral in the pending-announce file (below). If the voice has no cached announce phrases yet, fall back to the legacy SFX — zero credits, never blocks.

**Ask-user questions follow the same etiquette.** Today `signal.ts ask-user` synthesizes and speaks the question immediately — in announce mode that would be exactly the uninvited audio (and credit spend) this mode exists to prevent. So in announce mode, ask-user does **not** synthesize: it plays a cached **"I've got a question"** phrase (a third tiny phrase set, `question`, below — questions deserve a distinct sound because they block the agent) and raises the hand with item type `question`; granting the floor synthesizes and reads the question via the normal on-grant path. Auto mode keeps today's immediate readout unchanged.

**Announce phrase pre-generation — mirror `phrases.ts` exactly.** Refactor `phrases.ts` to support named sets:

```ts
const PHRASE_SETS = {
  ack: DEFAULT_PHRASES,                     // existing files keep "phrase_N.mp3" names
  announce: [
    "Yo, I got an update!",
    "Got something for you when you're ready.",
    "Update's ready over here.",
    "I've got news whenever you want it.",
    "Done with a chunk — say the word.",
  ],
  question: [
    "Hey — I've got a question when you have a sec.",
    "Quick question over here.",
    "I'm stuck on something — need your call.",
    "Got a question for you.",
  ],
};
// files: sounds/phrases/<voiceId>/announce_N.mp3, question_N.mp3
//   (ack set keeps phrase_N.mp3 for back-compat)
generatePhrases(voiceId, kind = "ack")
playRandomPhrase(voiceId, kind = "ack")
```

- One-time cost per voice: 5 announce phrases × ~30 chars + 4 question phrases × ~35 chars ≈ **~290 ElevenLabs chars per voice** — trivially cheap, generated once, free forever after (skip-existing behavior preserved).
- Generation is **explicit, never lazy**: `pnpm exec tsx src/phrases.ts <voiceId> announce|question`, plus hook it into wherever ack phrases get generated today (setup / set_session_voice path). If a voice has no announce/question phrases cached at announce time, fall back to `afplay` of a cached local SFX (`scripts/random_sfx.sh` already picks one) — zero credits, never blocks.
- These phrase texts are user-facing spoken copy — reviewed here, tweak freely before generating.

**Chime etiquette (open question 3, decided):**

1. **Floor idle** → play the full cached announce phrase. This is the normal case and it's charming.
2. **Someone is speaking (or another announce is playing)** → **suppress the spoken phrase entirely**. Do not queue announce audio — queued chimes arriving 90 seconds later are noise, and the menu-bar badge + state file already carry the information. Instead **append the deferring sessionId** to `~/.cursor/tts/.pending-announce` (one sessionId per line, dedup on append). The file records *who* deferred, not merely *that* something did — that's the difference between a helpful nudge and a nag.
3. **Deferred announce, fired only when the floor is truly free:** at end of playback (`processQueueFile` after `playStreamBuffer` resolves, end of `handleAskUser`), check that the lock is released *and* no grant items are still queued up to play — mid-grant is not "free". If `.pending-announce` exists, read its sessionIds and **validate each against the current state files**: keep only sessions still `hand_raised`, then delete the file. Nothing left → silence. Otherwise speak **only those names** via a free local `say` template — *"Two hands up: Donatello and Michelangelo."* Critically, a hand you deliberately left up from *before* (it announced already, never deferred) is not in the file and stays quiet — no re-nagging after every playback. Named beats an anonymous ding: you know whether to care without opening the menu, and it costs nothing.
4. `clear_queue.sh` / `clear_session_queue.sh` (§4) also remove the cleared sessions' lines from `.pending-announce` **and trigger a state recompute for each affected session** (call `state.ts recompute <sessionId>` after moving files) — hands you just dismissed must not announce themselves afterwards, and a cleared session must not sit `hand_raised` forever with a wrong badge / blinking LED / phantom panel card.
5. Multiple hands raising in quick succession while idle: announces serialize through the try-once lock — the first plays, the rest append their sessionIds to the deferral file. Never more than one pending sound.

**Files:** new `scripts/announce.sh` (~50 lines), `notify_queued.sh` (2-line hook, called outside the notifications gate), `signal.ts` (ask-user announce-mode branch, ~15 lines), `index.ts` (~20 line diff — mode gate + deferred-announce check), `phrases.ts` (~35 line refactor incl. `question` set), `state.ts` deferral-file helpers, `clear_queue.sh`/`clear_session_queue.sh` (deferral-line removal + recompute call).
**Effort:** ~4.5h (announce helper is a real script, not a 15-line diff; ask-user gating included) — one live verification of the announce path (one short phrase generation).
**Credits:** ~290 chars/voice one-time; runtime is 100% cached/local (`say` is free).

### 4. Floor-grant

**Supersede-on-arrival (in `ingest.ts`): a hand holds only the latest update.** When a Stop fires for a session that is already `hand_raised`, the new queue item **replaces** the old one — the older file is archived to `played/` (not deleted; replay-recoverable), the new file becomes the session's single pending item, `raisedAt` is kept. Rationale: successive Stops from one agent are progress reports on the same work; when you finally grant the floor you want the *current* state of the world, not a serialized history. This is also the credit story — superseded updates are never synthesized, so an agent that raises its hand five times before you listen costs exactly one synthesis.

**Claim check before swap:** ingest consults the `claimProcessing` marker (`audio.ts`) before superseding. A claimed file is already mid-Gemini/ElevenLabs — being spoken right now — so yanking it would waste the in-flight synthesis and leave the daemon renaming a moved file. Claimed → skip the swap; the new item simply queues as the next pending update and normal flow takes over when playback ends.

**New script `scripts/grant_floor.sh [sessionId]`:**

- No arg → "next raised hand": pick the state file with `state=hand_raised` and the **oldest `raisedAt`** (global FIFO — the agent who's waited longest goes first; that's the room etiquette a human would use). Muted sessions never enter this FIFO (they never reach `hand_raised`, per §2).
- With arg → grant that specific session.
- Then: play **exactly one item** — the session's latest queued item — via existing `play_node.sh` (`index.ts once`). Thanks to supersede, one item *is* the whole update for Claude Code sessions, and a grant can never lock the floor for minutes draining a backlog.
- **`grant_floor.sh drain <sessionId>`** — explicit escape hatch for the rare genuine backlog (mostly legacy Cursor/manual items, which don't supersede): plays everything for that session oldest-first (queue filenames are epoch-prefixed, so `ls | sort` is the order). Deliberate command, not default behavior.
- Playback path handles state (speaking → idle/hand_raised/working) per section 2.

**Session-scoped clear — new `scripts/clear_session_queue.sh <sessionId>`** (~25 lines): moves the session's `queue/*-cc-<shortSession>.json` files to `played/`, removes its `.pending-announce` lines, and triggers the state recompute (§3 item 4). This exists because `clear_thread_queue.sh` takes SwiftBar's urlsafe-base64 grouping token, **not** a sessionId — every place this spec needs "clear this session" (the voice `clear <name>` command in §7, the prompt-submitted purge in §2, menu per-hand dismiss) calls this script; `clear_thread_queue.sh` keeps its existing SwiftBar-only interface.

**Menu (SwiftBar plugin):** new top section right under Play Latest/Replay:

```
Raised Hands ✋ (2)
  ✋ donnie — waiting 3m | bash=grant_floor.sh param1=<sid>
  ✋ mikey — waiting 40s | bash=grant_floor.sh param1=<sid>
Go Ahead (next hand) | bash=grant_floor.sh shortcut=ctrl+shift+g
```

Rendered from `state/*.json` inside the existing python block (one more section, ~35 lines); muted sessions are excluded from the rendering. Section hidden when no hands raised. No per-hand item counts — supersede means a CC hand is always exactly one update — but supersede must not be *invisible*: when a hand's pending item has superseded earlier ones (ingest counts the swaps in a `superseded` field on the queue item), the menu row shows a **superseded-count chip** (`✋ donnie — waiting 3m · 2 earlier updates skipped`), and a **"drain" entry appears whenever superseded or legacy multi-item backlogs exist** (superseded files sit in `played/`, so drain for them is "replay the archived ones oldest-first"). Distinct completed tasks silently vanishing is the one way supersede could make agents feel like they drop work; the chip keeps it honest, the credit story stays intact.

**Hotkey:** SwiftBar `shortcut=ctrl+shift+g` on "Go Ahead (next hand)" — same zero-dependency mechanism as the existing `ctrl+shift+p`. Also add `scripts/raycast/go-ahead-next.sh` (2-line Raycast script command wrapper) for a Raycast-assigned hotkey; both call the same `grant_floor.sh`. Per-session voice grant ("go ahead, Donnie") arrives with Phase 2's router — no per-session hotkeys needed in Phase 1, the menu covers it.

**Files:** new `grant_floor.sh` (~60 lines incl. drain), new `clear_session_queue.sh` (~25 lines), supersede + claim-check logic in `ingest.ts` (~15 lines), new `scripts/raycast/go-ahead-next.sh`, plugin (~40 line section incl. superseded chip).
**Effort:** ~3.5h. **Credits:** grant triggers normal synthesis of exactly one item; superseded items cost zero (see section 5).

### 5. Synthesize-on-grant vs synthesize-ahead

**Recommendation: synthesize-on-grant, with a free cached lead-in phrase to mask latency. No hybrid.**

Analysis:

| | on-grant | ahead |
|---|---|---|
| Cost when you skip/clear an update | **zero** (the whole point of hand-raise mode is skipping freely) | full eleven_v3 per-char cost, wasted |
| Latency grant→audio | ~2-3s (Gemini flash-lite ~1s + EL stream TTFB ~1s) | ~0s |
| New moving parts | none — this is exactly today's `once` path | pre-synth cache keyed to queue files, invalidation on Clear Messages, staleness, disk pruning |
| Replay interaction | replay/ cache already stores every synthesized item — nothing re-billed on replay | same, but duplicates the concept |

The user *sometimes skips updates* — that's stated, and hand-raise mode will make skipping more common, not less (that's its purpose: "I saw the badge, I don't need to hear it, Clear"). Synthesize-ahead bills every skipped update at eleven_v3 per-char rates and requires building a second audio cache with invalidation rules. The only thing it buys is ~2-3 seconds, once, at the moment you've *deliberately chosen* to listen.

A hybrid (`synth-ahead when ≤N chars`) optimizes the wrong end: short messages are already the fast ones to synthesize on demand, and it inherits all of ahead-mode's cache machinery for a sub-second win.

**Latency mask, free:** `grant_floor.sh` (or the once-path when invoked with a `--lead-in` flag) first plays a cached phrase from a fourth tiny phrase set (`grant`: "Alright, so—", "Okay, here's the deal.", ~4 phrases ≈ 80 chars/voice one-time). The character audibly "takes the floor" instantly while Gemini+EL spin up behind it. This reuses the exact `phrases.ts` infrastructure from section 3. Optional — ship on-grant first, add the lead-in if the 2-3s gap feels dead.

**Effort:** 0h beyond sections 3-4 (on-grant IS the existing once path); +1h if adding the lead-in set.

---

## Phase 2 — Voice Control

### 6. Local STT + hotkey

**Recommendation: whisper.cpp (`brew install whisper-cpp`), spawn-per-utterance, `base.en` model, push-to-talk toggle via a Raycast script command hotkey.**

Comparison:

- **Spawn-per-utterance (`whisper-cli`)**: on Apple Silicon, `base.en` loads in ~200-400ms and transcribes a 3-6s command utterance in well under a second — total added latency ~1-1.5s after you stop talking. Zero daemons, zero ports, pure house style. Killer feature for us: `--prompt "Donnie, Mikey, Raph, go ahead, say again, cursor-read-aloud, podlink"` biases recognition toward session/persona names — inject the live session-name list into the prompt at transcribe time for near-perfect name matching.
- **Always-loaded server (`whisper-server` HTTP, model resident)**: saves only the ~300ms model load. Adds a daemon to babysit, a port, and a health-check path. Not worth it at command-length utterances; revisit only if we later want streaming dictation for long talk-to-agent messages (even then, a bigger model spawn is likely fine).
- **Superwhisper**: excellent dictation UX, but it types into the focused text field — there's no clean "give me the transcript on stdout for my router" integration. Wrong shape. Pass.
- **macOS Dictation**: no scriptable capture of results. Pass.

If `base.en` fumbles names despite the prompt bias, drop in `small.en` (~2× slower, still ~1s for commands) — it's a config value, not a design change.

**Capture:** ffmpeg is already installed. `ffmpeg -f avfoundation -i ":default" -ar 16000 -ac 1 <out>.wav` records; whisper wants 16kHz mono anyway. `:default` is valid on current avfoundation and is the right default, but don't hard-code it as the only path: `setup.sh` runs `ffmpeg -f avfoundation -list_devices true -i ""` once and prints the audio-device list, and a `mic_device` config key (default `":default"`) lets the owner pin a specific index if the default ever resolves to the wrong input (AirPods, external interface). **TCC gotcha, documented as a first-run step:** macOS mic permission is granted per *host process* — the first `ptt.sh start` triggered from Raycast pops the mic prompt for Raycast (later, the arcade path pops it for the daemon's parent); if recording produces a silent wav, check System Settings → Privacy → Microphone before debugging anything else.

**Hotkey mechanism:** Raycast (installed, and `scripts/raycast/` script commands are already the established pattern in this repo). Hammerspoon is banned. skhd would add a new daemon for no gain. Raycast script commands get user-assigned global hotkeys and launch in ~100ms.

**The stable entry point: `scripts/ptt.sh start|stop [sessionId]`** (~70 lines) — press/release semantics, and THE PTT interface every surface uses: Raycast now, the Phase 3 arcade buttons and Phase 4 panel later (their hold/release events map to `start`/`stop` directly; see phase3-4 §3.3/§4.7). The optional `sessionId` **pre-binds the target**: when present, the transcript skips the name-resolution grammar entirely and injects straight into that session (§7) — you held *Donnie's* button, no need to say his name.

**Audio ducking (required, not a nicety) — explicit semantics, never a toggle:** `pause.sh` is a SIGSTOP/SIGCONT *toggle*, so PTT must not call it blind (ducking already-paused audio would resume it straight into the microphone). Ducking is **pause-if-playing / resume-if-ducked**: on `start`, pause only if something is actually playing, and record that *PTT itself* did the pausing by writing a `.ptt-ducked` flag. On `stop`, after transcription + routing/injection completes, resume only if `.ptt-ducked` exists — then remove it — and only if the routed command didn't itself take the floor (grant/stop/pause), in which case the command's effect wins. Audio the *user* paused before PTT is never resumed by PTT.

**Per-invocation files (concurrency-safe by construction):** every `start` mints a PTT ID (`<epoch>-<pid>`) and keys all its artifacts by it under `~/.cursor/tts/ptt/`: `<id>.pid`, `<id>.wav`, `<id>.target`. `stop` resolves *which* invocation it's terminating — a `sessionId` arg matches the invocation whose `.target` holds it (the arcade/panel path: each button hold is its own invocation), no arg takes the newest live one (the Raycast toggle, which naturally serializes) — and reads/cleans **exactly that ID's files**. Two buttons held at once are two independent recordings; nothing shares `/tmp/ptt.wav`, nothing orphans an ffmpeg.

```
ptt.sh start [sessionId]:
    ID=$(date +%s)-$$                          # per-invocation PTT ID
    duck: if playback active → pause it, touch ptt/$ID.ducked
    afplay tick-on
    ffmpeg -f avfoundation -i "$MIC_DEVICE" -ar 16000 -ac 1 -y ptt/$ID.wav &
    echo $! > ptt/$ID.pid
    [ -n "$sessionId" ] && echo "$sessionId" > ptt/$ID.target

ptt.sh stop [sessionId]:
    ID=$(match ptt/*.target to sessionId, else newest ptt/*.pid with live process)
    kill -INT $(cat ptt/$ID.pid)               # stop ffmpeg cleanly
    afplay tick-off
    NAMES=$(session names + character names, comma-joined)
    whisper-cli -m ~/.cursor/tts/models/ggml-base.en.bin \
        --prompt "$NAMES, go ahead, pause, say again, status, mute" \
        -f ptt/$ID.wav --no-timestamps --output-txt ...
    if ptt/$ID.target: voice.ts route --target "$(cat ptt/$ID.target)" "$TRANSCRIPT"
    else:              voice.ts route "$TRANSCRIPT"
    if ptt/$ID.ducked and routed action didn't take the floor → resume playback
    rm ptt/$ID.*                               # clean exactly this invocation
```

**Raycast constraint → `scripts/voice_ptt.sh` as a thin wrapper:** Raycast gives key-*press* events only, no key-up, so the hotkey is a **toggle**, not hold-to-talk: `voice_ptt.sh` (~15 lines) decides start-vs-stop by checking for a live recording — and **validates PID liveness first** (`kill -0` on each `ptt/*.pid`): a stale pid file from a crashed ffmpeg is cleaned up and treated as "not recording", so a dead recording can never invert the toggle into a phantom `stop`. Always target-less — voice targeting from the hotkey goes through the grammar. Real hold-to-talk arrives with the Phase 3 arcade button (true press/release events calling `ptt.sh` directly). A tiny Swift helper for key-up detection is possible but is a build artifact to maintain — not worth it with hardware coming.

Plus `scripts/raycast/push-to-talk.sh` (2-line wrapper around `voice_ptt.sh`) and a `setup.sh` addition: `brew install whisper-cpp tmux` note + model download (`ggml-base.en.bin`, ~140MB, one-time) into `~/.cursor/tts/models/` + the mic-device discovery listing above. One-time TCC mic prompt for Raycast (see Capture).

**Effort:** ~4h including mic-permission fiddling, per-invocation file plumbing, and the duck-flag path. **Credits:** zero — STT is fully local.

### 7. Command grammar + router

**Where it lives: new `tts-server/src/voice.ts`** (entry: `tsx src/voice.ts route [--target <sessionId>] "<transcript>"`). Don't extend `signal.ts` — that file is "hook events in", this is "human commands in"; they share helpers (`config.ts`, `state.ts`, `audio.ts`) but mixing them muddies both. ~150 lines.

**Pre-bound target mode:** when `ptt.sh` passes `--target` (the hardware-button / panel-hold path, §6), the grammar below is bypassed entirely — the whole transcript is the message and it injects directly into that session (§8). Grammar and name resolution exist only for the target-less path (Raycast hotkey).

**Matching: normalized regex table + fuzzy name resolution. No LLM.** Normalize transcript (lowercase, strip punctuation/filler "um|please|hey"), then first match wins, ordered specific→general:

| Pattern | Action |
|---|---|
| `^(go ahead\|go)( ,?(?<name>.+))?$` | `grant_floor.sh` (named session or next hand) |
| `^(pause\|hold on\|wait)$` | `pause.sh` |
| `^(resume\|continue\|keep going)$` | `pause.sh` (existing toggle) |
| `^(stop\|enough\|shut up)$` | `stop.sh` |
| `^(say (that )?again\|repeat\|again)$` | `signal.ts replay 1` (free, cached mp3) |
| `^status\|^who('s\| is) (up\|waiting)` | status template (below) |
| `^(mute\|unmute) (?<name>.+)$` | `set_session_mute.sh` |
| `^(clear\|never ?mind\|skip) (?<name>.+)$` | `clear_session_queue.sh <sessionId>` for that session (§4 — the session-scoped clear; skipping = credits saved) |
| `^(tell\|talk to\|ask\|hey) (?<name>[\w-]+),? (?<msg>.+)$` | talk-to-agent injection (section 8) |
| fallback: nothing matched | spoken "Didn't catch that" (see feedback voice) — **never injected** |

**Injection requires intent — no bare-name fallback.** Talk-to-agent fires only on an explicit verb prefix (`tell`/`ask`/`hey <name>`) or a pre-bound PTT target (above). A transcript that merely *starts with* something name-like is exactly what whisper mishears — routing it into an agent's prompt box is how garbage ends up executed. Unmatched transcripts get "Didn't catch that" and go nowhere.

**Name resolution** (`resolveSessionByName(spoken)` in `voice.ts`): candidates = `team_map.json` persona entries (§8 — authoritative, checked first) + `~/.claude/sessions` names + `characters.json` character names mapped through `session_voices.json` (so "Donnie" resolves to whichever session wears the Donnie voice). Match order: exact → prefix → Levenshtein ≤ 2 (whisper writes "Donny"/"Ralph"). Ambiguous or no match → spoken error naming the candidates. **Injection targets resolve exclusively via `team_map.json`** — voice-reverse-lookup is fine for floor commands (grant/mute/clear, where the worst case is audible and reversible) but never for putting words in an agent's prompt box.

**Status query (resolves open question 6): pure template, no LLM, no ElevenLabs.** Compose from state files + queue counts: *"Two hands up: Donnie, waiting 3 minutes, and Mikey. Raph is working. Floor is free."* Speak it — and all router feedback/errors — with **macOS `say`** (free, instant, offline). Rationale: the *narrator/moderator* isn't a character; burning ElevenLabs chars on meta-chatter contradicts the credit rules, and `say -v Daniel` is perfectly serviceable for the room's "PA system". Character voices stay reserved for characters.

**Files:** new `voice.ts` (~150 lines); no changes to `signal.ts`.
**Effort:** ~3.5h including a `route --dry-run` mode that prints the matched action without executing (free testing of the grammar against sample transcripts).
**Credits:** zero — everything the router says uses `say` or cached audio.

### 8. Talk-to-agent: injecting text into a running Claude Code session

Researched against official docs (code.claude.com/docs: headless, sessions, hooks, agent-teams) mid-2026. The three options:

**Option A — tmux send-keys into the interactive TUI. ← RECOMMENDED**

- What community multi-agent tools (Claude Squad, tmux orchestrators) actually do in practice; there is no blessed alternative.
- The injected message lands in the session's real input box: it's **visible in the TUI**, becomes part of the one true transcript, fires **UserPromptSubmit** (our free ack loop, §9) and later **Stop** (the reply flows back through the existing TTS pipeline). The whole existing machinery just works.
- Known gotchas (verified): send the text and Enter as **separate** send-keys calls with a short delay — a single combined call can drop the trailing Enter (tmux issue #1778); use `-l --` for literal text so `-`/`;` in the message aren't parsed as key names. tmux send-keys does not trigger bracketed-paste handling, so text goes straight into the input buffer.

**Option B — `claude -p --resume <session-id> "message"` (headless continuation).**

- Verified current behavior: `--resume` in print mode **appends to the existing session** (it does not fork; `--continue` is interactive-only). Session lookup is scoped to the project directory, so it must run from the session's `cwd`.
- **Disqualifying for open sessions:** official docs state that resuming a session that's simultaneously open interactively makes messages from both **interleave into one transcript** — no lock, no conflict detection. The reply also goes to the headless process's stdout, invisible in the user's terminal. Docs explicitly warn against it.
- Keep in the back pocket for a future "agents that aren't in a terminal at all" mode — not for Phase 2.

**Option C — Claude Agent SDK.**

- Verified: the SDK cannot attach to a running CLI process; `resume` creates a separate programmatic session with the same interleaving caveat. There is **no official IPC** (no socket, no `--remote`, nothing MCP-shaped) for feeding input to a running interactive `claude`. Wrong tool here.

**Prerequisite: adopting the `team.sh` workflow (this is a habit change, not just a script).** Talk-to-agent works **only** for sessions launched via `team.sh` — i.e., inside tmux. Right now that describes zero sessions on this machine: current Claude Code sessions run in Cursor's integrated terminal and plain terminal tabs, and tmux isn't even installed (see environment facts up top). So Phase 2 carries an explicit adoption step, not just code:

- `brew install tmux` (bundled into the `setup.sh` additions from §6).
- Start persona'd sessions with `team.sh <persona>` instead of bare `claude`.
- Daily use barely changes: attach from iTerm/any terminal — or from a Cursor terminal pane — with `tmux attach -t cr-<persona>`. The tab looks and types exactly like today; it just runs `tmux attach` instead of `claude` directly. Detaching (`ctrl-b d`) leaves the agent running headless-ish in the background, which is a feature, not a cost.
- Sessions you don't adopt keep working exactly as today — they're just **listen-only** (TTS out, no voice in).

**Session → pane mapping: the launch convention plus an explicit mapping file.** New `scripts/team.sh <persona>` — `tmux new-session -d -s "cr-<persona>" -c <project-dir> claude`, then `tmux attach` or open in a terminal tab. Pane identity is the persona name by construction (injection target is `-t "cr-<persona>"`), but persona→*sessionId* must not be guessed: session files appear asynchronously and don't encode the persona, and reverse voice-lookup can bind the wrong session when two sessions share a voice or a new file races in. So `team.sh` **writes the binding down**: it snapshots `~/.claude/sessions/` before launching, polls (up to ~30s) for the new session file to appear, then appends an entry to `~/.cursor/tts/team_map.json` — `{ "<persona>": { "tmux": "cr-<persona>", "sessionId": "...", "launchedAt": ... } }` — and assigns the persona's voice (`set_session_voice.sh`). On timeout it speaks the failure (`say "Couldn't bind <persona> — session file never appeared"`) and writes nothing, so a half-launched persona is loudly absent rather than silently misrouted. **All persona/session resolution for injection reads `team_map.json`, never voice-reverse-lookup** (entries whose tmux session or session file has died are pruned on read). This is the convention that makes routing *reliable* rather than best-effort.

*(Diagnostic note, not a supported path: for a session started manually inside tmux, `~/.claude/sessions/<pid>.json` maps `sessionId → pid`, and you can walk `ps -o ppid=` ancestry against `tmux list-panes -a -F '#{pane_id} #{pane_pid}'` to find its pane — handy when debugging "why isn't this session reachable". The hook payload gives `session_id` + `cwd` but no TMUX_PANE, so ancestry is the only generic bridge. We don't inject via this path; `team.sh` names are the contract.)*

**New file `scripts/inject_prompt.sh <sessionId|persona> "<message>"`** (~50 lines), called by `voice.ts`:

```bash
PANE=$(resolve_pane "$target")        # via team_map.json (persona or sessionId → tmux target), or fail
[ -z "$PANE" ] && exit 3              # voice.ts speaks the "can't reach" error
# collapse newlines/whitespace to single spaces: a literal newline in
# send-keys submits the message mid-way (Enter is Enter to the TUI)
MESSAGE=$(printf '%s' "$MESSAGE" | tr -s '[:space:]' ' ')
tmux send-keys -t "$PANE" -l -- "$MESSAGE"
sleep 0.3
tmux send-keys -t "$PANE" Enter
```

**Honest fragility list (accept these; they're inherent to TUI injection):**

- **Trust/permission prompts:** if the target session is sitting on a permission dialog, injected text can answer the dialog instead of becoming a prompt. Mitigation: check the session file's `status` — inject only when `idle` or `busy`; and team sessions can be launched with pre-approved permissions to make dialogs rare. Not fully preventable.
- **User's half-typed draft:** injected text appends to whatever is already in that pane's input box. Rare for team sessions (you're not typing in them — that's the point), but real.
- **Busy agents:** Claude Code queues prompts submitted while working, so injecting into a `busy` session is safe — it runs next. Optionally have `say` note "Donnie's mid-task — queued."
- **Out-of-tmux sessions are unreachable** (Cursor's integrated terminal, plain iTerm tabs): those agents are listen-only. The `team.sh` convention exists precisely so the sessions you *talk to* are always reachable; `voice.ts` reports honestly when a target isn't.
- Version-dependence: interleaving/resume semantics verified against current docs (CC v2.1.x); re-verify if Anthropic ships real IPC (docs flag this as a known gap).

**Files:** new `scripts/team.sh` (~60 lines incl. session-file detection + `team_map.json` write), new `scripts/inject_prompt.sh` (~50 lines), inject action in `voice.ts` (~20 lines), `setup.sh` (+tmux install note).
**Effort:** ~3.5h. **Credits:** injection itself is free; the downstream reply costs one normal pipeline pass (same as any agent response — and in announce mode it just raises a hand).

### 9. Ack loop after an injected message

**Reuse the existing dynamic ack path — with zero new code, because the hook fires naturally.**

When text is injected into the interactive session and submitted (Enter), Claude Code fires **UserPromptSubmit** in that session exactly as if the owner had typed it → `hook_prompt.sh` → `signal.ts prompt-submitted` → `handleDynamicResponse` → the character acks in their own voice ("On it, dude!"), governed by the existing `dynamic_responses` config (`always` = fresh Gemini ack ~1 cheap Gemini call + ~100 EL chars, `cached` = free phrase, `off` = silent). The state file also flips to `working` via the same hook. The loop closes itself.

What `voice.ts` adds around it:

- **Before injection:** nothing spoken (the user just said the message; echoing it back is annoying). A local tick sound (afplay) confirms the transcript was captured and routed.
- **Injection failure** (no tmux pane found, session not launched via convention): `say "Can't reach <name> — not running in the team room."` Free, instant, honest.
- **Guard against double-audio:** none needed — the ack rides the existing try-once lock in `handleDynamicResponse` (skips if something is already playing).
- One nice-to-have (defer): a per-session `dynamic_responses` override so injected messages always get at least a cached ack even when global acks are off — only if silence after injection proves confusing in practice.

**Files:** ~10 lines inside `voice.ts`'s inject action; no pipeline changes.
**Effort:** ~0.5h.
**Credits:** identical to today's prompt-ack behavior; set `dynamic_responses: "cached"` to make ack loops 100% free.

---

## Rollup

### API-credit exposure summary (whole spec)

| Item | Cost | Mitigation |
|---|---|---|
| Announce/question/grant/ack phrase sets | ~370 EL chars per voice, **one-time** | skip-existing preserved; explicit generation only |
| Floor-grant playback | normal synthesis of one item per grant | that's the product; skipping via Clear/voice "clear" costs zero (on-grant strategy), and superseded hand-raises cost zero too |
| Router feedback, status, errors | zero | macOS `say` + cached SFX only |
| STT | zero | local whisper.cpp |
| Injected-message acks | 1 Gemini + ~100 EL chars per message (existing behavior) | `dynamic_responses: "cached"` makes it free |
| Dev/testing | near zero | `--dry-run` router, `once` with short text, GEMINI/EL key-absent fallbacks |

### Implementation order (checklist)

**Phase 1 (~12-14h total)**

- [ ] 1. `state.ts` (recompute + post-write verify + daemon-start seeding) + context-param playback wrapper in `audio.ts` + transitions wired into `ingest.ts` / `signal.ts` (incl. prompt-submitted purge) / `index.ts` (3h) — foundation everything reads
- [ ] 2. `playback_mode` config + `set_playback_mode.sh` + `set_streaming.sh` shim + plugin 3-way toggle (1.5h)
- [ ] 3. `phrases.ts` phrase-set refactor + generate announce + question sets for current voices (1h, ~290 chars/voice)
- [ ] 4. `announce.sh` helper (called from `notify_queued.sh`, independent of the notifications gate) + mode gate in `index.ts` + ask-user announce-mode branch + deferred named-announce etiquette + notification-click grant (3.5h)
- [ ] 5. Supersede-on-arrival + claim check in `ingest.ts` + `grant_floor.sh` (single-item + drain) + `clear_session_queue.sh` + Raised Hands menu section (incl. superseded chip) + `ctrl+shift+g` + Raycast wrapper (3.5h)
- [ ] 6. Live verify: two sessions, announce mode, raise → announce → supersede → grant → speak → state transitions (1h, short texts only)
- [ ] 7. (optional) grant lead-in phrase set to mask on-grant latency (1h)

**Phase 2 (~12-14h total)**

- [ ] 8. `brew install whisper-cpp tmux`, model download + mic-device discovery in `setup.sh`, `ptt.sh start|stop [sessionId]` with per-invocation PTT IDs + duck-flag pause/resume + `voice_ptt.sh` toggle wrapper (PID-liveness check) + Raycast hotkey (4h)
- [ ] 9. `voice.ts` router + grammar + `--target` bypass + `say` feedback + `--dry-run` (3.5h)
- [ ] 10. Floor-control commands end-to-end by voice (pause/stop/again/status/go-ahead) (1h)
- [ ] 11. tmux adoption (§8 prerequisite) + `team.sh` launch convention with `team_map.json` binding + injection script (3.5h)
- [ ] 12. Talk-to-agent + ack loop end-to-end (1h)

Phase 1 is fully usable without Phase 2 (menu + hotkey floor control); Phase 2 items 8-10 are usable without 11-12 (voice floor control before talk-to-agent).
