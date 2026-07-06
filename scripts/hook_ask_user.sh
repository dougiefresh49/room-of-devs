#!/usr/bin/env bash
#
# hook_ask_user.sh — Claude Code "PostToolUse" hook for AskUserQuestion.
# Reads the question aloud in-character so the user hears what's being asked.
#
set -euo pipefail

TTS_DIR="$HOME/.cursor/tts"
SERVER_DIR="$TTS_DIR/tts-server"
LOG_FILE="$TTS_DIR/logs/hook.log"

mkdir -p "$(dirname "$LOG_FILE")"

# Check listening flag
LISTENING_FLAG="$TTS_DIR/listening.enabled"
if [ -f "$LISTENING_FLAG" ]; then
    case "$(tr -d ' \n' < "$LISTENING_FLAG")" in
        0|false|FALSE|off) exit 0 ;;
    esac
fi

# Read hook payload from stdin (read all of it — payloads can be multi-line)
SESSION_ID=""
QUESTION_TEXT=""
PAYLOAD=$(cat 2>/dev/null || true)
if [ -n "$PAYLOAD" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] hook_ask_user payload: $PAYLOAD" >> "$LOG_FILE" 2>/dev/null || true
    SESSION_ID=$(echo "$PAYLOAD" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('session_id',''))" 2>/dev/null || true)
    # Extract questions and options into a readable summary
    QUESTION_TEXT=$(echo "$PAYLOAD" | python3 -c "
import json, sys
d = json.load(sys.stdin)
inp = d.get('tool_input', {})
if isinstance(inp, str):
    inp = json.loads(inp)
questions = inp.get('questions', [])
parts = []
for q in questions:
    text = q.get('question', '')
    opts = q.get('options', [])
    if text:
        parts.append(text)
    for i, o in enumerate(opts, 1):
        label = o.get('label', '')
        desc = o.get('description', '')
        if label:
            parts.append(f'Option {i}: {label}. {desc}' if desc else f'Option {i}: {label}')
print(' '.join(parts))
" 2>/dev/null || true)
fi

if [ -z "$QUESTION_TEXT" ]; then
    exit 0
fi

# Route through Node.js signal handler for in-character TTS
if [ -f "$SERVER_DIR/src/signal.ts" ] && command -v pnpm &>/dev/null; then
    cd "$SERVER_DIR"
    exec pnpm exec tsx src/signal.ts ask-user "$SESSION_ID" "$QUESTION_TEXT"
fi
