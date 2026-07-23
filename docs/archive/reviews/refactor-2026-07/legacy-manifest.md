# Phase 6 legacy audit — caller/install manifest (2026-07-23)

Recon by composer-2.5 (read-only), verified spot-wise by the main session.
Rule: nothing is deleted without a row here proving it's orphaned.

## Hook configuration (live on this machine)

| Hook | Config | Script |
|------|--------|--------|
| `afterAgentResponse` (Cursor IDE) | `~/.cursor/hooks.json:5`, `config/hooks.json:5` | `ingest.sh` |
| `Stop` | `~/.claude/settings.json:11` | `hook_stop.sh` → `ingest.ts`, bash fallback `ingest_claude_code.sh` |
| `UserPromptSubmit` | `~/.claude/settings.json:25` | `hook_prompt.sh` → `signal.ts` |
| `PreToolUse` / AskUserQuestion | `~/.claude/settings.json:40` | `hook_ask_user.sh` → `signal.ts` |
| `SessionEnd` | `~/.claude/settings.json:54` | `hook_session_end.sh` |

Repo `.claude/settings.local.json`: permissions only, no hooks.

## Verdict rollup

| Verdict | Files |
|---------|-------|
| LIVE (44) | Hooks chain (`hook_*.sh`, `ingest.sh`, `ingest_claude_code.sh`, `notify_queued.sh`, `clean_text.py`, `announce.sh`, `random_sfx.sh`, `cleanup_played.sh`, `play_node.sh`, `grant_floor.sh`), daemon-spawned (`team.sh`, `inject_prompt.sh`, `cancel_inject.sh`, `hold_room.sh`, `pause.sh`, `stop.sh`, `restart.sh`, `panel.sh`, `nickname.sh`, `clear_session_queue.sh`, all `set_*.sh` except `set_streaming.sh`), installer/ops (`setup.sh`, `tts-server.sh`, `enqueue_manual.sh`, `load_env.sh`, `generate_sfx.sh`, `fetch_voices.py`) |
| PTT-EXEMPT | `ptt.sh`, `voice_ptt.sh`, `scripts/raycast/push-to-talk.sh` (the hotkey entry point for `voice_ptt.sh` — input half of the conversational layer) |
| KEPT operator/dev utilities (no runtime caller, documented in CLAUDE.md) | `mobile_url.sh` (CLAUDE.md Verifying §3), `panel-dev-install.sh` (CLAUDE.md commands) |
| SWIFTBAR-ONLY → deleted with the plugin | `clear_queue.sh`, `clear_thread_queue.sh`, `fetch_credits.sh`, `paste_voice_id.sh`, `play_latest.sh`, `quit.sh`, `replay.sh`, `plugins/cursor-read-aloud.5s.sh` |
| RAYCAST-ONLY → deleted (never installed by setup.sh; Raycast prefs/config contain no reference to the repo dir) | all `scripts/raycast/*` except `push-to-talk.sh` |
| ORPHAN → deleted | `media_control.sh` (Hammerspoon config long gone), `set_streaming.sh` (shim over `set_playback_mode.sh`, zero callers), `build_read_aloud_notifier_app.sh` (one-shot builder; see note) |

## Notes / nuances

- **Notifier app**: `~/Applications/CursorReadAloudNotifier.app` IS installed
  and `notify_queued.sh` still resolves it at runtime (falls back to stock
  terminal-notifier if absent). Deleting the *builder script* does not break
  notifications; rebuild instructions live in git history (README pre-Phase-6).
- **Panel coverage of SwiftBar functions**: replay (`commands.ts:809`),
  stop/restart/pause (`commands.ts:825–831`), session mute/voice/nickname
  (`panel-ws.ts`), session queue clear (`hid.ts:392`). Not covered: global
  queue clear (manual `mv` or re-add if missed), ElevenLabs credits display —
  daemon's `elevenlabs.ts fetchCredits()` export is ALSO caller-less; left in
  place as the hook for a future panel credits chip (ideas-backlog candidate).
- **`replay.sh`** was a thin wrapper over `signal.ts replay`, which CLAUDE.md
  documents directly — no loss.
- **piper**: no piper-era files remain; `setup.sh` keeps the stale-config-key
  strip (that's the cleanup mechanism, not a leftover).
- **`fetch_voices.py` / `generate_sfx.sh`** survive SwiftBar deletion —
  `setup.sh --refresh-voices` uses both.

## Full caller table (composer-2.5 recon, file:line citations)

| File | Referenced by (file:line) | Verdict |
|------|---------------------------|---------|
| `scripts/announce.sh` | `scripts/notify_queued.sh:28–30` | LIVE |
| `scripts/build_read_aloud_notifier_app.sh` | `scripts/setup.sh:73` (install copy only); `README.md:356` (manual docs) | ORPHAN — installed but no caller found |
| `scripts/cancel_inject.sh` | `tts-server/src/voice.ts:579`; `scripts/inject_prompt.sh:10` (comment) | LIVE |
| `scripts/cleanup_played.sh` | `scripts/ingest.sh:250`; `scripts/ingest_claude_code.sh:193`; `tts-server/src/maintenance.ts:4,42` (comments) | LIVE |
| `scripts/clear_queue.sh` | `plugins/cursor-read-aloud.5s.sh:946` | SWIFTBAR-ONLY |
| `scripts/clear_session_queue.sh` | `tts-server/src/hid.ts:392`; `tts-server/src/voice.ts:518`; `tts-server/src/state.ts:169` (comment) | LIVE |
| `scripts/clear_thread_queue.sh` | `plugins/cursor-read-aloud.5s.sh:446`; `scripts/clear_thread_queue.sh:45` (SwiftBar contract comment) | SWIFTBAR-ONLY |
| `scripts/enqueue_manual.sh` | `scripts/raycast/enqueue-read-aloud-clipboard.sh:21`; `enqueue-read-aloud-file.sh:22`; `enqueue-read-aloud-text.sh:22`; `CLAUDE.md:110,143` (operator docs) | LIVE |
| `scripts/fetch_credits.sh` | `plugins/cursor-read-aloud.5s.sh:909,933` | SWIFTBAR-ONLY |
| `scripts/generate_sfx.sh` | `scripts/setup.sh:355` (`--refresh-voices`); `plugins/cursor-read-aloud.5s.sh:901,902` | LIVE |
| `scripts/grant_floor.sh` | `tts-server/src/services/commands.ts:792–795`; `hid.ts:381,429,473`; `voice.ts:483,486`; `plugins/cursor-read-aloud.5s.sh:260,266,271`; `scripts/notify_queued.sh:67`; `scripts/raycast/go-ahead-next.sh:20` | LIVE |
| `scripts/hold_room.sh` | `tts-server/src/services/commands.ts:835–837`; `dnd.ts:101`; `hid.ts:452`; `voice.ts:570,575`; `plugins/cursor-read-aloud.5s.sh:800,802`; `scripts/raycast/hold-room.sh:25,27`; `scripts/set_playback_mode.sh:16,20`; `scripts/set_mood.sh:16,19` | LIVE |
| `scripts/hook_ask_user.sh` | `~/.claude/settings.json:40`; `scripts/setup.sh:74`; `README.md:98` | LIVE |
| `scripts/hook_prompt.sh` | `~/.claude/settings.json:25`; `scripts/setup.sh:74`; `README.md:85` | LIVE |
| `scripts/hook_session_end.sh` | `scripts/setup.sh:74,239`; `~/.claude/settings.json:54` | LIVE |
| `scripts/hook_stop.sh` | `~/.claude/settings.json:11`; `scripts/setup.sh:74`; `scripts/hook_stop.sh:30` → `ingest_claude_code.sh` | LIVE |
| `scripts/ingest_claude_code.sh` | `scripts/hook_stop.sh:30` (bash fallback); `scripts/setup.sh:77` | LIVE (fallback path) |
| `scripts/ingest.sh` | `config/hooks.json:5`; `~/.cursor/hooks.json:5`; `scripts/setup.sh:66`; `scripts/ingest.sh:250` → `cleanup_played.sh`, `notify_queued.sh` | LIVE (Cursor IDE hook) |
| `scripts/inject_prompt.sh` | `tts-server/src/services/commands.ts:702`; `voice.ts:462`; `scripts/cancel_inject.sh:5` | LIVE |
| `scripts/load_env.sh` | `scripts/setup.sh:346`; `scripts/generate_sfx.sh:18`; `scripts/fetch_credits.sh:16` | LIVE |
| `scripts/media_control.sh` | `scripts/setup.sh:66` (install only); comments in `tts-server/src/config.ts:21`, `audio.ts:415` | ORPHAN — installed but no caller found (Hammerspoon config removed from repo) |
| `scripts/mobile_url.sh` | `scripts/setup.sh:74` (install only); `CLAUDE.md:312` (operator docs) | ORPHAN — installed but no caller found |
| `scripts/nickname.sh` | `tts-server/src/panel-ws.ts:608` | LIVE |
| `scripts/notify_queued.sh` | `tts-server/src/ingest.ts:184–187`; `scripts/ingest.sh:246`; `scripts/ingest_claude_code.sh:188`; `scripts/enqueue_manual.sh:43` | LIVE |
| `scripts/panel-dev-install.sh` | `CLAUDE.md:146`; `docs/archive/reviews/refactor-2026-07/decisions-overnight.md:125,156` | ORPHAN — not installed; dev workflow only |
| `scripts/panel.sh` | `tts-server/src/hid.ts:441`; `scripts/raycast/open-room.sh:20`; `scripts/panel.sh:16–17` → `tts-server.sh`; `README.md:249` | LIVE |
| `scripts/paste_voice_id.sh` | `plugins/cursor-read-aloud.5s.sh:601`; `scripts/paste_voice_id.sh:27` → `set_voice.sh` | SWIFTBAR-ONLY |
| `scripts/pause.sh` | `tts-server/src/services/commands.ts:831`; `hid.ts:438`; `voice.ts:492`; `plugins/cursor-read-aloud.5s.sh:306,308`; `scripts/ptt.sh:252,281`; `scripts/media_control.sh:24` | LIVE |
| `scripts/play_latest.sh` | `plugins/cursor-read-aloud.5s.sh:151`; `scripts/media_control.sh:30` (dead chain) | SWIFTBAR-ONLY |
| `scripts/play_node.sh` | `scripts/grant_floor.sh:156,158,168`; `scripts/play_latest.sh:38`; `scripts/restart.sh:67`; `plugins/cursor-read-aloud.5s.sh:439`; `scripts/notify_queued.sh:66` | LIVE |
| `scripts/ptt.sh` | `tts-server/src/services/commands.ts:799`; `hid.ts:501`; `scripts/voice_ptt.sh:37,39` | **PTT-EXEMPT** |
| `scripts/quit.sh` | `plugins/cursor-read-aloud.5s.sh:955`; `scripts/quit.sh:13–14` → `set_listening.sh` | SWIFTBAR-ONLY |
| `scripts/random_sfx.sh` | `scripts/notify_queued.sh:68,158`; `scripts/announce.sh:100`; `scripts/ptt.sh:116` | LIVE |
| `scripts/replay.sh` | `plugins/cursor-read-aloud.5s.sh:152`; `scripts/replay.sh:19` → `signal.ts` | SWIFTBAR-ONLY |
| `scripts/restart.sh` | `tts-server/src/services/commands.ts:825`; `plugins/cursor-read-aloud.5s.sh:309`; `scripts/hold_room.sh:112` (via `stop.sh`) | LIVE |
| `scripts/set_listening.sh` | `tts-server/src/panel-ws.ts:373`; `plugins/cursor-read-aloud.5s.sh:950,952`; `scripts/quit.sh:13–14`; `scripts/raycast/start-cursor-read-aloud.sh:28,39` | LIVE |
| `scripts/set_mood.sh` | `tts-server/src/panel-ws.ts:353`; `voice.ts:565`; `plugins/cursor-read-aloud.5s.sh:792`; `scripts/raycast/mood-normal.sh:20`; `mood-focus.sh:20` | LIVE |
| `scripts/set_notification_sound.sh` | `tts-server/src/panel-ws.ts:361`; `plugins/cursor-read-aloud.5s.sh:853,862,891` | LIVE |
| `scripts/set_notifications.sh` | `tts-server/src/panel-ws.ts:357`; `plugins/cursor-read-aloud.5s.sh:698,700` | LIVE |
| `scripts/set_playback_mode.sh` | `tts-server/src/panel-ws.ts:350`; `hid.ts:446`; `plugins/cursor-read-aloud.5s.sh:717,719`; `scripts/hold_room.sh:96,129`; `scripts/set_streaming.sh:14,17` | LIVE |
| `scripts/set_session_mute.sh` | `tts-server/src/voice.ts:517`; `plugins/cursor-read-aloud.5s.sh:674,676` | LIVE |
| `scripts/set_session_voice.sh` | `tts-server/src/panel-ws.ts:594`; `scripts/team.sh:250`; `plugins/cursor-read-aloud.5s.sh:678,683` | LIVE |
| `scripts/set_speed.sh` | `tts-server/src/panel-ws.ts:346`; `plugins/cursor-read-aloud.5s.sh:694` | LIVE |
| `scripts/set_streaming.sh` | `scripts/setup.sh:75` (install only); delegates to `set_playback_mode.sh:14,17` | ORPHAN — installed but no caller found (legacy shim) |
| `scripts/set_voice.sh` | `tts-server/src/panel-ws.ts:369`; `plugins/cursor-read-aloud.5s.sh:585`; `scripts/paste_voice_id.sh:27` | LIVE |
| `scripts/setup.sh` | Operator entry point; referenced throughout docs/CLAUDE.md | LIVE (installer) |
| `scripts/stop.sh` | `tts-server/src/services/commands.ts:828`; `hid.ts:435,470`; `voice.ts:496`; `plugins/cursor-read-aloud.5s.sh:310`; `scripts/hold_room.sh:112,117`; `scripts/set_listening.sh:29–30`; `scripts/restart.sh:30` | LIVE |
| `scripts/team.sh` | `tts-server/src/services/commands.ts:622`; `scripts/setup.sh:79`; `panel/src/app/personas.ts:1` (comment) | LIVE |
| `scripts/tts-server.sh` | `scripts/setup.sh:74,380,403`; `scripts/panel.sh:16–17`; `scripts/set_playback_mode.sh:39`; `scripts/set_mood.sh:74`; `scripts/raycast/start-cursor-read-aloud.sh:47–49`; `CLAUDE.md:82,138` | LIVE |
| `scripts/voice_ptt.sh` | `scripts/raycast/push-to-talk.sh:20`; `scripts/voice_ptt.sh:37,39` → `ptt.sh` | **PTT-EXEMPT** |
| `scripts/clean_text.py` | `scripts/notify_queued.sh:110`; `scripts/setup.sh:71` | LIVE |
| `scripts/fetch_voices.py` | `plugins/cursor-read-aloud.5s.sh:567,599`; `scripts/setup.sh:348` (`--refresh-voices`) | LIVE |
| `scripts/raycast/enqueue-read-aloud-clipboard.sh` | `README.md:335`; execs `enqueue_manual.sh:21` | RAYCAST-ONLY |
| `scripts/raycast/enqueue-read-aloud-file.sh` | `README.md:336`; execs `enqueue_manual.sh:22` | RAYCAST-ONLY |
| `scripts/raycast/enqueue-read-aloud-text.sh` | `README.md:337`; execs `enqueue_manual.sh:22` | RAYCAST-ONLY |
| `scripts/raycast/go-ahead-next.sh` | `README.md:334`; execs `grant_floor.sh:20` | RAYCAST-ONLY |
| `scripts/raycast/hold-room.sh` | execs `hold_room.sh:25,27` | RAYCAST-ONLY |
| `scripts/raycast/mood-focus.sh` | execs `set_mood.sh focus:20` | RAYCAST-ONLY |
| `scripts/raycast/mood-normal.sh` | execs `set_mood.sh normal:20` | RAYCAST-ONLY |
| `scripts/raycast/open-room.sh` | execs `panel.sh:20` | RAYCAST-ONLY |
| `scripts/raycast/push-to-talk.sh` | `README.md:212,333`; execs `voice_ptt.sh:20` | RAYCAST-ONLY |
| `scripts/raycast/start-cursor-read-aloud.sh` | `README.md:332`; calls `setup.sh:36`, `set_listening.sh:39`, `tts-server.sh:49` | RAYCAST-ONLY |
| `plugins/cursor-read-aloud.5s.sh` | `scripts/setup.sh:322–323` (install); SwiftBar runtime | SWIFTBAR-ONLY |

