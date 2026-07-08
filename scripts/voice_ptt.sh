#!/usr/bin/env bash
#
# voice_ptt.sh — Target-less PTT toggle for Raycast (start if idle, stop if recording).
#
set -euo pipefail

TTS_DIR="$HOME/.cursor/tts"
PTT_DIR="$TTS_DIR/ptt"
SCRIPTS_DIR="$TTS_DIR/scripts"

find_live_ptt_id() {
    local newest_id=""
    local newest_ts=0
    local pidfile id ts pid

    for pidfile in "$PTT_DIR"/*.pid; do
        [ -f "$pidfile" ] || continue
        id=$(basename "$pidfile" .pid)
        pid=$(cat "$pidfile" 2>/dev/null || true)
        if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then
            rm -f "$PTT_DIR/$id.pid" "$PTT_DIR/$id.wav" "$PTT_DIR/$id.target" "$PTT_DIR/$id.ducked"
            continue
        fi
        ts=${id%%-*}
        if [ "$ts" -gt "$newest_ts" ] 2>/dev/null; then
            newest_ts=$ts
            newest_id=$id
        fi
    done

    echo "$newest_id"
}

live_id=$(find_live_ptt_id)

if [ -n "$live_id" ]; then
    exec "$SCRIPTS_DIR/ptt.sh" stop
else
    exec "$SCRIPTS_DIR/ptt.sh" start
fi
