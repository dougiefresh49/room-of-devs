#!/usr/bin/env bash
#
# set_playback_mode.sh — Set playback mode (auto, announce, or silent).
# Usage: set_playback_mode.sh auto|announce|silent
#
set -euo pipefail

TTS_DIR="$HOME/.cursor/tts"
CONFIG="$TTS_DIR/config.json"
SCRIPTS_DIR="$TTS_DIR/scripts"
LOG_FILE="$TTS_DIR/logs/hook.log"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] set_playback_mode: $*" >> "$LOG_FILE" 2>/dev/null || true; }

MODE="${1:-}"
case "$MODE" in
    auto|announce|silent)
        python3 -c "
import json
path = '$CONFIG'
mode = '$MODE'
with open(path) as f:
    c = json.load(f)
c['playback_mode'] = mode
c['streaming_enabled'] = (mode == 'auto')
with open(path, 'w') as f:
    json.dump(c, f, indent=2)
"
        log "Playback mode set to $MODE"
        "$SCRIPTS_DIR/tts-server.sh" start 2>/dev/null || true
        ;;
    *)
        echo "Usage: set_playback_mode.sh auto|announce|silent" >&2
        exit 1
        ;;
esac
