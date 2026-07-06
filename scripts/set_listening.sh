#!/usr/bin/env bash
#
# set_listening.sh — Pause/resume TTS: toggles the listening flag that the
# ingest hooks check, and stops playback when turning off.
#
# Usage: set_listening.sh on|off|toggle
#
set -euo pipefail

TTS_DIR="$HOME/.cursor/tts"
FLAG="$TTS_DIR/listening.enabled"
SCRIPTS_DIR="$TTS_DIR/scripts"
LOG_FILE="$TTS_DIR/logs/hook.log"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] set_listening: $*" >> "$LOG_FILE" 2>/dev/null || true; }

mkdir -p "$TTS_DIR" "$(dirname "$LOG_FILE")"

MODE="${1:-toggle}"

case "$MODE" in
    on|1|start|true)
        echo 1 > "$FLAG"
        log "Listening ON"
        ;;
    off|0|stop|false)
        echo 0 > "$FLAG"
        log "Listening OFF"
        if [ -x "$SCRIPTS_DIR/stop.sh" ]; then
            "$SCRIPTS_DIR/stop.sh" 2>/dev/null || true
        fi
        ;;
    toggle)
        cur=1
        if [ -f "$FLAG" ]; then
            case "$(tr -d ' \n' < "$FLAG")" in
                0|false|FALSE|off) cur=0 ;;
            esac
        fi
        if [ "$cur" -eq 1 ]; then
            exec "$0" off
        else
            exec "$0" on
        fi
        ;;
    *)
        echo "Usage: $0 on|off|toggle" >&2
        exit 1
        ;;
esac

exit 0
