#!/usr/bin/env bash
#
# stop.sh — Stop any active TTS playback.
#
set -euo pipefail

TTS_DIR="$HOME/.cursor/tts"
PID_FILE="$TTS_DIR/.playback-pid"
STREAM_PID_FILE="$TTS_DIR/.stream-playback-pid"
PLAYBACK_FILE_REF="$TTS_DIR/.playback-file"
PAUSED_FLAG="$TTS_DIR/.playback-paused"
AUDIO_REF="$TTS_DIR/.playback-audio"
STREAM_LOCK="$TTS_DIR/.stream-lock"
LOG_FILE="$TTS_DIR/logs/hook.log"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] stop: $*" >> "$LOG_FILE" 2>/dev/null; }

stopped=false

# Stop regular playback (afplay)
if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE" 2>/dev/null || true)
    if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
        kill "$PID" 2>/dev/null || true
        log "Stopped playback (PID $PID)"
        stopped=true
    fi
    rm -f "$PID_FILE"
fi

# Stop streaming playback (ffplay)
if [ -f "$STREAM_PID_FILE" ]; then
    SPID=$(cat "$STREAM_PID_FILE" 2>/dev/null || true)
    if [ -n "$SPID" ] && kill -0 "$SPID" 2>/dev/null; then
        kill "$SPID" 2>/dev/null || true
        log "Stopped stream playback (PID $SPID)"
        stopped=true
    fi
    rm -f "$STREAM_PID_FILE"
fi

# Kill any stray ffplay processes from streaming
pkill -f "ffplay.*cursor-tts-stream" 2>/dev/null && stopped=true || true

if [ "$stopped" = false ]; then
    log "No active playback"
fi

rm -f "$PLAYBACK_FILE_REF" "$PAUSED_FLAG" "$AUDIO_REF" "$STREAM_LOCK"
