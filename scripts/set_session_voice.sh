#!/usr/bin/env bash
#
# set_session_voice.sh — Assign a voice to a specific Claude Code session.
# Usage: set_session_voice.sh <session_id> <voice_id>
#        set_session_voice.sh <session_id> --clear   (remove override)
#
set -euo pipefail

TTS_DIR="$HOME/.cursor/tts"
SESSION_VOICES="$TTS_DIR/session_voices.json"
LOG_FILE="$TTS_DIR/logs/hook.log"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] set_session_voice: $*" >> "$LOG_FILE" 2>/dev/null || true; }

SESSION_ID="${1:-}"
VOICE_ID="${2:-}"

if [ -z "$SESSION_ID" ] || [ -z "$VOICE_ID" ]; then
    echo "Usage: set_session_voice.sh <session_id> <voice_id|--clear>" >&2
    exit 1
fi

python3 -c "
import json, sys, os

path = sys.argv[1]
sid = sys.argv[2]
vid = sys.argv[3]

data = {}
if os.path.isfile(path):
    try:
        with open(path) as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        pass

if vid == '--clear':
    data.pop(sid, None)
else:
    data[sid] = vid

with open(path, 'w') as f:
    json.dump(data, f, indent=2)
" "$SESSION_VOICES" "$SESSION_ID" "$VOICE_ID"

if [ "$VOICE_ID" = "--clear" ]; then
    log "Cleared voice override for session $SESSION_ID"
else
    log "Set voice for session $SESSION_ID → $VOICE_ID"
    # Pre-generate phrases for this voice in the background (if not already cached)
    SERVER_DIR="$TTS_DIR/tts-server"
    if [ -f "$SERVER_DIR/src/phrases.ts" ] && command -v pnpm &>/dev/null; then
        (cd "$SERVER_DIR" && pnpm exec tsx src/phrases.ts "$VOICE_ID") &>/dev/null &
    fi
fi
