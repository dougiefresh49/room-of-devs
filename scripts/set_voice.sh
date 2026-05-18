#!/usr/bin/env bash
#
# set_voice.sh — Set ElevenLabs voice ID in config.json.
#
# Usage: set_voice.sh <voice-id>
#   e.g. set_voice.sh pNInz6obpgDQGcFmaJgB
#
set -euo pipefail

TTS_DIR="$HOME/.cursor/tts"
CONFIG="$TTS_DIR/config.json"
LOG_FILE="$TTS_DIR/logs/hook.log"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] set_voice: $*" >> "$LOG_FILE" 2>/dev/null || true; }

mkdir -p "$TTS_DIR" "$(dirname "$LOG_FILE")"

VOICE_ID="${1:-}"
if [ -z "$VOICE_ID" ]; then
    echo "Usage: $0 <voice-id>" >&2
    exit 1
fi

if [ ! -f "$CONFIG" ]; then
    echo '{}' > "$CONFIG"
fi

python3 - "$VOICE_ID" "$CONFIG" <<'PY'
import json, sys

voice_id, path = sys.argv[1], sys.argv[2]

with open(path, encoding="utf-8") as f:
    config = json.load(f)

config["elevenlabs_voice_id"] = voice_id

with open(path, "w", encoding="utf-8") as f:
    json.dump(config, f, indent=2)
    f.write("\n")
PY

log "Set ElevenLabs voice to $VOICE_ID"

# Pre-generate phrases for this voice in the background
SERVER_DIR="$TTS_DIR/tts-server"
if [ -f "$SERVER_DIR/src/phrases.ts" ] && command -v pnpm &>/dev/null; then
    (cd "$SERVER_DIR" && pnpm exec tsx src/phrases.ts "$VOICE_ID") &>/dev/null &
fi
