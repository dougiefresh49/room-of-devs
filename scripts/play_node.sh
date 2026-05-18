#!/usr/bin/env bash
#
# play_node.sh — Play a queue file via the Node.js TTS server.
# Falls back to play.sh if pnpm/tsx not available.
#
# Usage: play_node.sh <queue-file>
#
set -euo pipefail

TTS_DIR="$HOME/.cursor/tts"
SERVER_DIR="$TTS_DIR/tts-server"
SCRIPTS_DIR="$TTS_DIR/scripts"

QUEUE_FILE="${1:-}"
if [ -z "$QUEUE_FILE" ] || [ ! -f "$QUEUE_FILE" ]; then
    echo "Usage: play_node.sh <queue-file>" >&2
    exit 1
fi

if [ -f "$SERVER_DIR/src/index.ts" ] && command -v pnpm &>/dev/null; then
    cd "$SERVER_DIR"
    exec pnpm exec tsx src/index.ts once "$QUEUE_FILE"
fi

# Fallback to bash play script
exec bash "$SCRIPTS_DIR/play.sh" "$QUEUE_FILE"
