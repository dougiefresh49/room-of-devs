#!/usr/bin/env bash
#
# hook_prompt.sh — Claude Code "UserPromptSubmit" hook.
# Generates a dynamic in-character response based on the user's prompt.
#
set -euo pipefail

# Q-14: honor exported TTS_DIR (shared resolver).
# shellcheck disable=SC1091
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tts-dir.sh"
SERVER_DIR="$TTS_DIR/tts-server"
LOG_FILE="$TTS_DIR/logs/hook.log"
HOOK_LOG_MAX_BYTES=$((5 * 1024 * 1024))

mkdir -p "$(dirname "$LOG_FILE")"

# Rotate hook.log when oversized (H-6).
if [ -f "$LOG_FILE" ]; then
    _sz=$(wc -c < "$LOG_FILE" | tr -d ' ')
    if [ "${_sz:-0}" -gt "$HOOK_LOG_MAX_BYTES" ]; then
        mv -f "$LOG_FILE" "${LOG_FILE}.1" 2>/dev/null || true
    fi
fi
unset _sz

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
    # Verbatim payload logging is debug-only (H-6) — prompts often contain secrets.
    if [ "${TTS_HOOK_DEBUG:-0}" = "1" ]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] hook_prompt payload: $PAYLOAD" >> "$LOG_FILE" 2>/dev/null || true
    fi
    SESSION_ID=$(echo "$PAYLOAD" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('session_id',''))" 2>/dev/null || true)
    USER_PROMPT=$(echo "$PAYLOAD" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('prompt', d.get('message', d.get('input', ''))))" 2>/dev/null || true)
fi

# Synthetic background/subagent <task-notification> prompts aren't real user
# prompts — skip before launching Node (signal.ts keeps the same guard).
TRIMMED="${USER_PROMPT#"${USER_PROMPT%%[![:space:]]*}"}"
if [[ "$TRIMMED" == \<task-notification* ]]; then
    exit 0
fi

# Generate dynamic character response via Node.js.
# H-5: prompt text travels via temp file, not argv (ps-visible).
if [ -f "$SERVER_DIR/src/signal.ts" ] && command -v pnpm &>/dev/null; then
    cd "$SERVER_DIR"
    TEXT_FILE=$(mktemp "${TMPDIR:-/tmp}/hook-prompt-text.XXXXXX")
    printf '%s' "$USER_PROMPT" > "$TEXT_FILE"
    exec pnpm exec tsx src/signal.ts prompt-submitted "$SESSION_ID" --text-file "$TEXT_FILE"
fi
