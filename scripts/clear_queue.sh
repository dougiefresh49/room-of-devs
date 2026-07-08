#!/usr/bin/env bash
#
# clear_queue.sh — Move all queued responses to played/.
#
set -euo pipefail

TTS_DIR="$HOME/.cursor/tts"
QUEUE_DIR="$TTS_DIR/queue"
PLAYED_DIR="$TTS_DIR/played"
STATE_DIR="$TTS_DIR/state"
SERVER_DIR="$TTS_DIR/tts-server"
PENDING_FILE="$TTS_DIR/.pending-announce"

mkdir -p "$PLAYED_DIR"

COUNT=0
for f in "$QUEUE_DIR"/*.json; do
    [ -f "$f" ] || continue
    mv "$f" "$PLAYED_DIR/"
    COUNT=$((COUNT + 1))
done

# A full clear leaves no hands raised: drop every deferred announce and
# recompute each tracked session so stale hand_raised badges don't linger.
rm -f "$PENDING_FILE"
if [ -d "$STATE_DIR" ] && [ -f "$SERVER_DIR/src/state.ts" ] && command -v pnpm >/dev/null 2>&1; then
    for sf in "$STATE_DIR"/*.json; do
        [ -f "$sf" ] || continue
        sid="$(basename "$sf" .json)"
        (cd "$SERVER_DIR" && pnpm exec tsx src/state.ts recompute "$sid") >/dev/null 2>&1 || true
    done
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] clear_queue: Moved $COUNT files" >> "$TTS_DIR/logs/hook.log" 2>/dev/null
