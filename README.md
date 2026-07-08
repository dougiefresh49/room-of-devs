# <img src="icons/tmnt-notification-queued.png" alt="Read aloud" width="40" /> Cursor Read Aloud

A macOS menu bar tool that reads AI coding agent responses aloud using [ElevenLabs](https://elevenlabs.io) TTS. Supports both **Cursor IDE** and **Claude Code** with natural speech powered by Gemini text preprocessing and ElevenLabs v3 audio tags.

## How It Works

1. A hook captures each assistant reply and queues it as a JSON file:
   - **Cursor**: `afterAgentResponse` hook in `~/.cursor/hooks.json`
   - **Claude Code**: `Stop` hook in `~/.claude/settings.json` (reads transcript JSONL)
2. A Node.js watcher daemon (`tts-server/`) picks up queue files. **Playback mode** (`playback_mode: auto | announce | silent`) controls what happens on arrival:
   - **auto** — synthesize and play immediately (legacy "Streaming on")
   - **announce** — play a cached in-character chime and **raise a hand** (✋ in the menu / Room panel); no synthesis until you grant the floor
   - **silent** — queue only (legacy "Streaming off")
3. In **announce** mode, granting the floor triggers synthesis: menu click, **ctrl+shift+g**, voice ("go ahead Donnie"), arcade button press, or Room panel click. A raised hand holds only the latest update — repeat arrivals supersede without stacking API cost.
4. Text is processed through **Gemini** (converts markdown to natural speech with emotion tags, rewritten in the session's character voice) then synthesized via **ElevenLabs TTS** (eleven_v3 model) and streamed to `ffplay`.
5. A **SwiftBar** menu bar plugin lists raised hands, queued responses grouped by session/thread, playback controls, voice assignment, and recent-playback replay.
6. Every playback is saved to `~/.cursor/tts/replay/` (last 20) so any message can be re-heard for free.

Optional extras via Claude Code hooks: **dynamic prompt acknowledgments** (`UserPromptSubmit` → a short in-character "on it!" while the agent works) and **question readouts** (`AskUserQuestion` → the question is paraphrased aloud in character).

## Prerequisites

- macOS
- Python 3.9+
- [SwiftBar](https://github.com/swiftbar/SwiftBar) (`brew install --cask swiftbar`)
- [ElevenLabs](https://elevenlabs.io) API key
- [Gemini](https://ai.google.dev) API key (optional, for text preprocessing)
- **Optional — voice control & team sessions:** `brew install whisper-cpp tmux` (local STT + tmux-addressable Claude sessions)
- **Optional — Room panel:** [Rust](https://rustup.rs) (build the Tauri panel from `panel/`)

## Setup

```bash
# 1. Add API keys to .env (project root or ~/.cursor/tts/.env)
echo "ELEVENLABS_API_KEY=your_key_here" >> .env
echo "GEMINI_API_KEY=your_key_here" >> .env

# 2. Run setup
bash scripts/setup.sh
```

This will:

- Copy `.env` and scripts to `~/.cursor/tts/`
- Create the directory structure (`queue/`, `played/`, `sounds/`, `cache/`, `logs/`)
- Install the SwiftBar plugin and TMNT menu bar icons
- Fetch your ElevenLabs voices and cache them
- Pre-generate notification sound effects via ElevenLabs Sound Effects API
- Install the Cursor hook (`~/.cursor/hooks.json`)

For **Claude Code** support, add hooks to `~/.claude/settings.json`. `Stop` is the core one (reads the finished response); `UserPromptSubmit` and `AskUserQuestion` are optional (character acks and question readouts):

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash",
            "args": ["/Users/YOU/.cursor/tts/scripts/hook_stop.sh"],
            "async": true
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash",
            "args": ["/Users/YOU/.cursor/tts/scripts/hook_prompt.sh"],
            "async": true
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "AskUserQuestion",
        "hooks": [
          {
            "type": "command",
            "command": "bash",
            "args": ["/Users/YOU/.cursor/tts/scripts/hook_ask_user.sh"],
            "async": true
          }
        ]
      }
    ]
  }
}
```

## Configuration

Edit `~/.cursor/tts/config.json`:

```json
{
  "elevenlabs_voice_id": "oFMuHQNZ0Bh0jz5SJXQy",
  "elevenlabs_model_id": "eleven_v3",
  "gemini_model": "gemini-3.1-flash-lite",
  "default_speed": 1.25,
  "streaming_enabled": true,
  "playback_mode": "announce",
  "streaming_session_prefix": "auto",
  "dynamic_responses": "always",
  "mic_device": ":default",
  "arcade_enabled": false,
  "panel_port": 4780,
  "notifications_enabled": true,
  "notification_icon": "~/.cursor/tts/icons/tmnt-notification-queued.png",
  "notification_sender": "",
  "terminal_notifier_app": "",
  "notification_sound": "random_sfx",
  "played_retention_count": 50
}
```

| Key | Description |
|-----|-------------|
| **elevenlabs_voice_id** | Voice ID from your ElevenLabs account. Set via the Voice menu or Paste Voice ID. |
| **elevenlabs_model_id** | ElevenLabs model (`eleven_v3` recommended). |
| **gemini_model** | Gemini model for text preprocessing. Falls back to a local cleaner if unavailable. |
| **default_speed** | Playback speed (0.75x–2.0x). ElevenLabs handles up to 1.2x natively; faster speeds add an `ffplay` atempo filter on top. |
| **streaming_enabled** | Legacy shim — kept in sync with `playback_mode` (`true` = auto, `false` = silent). Prefer the Playback menu. |
| **playback_mode** | `auto` (play on arrival), `announce` (cached chime + hand raise; synthesize on grant), `silent` (queue only). Live — no restart. |
| **streaming_session_prefix** | Prepend the session name to spoken text (`auto` = only when multiple sessions are active, `always`, `never`). |
| **dynamic_responses** | Prompt acknowledgments: `always` (Gemini-generated, in character), `cached` (free pre-generated phrases), `off`. |
| **mic_device** | ffmpeg avfoundation input for push-to-talk (default `:default`; pin an index if the wrong mic is picked). |
| **arcade_enabled** | Enable USB arcade-encoder HID input (`node-hid`). Inert until `true` — requires daemon restart. |
| **panel_port** | localhost WebSocket port for the Room panel (default `4780`; `0` = disabled). |
| **notifications_enabled** | macOS notifications when a reply is queued. Click to play. |
| **notification_sound** | `random_sfx` (ElevenLabs-generated), `default`, `none`, or any macOS alert sound name. |
| **played_retention_count** | Max played files to keep before auto-cleanup (default 50). |

## Menu Bar Controls

| Section | Description |
|---------|-------------|
| **Play Latest** | Play the newest queued message (ctrl+shift+p) |
| **Replay Last** | Re-play the most recent audio for free (ctrl+shift+r) |
| **Go Ahead (next hand)** | Grant the floor to the oldest raised hand (ctrl+shift+g) |
| **Raised Hands ✋** | Sessions waiting for the floor in announce mode. Click a name to grant; superseded-count chip when a hand was replaced. |
| **Agent Messages** | Queued responses grouped by session. Shows session name for Claude Code, thread title for Cursor. Click to play; items show processing state while generating audio. |
| **Recent Playback** | Last 20 played messages with session, character, and text preview. Click any to re-hear it — no API cost. |
| **Voice** | Select from your ElevenLabs voices (My Voices / Library Voices), paste a custom voice ID, or refresh the voice cache. |
| **Session Voices** | Assign different voices to different Claude Code sessions. Useful for distinguishing multiple concurrent sessions. |
| **Speed** | Playback speed submenu (0.75x – 2.0x). |
| **Notifications** | Toggle on/off. |
| **Playback** | Three-way mode: Auto / Announce / Silent (supersedes the old Streaming toggle). |
| **Notification Sound** | Random SFX, built-in macOS sounds, or custom sounds from `~/Library/Sounds`. Generate/regenerate SFX from here. |
| **ElevenLabs** | Shows your plan, character usage, remaining credits, and reset date. |
| **Debug / Logs** | Open config or log directory. |
| **Listening** | Start/stop listening for new agent responses. |

### Hotkeys

| Shortcut | Action |
|----------|--------|
| **ctrl+shift+p** | Play latest queued message |
| **ctrl+shift+r** | Replay last played message |
| **ctrl+shift+g** | Go ahead — grant floor to next raised hand |
| **ctrl+shift+space** | Pause / Resume playback |

## Text Processing Pipeline

Raw agent responses go through two stages before synthesis:

### 1. Gemini Preprocessing (`tts-server/src/gemini.ts`)

Converts developer-oriented markdown into natural spoken text with ElevenLabs v3 audio tags:

- Removes code blocks, file paths, shell commands
- Converts technical references to natural speech ("the Button component" instead of `src/components/Button.tsx`)
- Adds emotion tags: `[sighs]`, `[excited]`, `[whispers]`, `[laughs]`
- Uses CAPS for emphasis and ellipses for natural pauses
- Summarizes long lists instead of reading each item
- Targets under 4000 characters

### 2. Fallback: Local Cleaning (`fallbackClean` in `tts-server/src/gemini.ts`)

Used when Gemini is unavailable (output capped at 1,200 chars to limit TTS spend on unpolished text):

- Strips fenced code blocks, inline code, and code-like lines
- Humanizes file paths and technical identifiers (camelCase, kebab-case, snake_case)
- Converts markdown tables to prose
- Removes images, bold/italic markers, link URLs

A python twin (`clean_text.py`) generates notification previews.

## Character Personas

Each ElevenLabs voice can have a character profile in `tts-server/src/characters.json` (gitignored — copy `characters.example.json`): name, personality, speech style, and example lines. When a session's voice has a profile, Gemini rewrites responses *as that character*, prompt acks are generated in their voice, and question readouts stay in character.

## Voice Control

Push-to-talk via Raycast hotkey (`scripts/raycast/push-to-talk.sh` → `voice_ptt.sh`). Records mic → **whisper.cpp** local STT (free, `ggml-base.en`) → command router (`tts-server/src/voice.ts`). Ducks playback while recording.

| Command | Action |
|---------|--------|
| **go ahead** [name] | Grant floor (next hand, or named session) |
| **pause** / **resume** | Pause or resume playback |
| **stop** | Stop playback |
| **say again** | Replay last message |
| **status** | Read room state aloud (hands up, who's working) |
| **mute** / **unmute** `name` | Toggle session mute |
| **clear** `name` | Drop a raised hand without playing |
| **tell** `name` … | Inject text into a team session (see Team Sessions) |

Nicknames resolve to character names: donnie/don, mikey/mike, raph/ralph, leo. Whisper prompt biasing includes live session names.

Optional spoken aliases in `~/.cursor/tts/aliases.json` — whole-transcript map applied before grammar matching (`{"shut it": "stop", "who is up": "status"}`).

First run: macOS will prompt for microphone access (Raycast or the shell host). Pin input via `mic_device` in config if needed.

## Team Sessions

`team.sh <persona> [project-dir]` launches a persona'd Claude Code session in tmux (`cr-<persona>`) and writes `~/.cursor/tts/team_map.json` (persona → sessionId + tmux target). Assigns the persona's voice automatically.

Only team-launched sessions accept **tell** injection (`inject_prompt.sh` → `tmux send-keys`). Voice: "tell donnie fix the login bug" routes into Donnie's pane.

Requires tmux (`brew install tmux`).

## Arcade Buttons

USB encoder plugs directly into the Mac as a HID gamepad — no Raspberry Pi for input.

1. Set `"arcade_enabled": true` in config and restart the daemon.
2. Map buttons: `cd tts-server && pnpm exec tsx src/hid.ts learn` — press each button when prompted; writes `~/.cursor/tts/arcade_buttons.json`.
3. Character buttons map to personas by voice (press = grant floor; tap while speaking = stop). System buttons: grant next, replay, stop, cycle playback mode. Hold = push-to-talk to that agent.

## The Room Panel

Floating agent panel: Tauri v2 + **tauri-nspanel** (non-activating, visible on all Spaces). Launch: `bash scripts/panel.sh` (opens built `.app` or runs `pnpm tauri dev`).

- Per-voice turtle avatars (`panel/public/avatars/`), state badges (working / hand raised / speaking)
- Subscribes to tts-server WebSocket (`panel_port`, token in `panel_ws_token`)
- **Click** agent card = grant floor; **hold** = push-to-talk to that session
- Playback controls (pause, stop, replay)

Build from repo: `cd panel && pnpm install && pnpm tauri build` (requires Rust).

## Claude Code Integration

The `Stop` hook (`hook_stop.sh` → `tts-server/src/ingest.ts`):

- Reads the hook payload from stdin (contains `transcript_path` and `session_id`)
- Retries briefly until the transcript flushes the final assistant message
- Parses the JSONL transcript in reverse to find the latest assistant text
- Deduplicates by MD5 hash (per session) to avoid re-queuing the same response
- Looks up the session name from `~/.claude/sessions/` for display
- Queues with `source: "claude-code"` for identification

(`ingest_claude_code.sh` is a bash fallback for machines without pnpm.)

## Notification Sounds

The tool can generate dynamic notification sounds via the ElevenLabs Sound Effects API:

- **Random SFX mode**: Each notification plays a random pre-generated sound effect
- **Categories**: boom, bram, fantasy, impact, weapon
- **Cache**: 10 sounds stored in `~/.cursor/tts/sounds/default/`
- **Generate**: From the menu: "Generate New SFX" or "Regenerate All SFX"
- **Themes**: Sound directory structured as `sounds/<theme>/` for future theme support (titanfall, tmnt, halo)

## File Layout

```
~/.cursor/tts/
  .env                              # API keys (ELEVENLABS_API_KEY, GEMINI_API_KEY)
  config.json                       # voice, speed, playback mode, notification settings
  session_voices.json               # per-session voice overrides
  aliases.json                      # optional spoken phrase → canonical command map
  muted_sessions.json               # sessions muted from auto-play and acks
  team_map.json                     # persona → tmux target + sessionId (written by team.sh)
  arcade_buttons.json               # USB encoder button map (written by hid.ts learn)
  panel_ws_token                    # WebSocket auth token for the Room panel
  queue/                            # unplayed response JSON files
  played/                           # responses after playback (or after synthesis if stopped)
  failed/                           # responses that errored (invalid JSON, TTS failure)
  replay/                           # last 20 played mp3s + metadata sidecars
  state/                            # per-session room state (working | hand_raised | speaking | idle)
  ptt/                              # push-to-talk wav scratch files
  models/                           # whisper.cpp model (ggml-base.en.bin)
  fixtures/                         # voice-router dry-run samples (optional)
  sounds/default/                   # cached notification SFX (.mp3)
  sounds/phrases/<voiceId>/         # cached ack + announce + grant phrases per voice
  cache/                            # voices.json, credits.json, titles/
  icons/                            # TMNT menu bar and notification icons
  scripts/                          # all scripts (deployed from repo)
  tts-server/                       # Node.js watcher daemon (synced from repo)
  logs/                             # hook.log, server.log
  .processing/                      # playback processing markers (prevents double-play)

panel/                              # Room agent panel (Tauri — repo only, not copied to ~/.cursor/tts)
```

## Manual Enqueue

```bash
# Queue clipboard contents
pbpaste | ~/.cursor/tts/scripts/enqueue_manual.sh "My thread title"

# Pipe from a file
~/.cursor/tts/scripts/enqueue_manual.sh "Review notes" < ~/Desktop/missed-reply.md

# Inline text
echo "Remember to update the API keys" | ~/.cursor/tts/scripts/enqueue_manual.sh
```

### Raycast Script Commands

Optional Raycast scripts in `scripts/raycast/`:

| Script | What it does |
|--------|-------------|
| `start-cursor-read-aloud.sh` | Start SwiftBar and enable listening |
| `push-to-talk.sh` | Toggle push-to-talk (record → transcribe → route) |
| `go-ahead-next.sh` | Grant floor to next raised hand |
| `enqueue-read-aloud-clipboard.sh` | Queue clipboard contents |
| `enqueue-read-aloud-file.sh` | Queue a file's contents |
| `enqueue-read-aloud-text.sh` | Queue inline text |

## Troubleshooting

- **No audio**: Check `~/.cursor/tts/logs/hook.log` for ElevenLabs API errors
- **Robotic speech**: Ensure `GEMINI_API_KEY` is set — without it, text goes through basic local cleaning instead of Gemini's natural speech conversion
- **Hook not firing (Cursor)**: Verify `~/.cursor/hooks.json` exists and Cursor is restarted
- **Hook not firing (Claude Code)**: Check `~/.claude/settings.json` has the Stop hook. Start a new session after changing hook config.
- **Notification one message behind**: The ingest retries briefly for transcript flush timing. If still stale, check `hook.log` for what was extracted.
- **SwiftBar not showing**: Ensure SwiftBar is running and the plugin is in the correct plugins directory
- **Speed not working**: Speeds above 1.2x apply an `ffplay` atempo filter on top of ElevenLabs' native speed parameter
- **Auto-play when Streaming shows Off**: fixed — the watcher now checks the flag live. If it recurs, check for a second watcher process (`pgrep -fl "src/index.ts"`).
- **Double playback**: Processing markers in `.processing/` prevent the same message from being synthesized twice when clicking both notification and menu item

### Custom Notifier App

For a custom notification icon on the left side of banners:

1. Install terminal-notifier (`brew install --cask terminal-notifier`)
2. Run `bash scripts/build_read_aloud_notifier_app.sh`
3. Set `"terminal_notifier_app"` in config to the built `.app` path
4. First launch: right-click → Open if macOS blocks it

For macOS 15+ (Sequoia), you may need to build terminal-notifier from source with a bumped deployment target — see [this issue](https://github.com/julienXX/terminal-notifier/issues/312).
