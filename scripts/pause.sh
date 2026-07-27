#!/usr/bin/env bash
#
# pause.sh — Toggle pause/resume for active afplay TTS (SIGSTOP / SIGCONT).
#
set -euo pipefail

# Q-14: honor exported TTS_DIR (shared resolver).
# shellcheck disable=SC1091
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tts-dir.sh"
PID_FILE="$TTS_DIR/.playback-pid"
PAUSED_FLAG="$TTS_DIR/.playback-paused"
LOG_FILE="$TTS_DIR/logs/hook.log"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] pause: $*" >> "$LOG_FILE" 2>/dev/null || true; }

mkdir -p "$(dirname "$LOG_FILE")"

if [ ! -f "$PID_FILE" ]; then
    log "No active playback"
    exit 0
fi

PID=$(cat "$PID_FILE" 2>/dev/null || true)
if [ -z "$PID" ] || ! kill -0 "$PID" 2>/dev/null; then
    log "Playback PID invalid or dead"
    rm -f "$PID_FILE" "$PAUSED_FLAG"
    exit 0
fi

if [ -f "$PAUSED_FLAG" ]; then
    kill -CONT "$PID" 2>/dev/null || true
    rm -f "$PAUSED_FLAG"
    log "Resumed (PID $PID)"
else
    kill -STOP "$PID" 2>/dev/null || true
    : > "$PAUSED_FLAG"
    log "Paused (PID $PID)"
fi

exit 0
