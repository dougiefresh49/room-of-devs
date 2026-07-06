#!/usr/bin/env bash
#
# play_node.sh — Play a queue file via the Node.js TTS server.
#
# Usage: play_node.sh <queue-file>
#
set -euo pipefail

TTS_DIR="$HOME/.cursor/tts"
SERVER_DIR="$TTS_DIR/tts-server"
LOG_FILE="$TTS_DIR/logs/hook.log"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] play_node: $*" >> "$LOG_FILE" 2>/dev/null || true; }

QUEUE_FILE="${1:-}"
if [ -z "$QUEUE_FILE" ] || [ ! -f "$QUEUE_FILE" ]; then
    echo "Usage: play_node.sh <queue-file>" >&2
    exit 1
fi

if [ -f "$SERVER_DIR/src/index.ts" ] && command -v pnpm &>/dev/null; then
    cd "$SERVER_DIR"
    exec pnpm exec tsx src/index.ts once "$QUEUE_FILE"
fi

log "ERROR: pnpm or tts-server not found — cannot play $QUEUE_FILE (run setup.sh, install pnpm)"
echo "Error: pnpm or tts-server not found — run setup.sh and install pnpm" >&2
exit 1
