#!/usr/bin/env bash
#
# restart.sh — Re-run play.sh on the current queue item from the beginning.
#
set -euo pipefail

TTS_DIR="$HOME/.cursor/tts"
SCRIPTS_DIR="$TTS_DIR/scripts"
PLAYBACK_REF="$TTS_DIR/.playback-file"
LOG_FILE="$TTS_DIR/logs/hook.log"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] restart: $*" >> "$LOG_FILE" 2>/dev/null || true; }

mkdir -p "$(dirname "$LOG_FILE")"

if [ ! -f "$PLAYBACK_REF" ]; then
    log "No .playback-file — nothing to restart"
    exit 1
fi

QUEUE_FILE=$(tr -d '\n' < "$PLAYBACK_REF")
if [ -z "$QUEUE_FILE" ] || [ ! -f "$QUEUE_FILE" ]; then
    log "Queue file missing: $QUEUE_FILE"
    exit 1
fi

exec "$SCRIPTS_DIR/play_node.sh" "$QUEUE_FILE"
