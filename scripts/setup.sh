#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TTS_DIR="$HOME/.cursor/tts"
HOOKS_DIR="$HOME/.cursor"
SWIFTBAR_PLUGINS_DIR="${SWIFTBAR_PLUGINS_DIR:-$HOME/projects/Swiftbar/Plugins}"

AUTOSTART=false
for arg in "$@"; do
    case "$arg" in
        --autostart) AUTOSTART=true ;;
    esac
done

log() { echo "[setup] $*"; }
err() { echo "[setup] ERROR: $*" >&2; }

# ── 1. Create directory structure ──────────────────────────────────
log "Creating directory structure under $TTS_DIR"
mkdir -p "$TTS_DIR"/{queue,played,cache,scripts,logs,icons,sounds/default,ptt,models}

# ── 1b. Menu bar + notification icons ─────────────────────────────
ICON_SRC_DIR="$PROJECT_DIR/icons"
ICON_DST_DIR="$TTS_DIR/icons"
if [ -d "$ICON_SRC_DIR" ] && [ -f "$ICON_SRC_DIR/tmnt-icon.png" ] && [ -f "$ICON_SRC_DIR/tmnt-notification-queued.png" ]; then
    log "Installing icons to $ICON_DST_DIR"
    cp -f "$ICON_SRC_DIR/tmnt-icon.png" "$ICON_DST_DIR/tmnt-icon.png"
    cp -f "$ICON_SRC_DIR/tmnt-notification-queued.png" "$ICON_DST_DIR/tmnt-notification-queued.png"
    if command -v sips >/dev/null 2>&1; then
        sips -Z 36 "$ICON_DST_DIR/tmnt-icon.png" --out "$ICON_DST_DIR/tmnt-menubar-idle.png" >/dev/null 2>&1 \
            || cp -f "$ICON_DST_DIR/tmnt-icon.png" "$ICON_DST_DIR/tmnt-menubar-idle.png"
        sips -Z 36 "$ICON_DST_DIR/tmnt-notification-queued.png" --out "$ICON_DST_DIR/tmnt-menubar-queued.png" >/dev/null 2>&1 \
            || cp -f "$ICON_DST_DIR/tmnt-notification-queued.png" "$ICON_DST_DIR/tmnt-menubar-queued.png"
    else
        cp -f "$ICON_DST_DIR/tmnt-icon.png" "$ICON_DST_DIR/tmnt-menubar-idle.png"
        cp -f "$ICON_DST_DIR/tmnt-notification-queued.png" "$ICON_DST_DIR/tmnt-menubar-queued.png"
    fi
else
    log "Optional repo icons missing under $ICON_SRC_DIR (SwiftBar uses emoji fallback)"
fi

# ── 2. Copy .env file ────────────────────────────────────────────
ENV_FILE="$PROJECT_DIR/.env"
ENV_DEST="$TTS_DIR/.env"
if [ -f "$ENV_FILE" ]; then
    if [ ! -f "$ENV_DEST" ] || ! diff -q "$ENV_FILE" "$ENV_DEST" >/dev/null 2>&1; then
        log "Copying .env to $ENV_DEST"
        cp "$ENV_FILE" "$ENV_DEST"
    else
        log ".env already up to date"
    fi
else
    log "No .env file found at $ENV_FILE — API keys must be set manually in $ENV_DEST"
fi

# ── 4. Copy scripts ──────────────────────────────────────────────
log "Installing scripts to $TTS_DIR/scripts/"
for script in \
    ingest.sh play_node.sh stop.sh pause.sh play_latest.sh media_control.sh \
    restart.sh quit.sh set_speed.sh clear_queue.sh clear_thread_queue.sh clear_session_queue.sh \
    grant_floor.sh \
    set_listening.sh enqueue_manual.sh set_voice.sh \
    notify_queued.sh set_notifications.sh set_notification_sound.sh \
    clean_text.py fetch_voices.py load_env.sh \
    paste_voice_id.sh generate_sfx.sh random_sfx.sh cleanup_played.sh \
    build_read_aloud_notifier_app.sh \
    hook_stop.sh hook_prompt.sh hook_ask_user.sh hook_session_end.sh tts-server.sh mobile_url.sh \
    set_streaming.sh set_playback_mode.sh set_mood.sh announce.sh replay.sh panel.sh \
    set_session_mute.sh set_session_voice.sh nickname.sh \
    ingest_claude_code.sh fetch_credits.sh \
    ptt.sh voice_ptt.sh \
    team.sh inject_prompt.sh hold_room.sh cancel_inject.sh; do
    if [ -f "$PROJECT_DIR/scripts/$script" ]; then
        cp "$PROJECT_DIR/scripts/$script" "$TTS_DIR/scripts/$script"
    fi
done
chmod +x "$TTS_DIR/scripts/"*.sh "$TTS_DIR/scripts/"*.py 2>/dev/null || true

# ── 4b. Install Node.js TTS server ──────────────────────────────
if command -v pnpm &>/dev/null; then
    log "Installing Node.js TTS server..."
    TTS_SERVER_DEST="$TTS_DIR/tts-server"
    rm -rf "$TTS_SERVER_DEST"
    cp -r "$PROJECT_DIR/tts-server" "$TTS_SERVER_DEST"
    # src/protocol is a repo symlink into packages/protocol — replace it with
    # real staged files; the installed daemon must never resolve into the repo.
    rm -rf "$TTS_SERVER_DEST/src/protocol"
    if [ -d "$PROJECT_DIR/packages/protocol/src" ]; then
        mkdir -p "$TTS_SERVER_DEST/src/protocol"
        cp -R "$PROJECT_DIR/packages/protocol/src/." "$TTS_SERVER_DEST/src/protocol/"
    fi
    # In-repo node_modules is a pnpm-workspace symlink farm — never usable in
    # place; make sure the copy didn't drag a broken one along.
    rm -rf "$TTS_SERVER_DEST/node_modules"
    cd "$TTS_SERVER_DEST"
    pnpm install --frozen-lockfile 2>/dev/null || pnpm install
    log "TTS server installed at $TTS_SERVER_DEST"
    cd "$PROJECT_DIR"
else
    log "pnpm not found — skipping Node.js TTS server install"
    log "  Install pnpm: npm install -g pnpm"
fi

# ── 5. Write default config (if not present) ──────────────────────
CONFIG_FILE="$TTS_DIR/config.json"
if [ -f "$CONFIG_FILE" ]; then
    log "Config already exists at $CONFIG_FILE — migrating fields"
else
    log "Writing default config to $CONFIG_FILE"
    cp "$PROJECT_DIR/config/config.json" "$CONFIG_FILE"
fi

# Migrate config: add new ElevenLabs fields, preserve user values
python3 - <<'PY'
import json
import os

p = os.path.join(os.path.expanduser("~"), ".cursor", "tts", "config.json")
try:
    with open(p, encoding="utf-8") as f:
        c = json.load(f)
except (OSError, json.JSONDecodeError):
    raise SystemExit(0)

defaults = {
    "elevenlabs_voice_id": "",
    "elevenlabs_model_id": "eleven_v3",
    "gemini_model": "gemini-3.1-flash-lite",
    "default_speed": 1.25,
    "notifications_enabled": False,
    "notification_icon": "~/.cursor/tts/icons/tmnt-notification-queued.png",
    "notification_sender": "",
    "terminal_notifier_app": "",
    "notification_sound": "random_sfx",
    "streaming_enabled": False,
    "streaming_session_prefix": "auto",
    "played_retention_count": 50,
    "mic_device": ":default",
    "arcade_enabled": False,
    "panel_port": 4780,
    "dnd_auto": False,
    "dnd_apps": ["zoom.us", "FaceTime", "Microsoft Teams", "Webex"],
    "victory_lines": True,
}

changed = False
for key, val in defaults.items():
    if key not in c:
        c[key] = val
        changed = True

# Drop stale Piper-era keys
for stale in ("sfx_categories", "model", "piper_port"):
    if stale in c:
        del c[stale]
        changed = True

if c.get("notification_icon") == "~/.cursor/tts/icons/tmnt-icon.png":
    c["notification_icon"] = "~/.cursor/tts/icons/tmnt-notification-queued.png"
    changed = True

if changed:
    with open(p, "w", encoding="utf-8") as f:
        json.dump(c, f, indent=2)
        f.write("\n")
PY

# ── 5a. Default arcade button map (learn mode fills in the buttons) ─
ARCADE_FILE="$TTS_DIR/arcade_buttons.json"
if [ -f "$ARCADE_FILE" ]; then
    log "Arcade button map already exists at $ARCADE_FILE"
else
    log "Writing default arcade button map to $ARCADE_FILE"
    cat > "$ARCADE_FILE" <<'JSON'
{
  "device_hint": "joystick|usb gamepad|generic",
  "buttons": {}
}
JSON
    log "  Run 'pnpm exec tsx src/hid.ts learn' in tts-server to map the buttons"
fi

# ── 5b. Mic device discovery (log only; pin via mic_device in config) ─
if command -v ffmpeg >/dev/null 2>&1; then
    log "Audio input devices (ffmpeg avfoundation):"
    ffmpeg -f avfoundation -list_devices true -i "" 2>&1 | while IFS= read -r line; do
        log "  $line"
    done || true
else
    log "ffmpeg not found — skipping mic device discovery"
fi

# ── 5c. Whisper model (local STT for push-to-talk) ────────────────
WHISPER_MODEL="$TTS_DIR/models/ggml-base.en.bin"
if [ -f "$WHISPER_MODEL" ]; then
    log "Whisper model present at $WHISPER_MODEL"
else
    log "Whisper model not found at $WHISPER_MODEL"
    log "  Download once (~140MB):"
    log "    mkdir -p $TTS_DIR/models"
    log "    curl -L -o $WHISPER_MODEL https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin"
    log "  Also requires: brew install whisper-cpp tmux"
fi

# ── 5d. Voice command aliases (optional spoken → canonical map) ───
ALIASES_FILE="$TTS_DIR/aliases.json"
if [ -f "$ALIASES_FILE" ]; then
    log "Voice aliases already exist at $ALIASES_FILE"
else
    log "Writing default voice aliases to $ALIASES_FILE"
    echo '{}' > "$ALIASES_FILE"
fi

# ── 6. Install hooks.json ─────────────────────────────────────────
HOOKS_FILE="$HOOKS_DIR/hooks.json"
if [ -f "$HOOKS_FILE" ]; then
    if grep -q "afterAgentResponse" "$HOOKS_FILE" 2>/dev/null; then
        log "afterAgentResponse hook already registered in $HOOKS_FILE"
    else
        err "$HOOKS_FILE exists but does not contain afterAgentResponse hook."
        err "Please merge manually from: $PROJECT_DIR/config/hooks.json"
    fi
else
    log "Installing hooks.json to $HOOKS_FILE"
    cp "$PROJECT_DIR/config/hooks.json" "$HOOKS_FILE"
fi

# ── 6b. Merge SessionEnd into ~/.claude/settings.json (idempotent) ─
# Cursor hooks live in hooks.json (above). Claude Code hooks live here.
# Safe JSON merge — preserves unrelated keys; no-ops if already registered.
CLAUDE_SETTINGS="$HOME/.claude/settings.json"
SESSION_END_HOOK="$TTS_DIR/scripts/hook_session_end.sh"
MERGE_RESULT="$(
CLAUDE_SETTINGS="$CLAUDE_SETTINGS" SESSION_END_HOOK="$SESSION_END_HOOK" python3 - <<'PY'
import json
import os

path = os.environ["CLAUDE_SETTINGS"]
hook_script = os.environ["SESSION_END_HOOK"]
entry = {
    "type": "command",
    "command": "bash",
    "args": [hook_script],
}

def is_our_hook(h):
    if not isinstance(h, dict):
        return False
    if h.get("command") == "bash" and h.get("args") == [hook_script]:
        return True
    cmd = h.get("command")
    return isinstance(cmd, str) and hook_script in cmd

data = {}
if os.path.isfile(path):
    # Never overwrite a settings file we couldn't parse — that would silently
    # discard the user's model/plugin/hook config. Bail and ask for repair.
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, json.JSONDecodeError):
        print("unreadable")
        raise SystemExit(0)
    if not isinstance(data, dict):
        print("unreadable")
        raise SystemExit(0)

hooks = data.get("hooks")
if not isinstance(hooks, dict):
    hooks = {}
    data["hooks"] = hooks

groups = hooks.get("SessionEnd")
if not isinstance(groups, list):
    groups = []
    hooks["SessionEnd"] = groups

found = False
for group in groups:
    if not isinstance(group, dict):
        continue
    inner = group.get("hooks")
    if not isinstance(inner, list):
        continue
    if any(is_our_hook(h) for h in inner):
        found = True
        break

if found:
    print("exists")
else:
    groups.append({"hooks": [entry]})
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp = f"{path}.tmp.{os.getpid()}"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2)
        fh.write("\n")
    os.replace(tmp, path)
    print("added")
PY
)"
if [ "$MERGE_RESULT" = "added" ]; then
    log "Added SessionEnd hook to $CLAUDE_SETTINGS"
elif [ "$MERGE_RESULT" = "exists" ]; then
    log "SessionEnd hook already registered in $CLAUDE_SETTINGS"
elif [ "$MERGE_RESULT" = "unreadable" ]; then
    log "WARNING: $CLAUDE_SETTINGS is not valid JSON — left untouched; add the SessionEnd hook manually after repairing it"
else
    log "SessionEnd merge skipped/failed (result=${MERGE_RESULT:-empty})"
fi

# ── 8. Install SwiftBar plugin ─────────────────────────────────────
if [ -d "$SWIFTBAR_PLUGINS_DIR" ]; then
    log "Installing SwiftBar plugin to $SWIFTBAR_PLUGINS_DIR"
    cp "$PROJECT_DIR/plugins/cursor-read-aloud.5s.sh" "$SWIFTBAR_PLUGINS_DIR/"
    chmod +x "$SWIFTBAR_PLUGINS_DIR/cursor-read-aloud.5s.sh"
else
    log "SwiftBar plugin directory not found at $SWIFTBAR_PLUGINS_DIR"
    log "Install SwiftBar (brew install --cask swiftbar) then re-run setup,"
    log "or manually copy plugins/cursor-read-aloud.5s.sh to your SwiftBar plugins folder."
fi

# ── 8b. Install built Room.app (if present) ───────────────────────
ROOM_SRC="$PROJECT_DIR/panel/src-tauri/target/debug/bundle/macos/Room.app"
ROOM_DST="$TTS_DIR/Room.app"
if [ -d "$ROOM_SRC" ]; then
    log "Installing Room.app to $ROOM_DST"
    rsync -a --delete "$ROOM_SRC/" "$ROOM_DST/"
else
    log "Built Room.app not found at $ROOM_SRC (build panel first to install)"
fi

# ── 9. Fetch ElevenLabs voices ───────────────────────────────────
log "Fetching ElevenLabs voices..."
source "$TTS_DIR/scripts/load_env.sh" 2>/dev/null || true
if [ -n "${ELEVENLABS_API_KEY:-}" ]; then
    python3 "$TTS_DIR/scripts/fetch_voices.py" --refresh >/dev/null 2>&1 || log "Voice fetch failed (check API key)"
    VOICE_COUNT=$(python3 -c "import json; print(len(json.load(open('$TTS_DIR/cache/voices.json'))))" 2>/dev/null || echo "0")
    log "Cached $VOICE_COUNT ElevenLabs voices"
else
    log "No ELEVENLABS_API_KEY — skipping voice fetch"
fi

# ── 10. Pre-generate notification sounds ─────────────────────────
if [ -n "${ELEVENLABS_API_KEY:-}" ]; then
    SFX_COUNT=$(find "$TTS_DIR/sounds/default" -name '*.mp3' -maxdepth 1 2>/dev/null | wc -l | tr -d ' ')
    if [ "$SFX_COUNT" -lt 5 ]; then
        log "Generating notification sound effects..."
        "$TTS_DIR/scripts/generate_sfx.sh" 2>/dev/null || log "SFX generation failed (non-critical)"
        SFX_COUNT=$(find "$TTS_DIR/sounds/default" -name '*.mp3' -maxdepth 1 2>/dev/null | wc -l | tr -d ' ')
        log "Generated $SFX_COUNT notification sounds"
    else
        log "$SFX_COUNT notification sounds already cached"
    fi
fi

log ""
log "Setup complete! Summary:"
log "  Config:      $CONFIG_FILE"
log "  Scripts:     $TTS_DIR/scripts/"
log "  TTS Server:  $TTS_DIR/tts-server/"
log "  Queue:       $TTS_DIR/queue/"
log "  Sounds:      $TTS_DIR/sounds/default/"
log "  Hooks:       $HOOKS_FILE"
log "  TTS Engine:  ElevenLabs (eleven_v3) via Node.js server"
log ""
log "Next steps:"
log "  1. Set your ElevenLabs voice in the SwiftBar menu (Voice submenu)"
log "  2. Start the TTS server: $TTS_DIR/scripts/tts-server.sh start"
log "  3. Generate phrases: cd $TTS_DIR/tts-server && pnpm run generate-phrases"
log "  4. Enable streaming in SwiftBar menu for auto-play"
log ""
log "Hotkeys: SwiftBar menu — Play Latest (ctrl+shift+p), Pause/Resume (ctrl+shift+space)."
log ""

if [ "$AUTOSTART" = true ]; then
    log "Installing autostart LaunchAgent for TTS server..."
    PLIST="$HOME/Library/LaunchAgents/com.local.cursor-read-aloud-tts.plist"
    mkdir -p "$HOME/Library/LaunchAgents"
    if launchctl list 2>/dev/null | grep -q "com.local.cursor-read-aloud-tts"; then
        launchctl unload -w "$PLIST" 2>/dev/null || true
    fi
    cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.local.cursor-read-aloud-tts</string>
    <key>ProgramArguments</key>
    <array>
        <string>$TTS_DIR/scripts/tts-server.sh</string>
        <string>start</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
PLIST
    launchctl load -w "$PLIST"
    log "LaunchAgent installed: $PLIST"

    if [ -d "$ROOM_DST" ]; then
        log "Adding Room.app to login items..."
        osascript <<APPLESCRIPT
tell application "System Events"
    set roomPath to "$ROOM_DST"
    repeat with li in login items
        if path of li is roomPath then return
    end repeat
    make login item at end with properties {path:roomPath, hidden:false}
end tell
APPLESCRIPT
        log "Room.app login item configured"
    else
        log "Room.app not installed — skipping login item (build panel first)"
    fi
fi
