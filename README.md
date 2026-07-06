# <img src="icons/tmnt-notification-queued.png" alt="Read aloud" width="40" /> Cursor Read Aloud

A macOS menu bar tool that reads AI coding agent responses aloud using [ElevenLabs](https://elevenlabs.io) TTS. Supports both **Cursor IDE** and **Claude Code** with natural speech powered by Gemini text preprocessing and ElevenLabs v3 audio tags.

## How It Works

1. A hook captures each assistant reply and queues it as a JSON file:
   - **Cursor**: `afterAgentResponse` hook in `~/.cursor/hooks.json`
   - **Claude Code**: `Stop` hook in `~/.claude/settings.json` (reads transcript JSONL)
2. A **SwiftBar** menu bar plugin lists queued responses grouped by session/thread with playback controls
3. Text is processed through **Gemini** (converts markdown to natural speech with emotion tags) then synthesized via **ElevenLabs TTS** (eleven_v3 model)
4. Falls back to macOS `say` if ElevenLabs is unavailable

## Prerequisites

- macOS
- Python 3.9+
- [SwiftBar](https://github.com/swiftbar/SwiftBar) (`brew install --cask swiftbar`)
- [ElevenLabs](https://elevenlabs.io) API key
- [Gemini](https://ai.google.dev) API key (optional, for text preprocessing)

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

For **Claude Code** support, add the Stop hook to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash",
            "args": ["/Users/YOU/.cursor/tts/scripts/ingest_claude_code.sh"],
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
  "gemini_model": "gemini-2.0-flash-lite",
  "default_speed": 1.25,
  "notifications_enabled": true,
  "notification_icon": "~/.cursor/tts/icons/tmnt-notification-queued.png",
  "notification_sender": "",
  "terminal_notifier_app": "",
  "notification_sound": "random_sfx",
  "sfx_categories": ["boom", "bram", "fantasy", "impact", "weapon"],
  "played_retention_count": 50
}
```

| Key | Description |
|-----|-------------|
| **elevenlabs_voice_id** | Voice ID from your ElevenLabs account. Set via the Voice menu or Paste Voice ID. |
| **elevenlabs_model_id** | ElevenLabs model (`eleven_v3` recommended). |
| **gemini_model** | Gemini model for text preprocessing. Falls back to local `clean_text.py` if unavailable. |
| **default_speed** | Playback speed (0.75x–2.0x). ElevenLabs handles up to 1.2x natively; faster speeds use `afplay` rate adjustment. |
| **notifications_enabled** | macOS notifications when a reply is queued. Click to play. |
| **notification_sound** | `random_sfx` (ElevenLabs-generated), `default`, `none`, or any macOS alert sound name. |
| **sfx_categories** | Categories for generated notification sound effects. |
| **played_retention_count** | Max played files to keep before auto-cleanup (default 50). |

## Menu Bar Controls

| Section | Description |
|---------|-------------|
| **Play Latest** | Play the newest queued message (ctrl+shift+p) |
| **Agent Messages** | Queued responses grouped by session. Shows session name for Claude Code, thread title for Cursor. Click to play; items show processing state while generating audio. |
| **Voice** | Select from your ElevenLabs voices (My Voices / Library Voices), paste a custom voice ID, or refresh the voice cache. |
| **Session Voices** | Assign different voices to different Claude Code sessions. Useful for distinguishing multiple concurrent sessions. |
| **Speed** | Playback speed submenu (0.75x – 2.0x). |
| **Notifications** | Toggle on/off. |
| **Notification Sound** | Random SFX, built-in macOS sounds, or custom sounds from `~/Library/Sounds`. Generate/regenerate SFX from here. |
| **ElevenLabs** | Shows your plan, character usage, remaining credits, and reset date. |
| **Debug / Logs** | Open config or log directory. |
| **Listening** | Start/stop listening for new agent responses. |

### Hotkeys

| Shortcut | Action |
|----------|--------|
| **ctrl+shift+p** | Play latest queued message |
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

### 2. Fallback: Local Cleaning (`clean_text.py`)

Used when Gemini is unavailable:

- Strips fenced code blocks and inline code
- Humanizes file paths and technical identifiers (camelCase, kebab-case, snake_case)
- Converts markdown tables to prose
- Removes images, bold/italic markers, link URLs

## Claude Code Integration

The `ingest_claude_code.sh` hook:

- Reads the hook payload from stdin (contains `transcript_path` and `session_id`)
- Waits briefly for the transcript to flush the final assistant message
- Parses the JSONL transcript in reverse to find the latest assistant text
- Deduplicates by MD5 hash to avoid re-queuing the same response
- Looks up the session name from `~/.claude/sessions/` for display
- Queues with `source: "claude-code"` for identification

## Notification Sounds

The tool can generate dynamic notification sounds via the ElevenLabs Sound Effects API:

- **Random SFX mode**: Each notification plays a random pre-generated sound effect
- **Categories**: boom, bram, fantasy, impact, weapon (configurable)
- **Cache**: 10 sounds stored in `~/.cursor/tts/sounds/default/`
- **Generate**: From the menu: "Generate New SFX" or "Regenerate All SFX"
- **Themes**: Sound directory structured as `sounds/<theme>/` for future theme support (titanfall, tmnt, halo)

## File Layout

```
~/.cursor/tts/
  .env                              # API keys (ELEVENLABS_API_KEY, GEMINI_API_KEY)
  config.json                       # voice, speed, notification settings
  session_voices.json               # per-session voice overrides
  queue/                            # unplayed response JSON files
  played/                           # responses after playback
  sounds/default/                   # cached notification SFX (.mp3)
  cache/                            # voices.json, credits.json
  icons/                            # TMNT menu bar and notification icons
  scripts/                          # all scripts (deployed from repo)
  logs/                             # hook.log
  .processing/                      # playback processing markers (prevents double-play)
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
| `enqueue-read-aloud-clipboard.sh` | Queue clipboard contents |
| `enqueue-read-aloud-file.sh` | Queue a file's contents |
| `enqueue-read-aloud-text.sh` | Queue inline text |

## Troubleshooting

- **No audio**: Check `~/.cursor/tts/logs/hook.log` for ElevenLabs API errors
- **Robotic speech**: Ensure `GEMINI_API_KEY` is set — without it, text goes through basic local cleaning instead of Gemini's natural speech conversion
- **Hook not firing (Cursor)**: Verify `~/.cursor/hooks.json` exists and Cursor is restarted
- **Hook not firing (Claude Code)**: Check `~/.claude/settings.json` has the Stop hook. Start a new session after changing hook config.
- **Notification one message behind**: The `sleep 2` in `ingest_claude_code.sh` handles transcript flush timing. If still stale, increase the delay.
- **SwiftBar not showing**: Ensure SwiftBar is running and the plugin is in the correct plugins directory
- **SSL errors**: The scripts use `curl` for all API calls to avoid Python SSL certificate issues on macOS
- **Speed not working**: Speeds above 1.2x use `afplay -r` rate adjustment on top of ElevenLabs' native speed parameter
- **Double playback**: Processing markers in `.processing/` prevent the same message from being synthesized twice when clicking both notification and menu item

### Custom Notifier App

For a custom notification icon on the left side of banners:

1. Install terminal-notifier (`brew install --cask terminal-notifier`)
2. Run `bash scripts/build_read_aloud_notifier_app.sh`
3. Set `"terminal_notifier_app"` in config to the built `.app` path
4. First launch: right-click → Open if macOS blocks it

For macOS 15+ (Sequoia), you may need to build terminal-notifier from source with a bumped deployment target — see [this issue](https://github.com/julienXX/terminal-notifier/issues/312).
