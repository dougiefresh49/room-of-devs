#!/usr/bin/env bash
#
# set_streaming.sh — Enable or disable streaming auto-play mode.
# Usage: set_streaming.sh on|off
#
set -euo pipefail

TTS_DIR="$HOME/.cursor/tts"
CONFIG="$TTS_DIR/config.json"
SCRIPTS_DIR="$TTS_DIR/scripts"
LOG_FILE="$TTS_DIR/logs/hook.log"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] set_streaming: $*" >> "$LOG_FILE" 2>/dev/null || true; }

ACTION="${1:-}"
case "$ACTION" in
    on|true|1)
        python3 -c "
import json
path = '$CONFIG'
with open(path) as f:
    c = json.load(f)
c['streaming_enabled'] = True
with open(path, 'w') as f:
    json.dump(c, f, indent=2)
"
        log "Streaming enabled"
        "$SCRIPTS_DIR/tts-server.sh" start 2>/dev/null || true
        ;;
    off|false|0)
        python3 -c "
import json
path = '$CONFIG'
with open(path) as f:
    c = json.load(f)
c['streaming_enabled'] = False
with open(path, 'w') as f:
    json.dump(c, f, indent=2)
"
        "$SCRIPTS_DIR/tts-server.sh" stop 2>/dev/null || true
        log "Streaming disabled"
        ;;
    *)
        echo "Usage: set_streaming.sh on|off" >&2
        exit 1
        ;;
esac
