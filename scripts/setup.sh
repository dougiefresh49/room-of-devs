#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TTS_DIR="$HOME/.cursor/tts"
HOOKS_DIR="$HOME/.cursor"

AUTOSTART=false
# ElevenLabs voice-list + SFX refresh hits the network/API and is opt-in
# (owner decision 2026-07-21, refactor spec #8) — a plain install must never
# make API calls.
REFRESH_VOICES=false
for arg in "$@"; do
    case "$arg" in
        --autostart) AUTOSTART=true ;;
        --refresh-voices) REFRESH_VOICES=true ;;
    esac
done

log() { echo "[setup] $*"; }
err() { echo "[setup] ERROR: $*" >&2; }

# ── 1. Create directory structure ──────────────────────────────────
log "Creating directory structure under $TTS_DIR"
mkdir -p "$TTS_DIR"/{queue,played,cache,scripts,logs,icons,sounds/default,ptt,models}

# Record the repo this setup was run from so tts-server.sh can sync without
# an ambient env var or a hardcoded home-directory guess (audit C-3).
echo "$PROJECT_DIR" > "$TTS_DIR/repo_root"
log "Recorded repo root: $PROJECT_DIR"

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
# API keys must not be world-readable (audit H-7).
if [ -f "$ENV_DEST" ]; then
    chmod 600 "$ENV_DEST"
fi

# ── 3. Seed/migrate characters.json BEFORE tts-server wipe (audit C-2) ─
# Runtime persona registry lives at TTS_DIR, not under tts-server/src/.
CHARS_DEST="$TTS_DIR/characters.json"
CHARS_OLD="$TTS_DIR/tts-server/src/characters.json"
CHARS_EXAMPLE="$PROJECT_DIR/tts-server/src/characters.example.json"
if [ -f "$CHARS_DEST" ]; then
    log "characters.json already exists at $CHARS_DEST"
elif [ -f "$CHARS_OLD" ]; then
    log "Migrating characters.json from $CHARS_OLD"
    cp "$CHARS_OLD" "$CHARS_DEST"
elif [ -f "$CHARS_EXAMPLE" ]; then
    log "Seeding characters.json from example"
    cp "$CHARS_EXAMPLE" "$CHARS_DEST"
else
    err "No characters.json seed available (missing example and old install copy)"
fi

# ── 4. Sync scripts (directory sync + exclude list — audit A-7) ───
# Dev/install-only tools stay in the repo; everything else deploys.
log "Installing scripts to $TTS_DIR/scripts/"
rsync -a --delete \
    --exclude=setup.sh \
    --exclude=panel-dev-install.sh \
    --exclude=docs-publish.mjs \
    --exclude=raycast/ \
    "$PROJECT_DIR/scripts/" "$TTS_DIR/scripts/"
chmod +x "$TTS_DIR/scripts/"*.sh "$TTS_DIR/scripts/"*.py 2>/dev/null || true

# ── 4b. Install Node.js TTS server ──────────────────────────────
if command -v pnpm &>/dev/null; then
    log "Installing Node.js TTS server..."
    TTS_SERVER_DEST="$TTS_DIR/tts-server"
    rm -rf "$TTS_SERVER_DEST"
    cp -r "$PROJECT_DIR/tts-server" "$TTS_SERVER_DEST"
    # Persona registry is runtime data at $TTS_DIR/characters.json — never
    # leave a stale copy under installed src/ (rsync --delete would also
    # wipe it on every restart).
    rm -f "$TTS_SERVER_DEST/src/characters.json"
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
    if [ ! -f "$TTS_SERVER_DEST/pnpm-lock.yaml" ]; then
        err "pnpm-lock.yaml missing under $TTS_SERVER_DEST — cannot pin install"
        exit 1
    fi
    cd "$TTS_SERVER_DEST"
    # Fail loudly on lockfile drift — never fall back to an unpinned install
    # (audit H-8 / Q-13).
    pnpm install --frozen-lockfile
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

# ── 6. Install hooks.json with ABSOLUTE ingest path (audit H-1) ───
HOOKS_FILE="$HOOKS_DIR/hooks.json"
INGEST_ABS="$TTS_DIR/scripts/ingest.sh"
if [ -f "$HOOKS_FILE" ]; then
    if grep -q "afterAgentResponse" "$HOOKS_FILE" 2>/dev/null; then
        # Rewrite our hook command to the absolute install path (idempotent).
        HOOKS_FILE="$HOOKS_FILE" INGEST_ABS="$INGEST_ABS" python3 - <<'PY'
import json, os
path = os.environ["HOOKS_FILE"]
ingest = os.environ["INGEST_ABS"]
with open(path, encoding="utf-8") as f:
    data = json.load(f)
hooks = data.get("hooks") or {}
entries = hooks.get("afterAgentResponse") or []
changed = False
for entry in entries:
    if isinstance(entry, dict) and entry.get("command") != ingest:
        entry["command"] = ingest
        changed = True
if changed:
    tmp = f"{path}.tmp.{os.getpid()}"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
        f.write("\n")
    os.replace(tmp, path)
    print("updated")
else:
    print("ok")
PY
        log "afterAgentResponse hook registered in $HOOKS_FILE (absolute path)"
    else
        err "$HOOKS_FILE exists but does not contain afterAgentResponse hook."
        err "Please merge manually — command should be: $INGEST_ABS"
    fi
else
    log "Installing hooks.json to $HOOKS_FILE"
    cat > "$HOOKS_FILE" <<EOF
{
  "version": 1,
  "hooks": {
    "afterAgentResponse": [
      { "command": "$INGEST_ABS" }
    ]
  }
}
EOF
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

# ── 8. Remove retired SwiftBar plugin (Phase 6) ────────────────────
rm -f "${SWIFTBAR_PLUGINS_DIR:-$HOME/projects/Swiftbar/Plugins}/cursor-read-aloud.5s.sh"

# ── 8b. Install built Room.app (if present) ───────────────────────
ROOM_SRC="$PROJECT_DIR/panel/src-tauri/target/debug/bundle/macos/Room.app"
ROOM_DST="$TTS_DIR/Room.app"
if [ -d "$ROOM_SRC" ]; then
    log "Installing Room.app to $ROOM_DST"
    rsync -a --delete "$ROOM_SRC/" "$ROOM_DST/"
else
    log "Built Room.app not found at $ROOM_SRC (build panel first to install)"
fi

# ── 9+10. ElevenLabs voice cache + notification sounds (OPT-IN) ──
# API-touching refresh is decoupled from install: run
#   setup.sh --refresh-voices
# when voices/SFX actually need updating. SFX generation is billable.
if [ "$REFRESH_VOICES" = true ]; then
    log "Fetching ElevenLabs voices..."
    source "$TTS_DIR/scripts/load_env.sh" 2>/dev/null || true
    if [ -n "${ELEVENLABS_API_KEY:-}" ]; then
        python3 "$TTS_DIR/scripts/fetch_voices.py" --refresh >/dev/null 2>&1 || log "Voice fetch failed (check API key)"
        VOICE_COUNT=$(python3 -c "import json; print(len(json.load(open('$TTS_DIR/cache/voices.json'))))" 2>/dev/null || echo "0")
        log "Cached $VOICE_COUNT ElevenLabs voices"

        SFX_COUNT=$(find "$TTS_DIR/sounds/default" -name '*.mp3' -maxdepth 1 2>/dev/null | wc -l | tr -d ' ')
        if [ "$SFX_COUNT" -lt 5 ]; then
            log "Generating notification sound effects..."
            "$TTS_DIR/scripts/generate_sfx.sh" 2>/dev/null || log "SFX generation failed (non-critical)"
            SFX_COUNT=$(find "$TTS_DIR/sounds/default" -name '*.mp3' -maxdepth 1 2>/dev/null | wc -l | tr -d ' ')
            log "Generated $SFX_COUNT notification sounds"
        else
            log "$SFX_COUNT notification sounds already cached"
        fi
    else
        log "No ELEVENLABS_API_KEY — skipping voice/SFX refresh"
    fi
else
    log "Skipping ElevenLabs voice/SFX refresh (opt-in: setup.sh --refresh-voices)"
fi

log ""
log "Setup complete! Summary:"
log "  Config:      $CONFIG_FILE"
log "  Characters:  $CHARS_DEST"
log "  Scripts:     $TTS_DIR/scripts/"
log "  TTS Server:  $TTS_DIR/tts-server/"
log "  Queue:       $TTS_DIR/queue/"
log "  Sounds:      $TTS_DIR/sounds/default/"
log "  Hooks:       $HOOKS_FILE"
log "  TTS Engine:  ElevenLabs (eleven_v3) via Node.js server"
log ""
log "Next steps:"
log "  1. Start the TTS server: $TTS_DIR/scripts/tts-server.sh start"
log "  2. Generate phrases: cd $TTS_DIR/tts-server && pnpm run generate-phrases"
log "  3. Set voices / playback mode in the Room panel (Room.app)"
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
