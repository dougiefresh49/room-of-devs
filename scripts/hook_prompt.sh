#!/usr/bin/env bash
#
# hook_prompt.sh — Claude Code "UserPromptSubmit" hook.
# Generates a dynamic in-character response based on the user's prompt.
#
set -euo pipefail

TTS_DIR="$HOME/.cursor/tts"
SERVER_DIR="$TTS_DIR/tts-server"

# Check listening flag
LISTENING_FLAG="$TTS_DIR/listening.enabled"
if [ -f "$LISTENING_FLAG" ]; then
    case "$(tr -d ' \n' < "$LISTENING_FLAG")" in
        0|false|FALSE|off) exit 0 ;;
    esac
fi

# Read session_id and prompt from hook payload (stdin is JSON from Claude Code).
# Read all of stdin — payloads can be multi-line.
SESSION_ID=""
USER_PROMPT=""
PAYLOAD=$(cat 2>/dev/null || true)
if [ -n "$PAYLOAD" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] hook_prompt payload: $PAYLOAD" >> "$TTS_DIR/logs/hook.log" 2>/dev/null || true
    SESSION_ID=$(echo "$PAYLOAD" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('session_id',''))" 2>/dev/null || true)
    USER_PROMPT=$(echo "$PAYLOAD" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('prompt', d.get('message', d.get('input', ''))))" 2>/dev/null || true)
fi

# Generate dynamic character response via Node.js
if [ -f "$SERVER_DIR/src/signal.ts" ] && command -v pnpm &>/dev/null; then
    cd "$SERVER_DIR"
    exec pnpm exec tsx src/signal.ts prompt-submitted "$SESSION_ID" "$USER_PROMPT"
fi
