#!/usr/bin/env bash
#
# stop.sh — Stop any active TTS playback.
#
set -euo pipefail

TTS_DIR="${TTS_DIR:-$HOME/.cursor/tts}"
PID_FILE="$TTS_DIR/.playback-pid"
STREAM_PID_FILE="$TTS_DIR/.stream-playback-pid"
PLAYBACK_FILE_REF="$TTS_DIR/.playback-file"
PAUSED_FLAG="$TTS_DIR/.playback-paused"
AUDIO_REF="$TTS_DIR/.playback-audio"
PENDING_INJECT="$TTS_DIR/ptt/pending-inject.json"
LOG_FILE="$TTS_DIR/logs/hook.log"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] stop: $*" >> "$LOG_FILE" 2>/dev/null; }

stopped=false

# Stop regular playback (afplay)
if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE" 2>/dev/null || true)
    if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
        # A paused (SIGSTOPped) player can't handle SIGTERM — resume it first
        # or the kill queues forever and the daemon wedges on "speaking".
        kill -CONT "$PID" 2>/dev/null || true
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
        kill -CONT "$SPID" 2>/dev/null || true
        kill "$SPID" 2>/dev/null || true
        log "Stopped stream playback (PID $SPID)"
        stopped=true
    fi
    rm -f "$STREAM_PID_FILE"
fi

# Stray-pkill below can't resume first, so belt-and-suspenders: CONT any
# suspended ffplay ours might be among before the TERM sweep.
pkill -CONT -f "ffplay.*cursor-tts-stream" 2>/dev/null || true

# Kill any stray ffplay processes from streaming
pkill -f "ffplay.*cursor-tts-stream" 2>/dev/null && stopped=true || true

if [ "$stopped" = false ]; then
    log "No active playback"
fi

# Note: .stream-lock is intentionally left alone — the owning process cleans it up.
rm -f "$PLAYBACK_FILE_REF" "$PAUSED_FLAG" "$AUDIO_REF"

# Any stop is also an abort: drop a pending (armed, not-yet-sent) injection so
# the undo window closes when the user reaches for stop. (Pause does NOT.)
rm -f "$PENDING_INJECT"
