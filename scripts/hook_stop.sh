#!/usr/bin/env bash
#
# hook_stop.sh — Claude Code "Stop" hook entry point.
# Uses Node.js ingest if tts-server is installed, falls back to bash.
#
set -euo pipefail

TTS_DIR="$HOME/.cursor/tts"
SERVER_DIR="$TTS_DIR/tts-server"
SCRIPTS_DIR="$TTS_DIR/scripts"
LOG_FILE="$TTS_DIR/logs/hook.log"

mkdir -p "$(dirname "$LOG_FILE")"

# Check listening flag
LISTENING_FLAG="$TTS_DIR/listening.enabled"
if [ -f "$LISTENING_FLAG" ]; then
    case "$(tr -d ' \n' < "$LISTENING_FLAG")" in
        0|false|FALSE|off) exit 0 ;;
    esac
fi

# Prefer Node.js ingest (faster, no python subprocess overhead)
if [ -f "$SERVER_DIR/src/ingest.ts" ] && command -v pnpm &>/dev/null; then
    cd "$SERVER_DIR"
    exec pnpm exec tsx src/ingest.ts
fi

# Fallback to bash script
exec bash "$SCRIPTS_DIR/ingest_claude_code.sh"
