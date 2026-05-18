#!/usr/bin/env bash
#
# set_session_mute.sh — Mute or unmute streaming for a specific session.
# Muted sessions skip auto Gemini/ElevenLabs generation but files stay
# in queue for manual playback via menu click.
#
# Usage: set_session_mute.sh <session_id> mute|unmute
#
set -euo pipefail

TTS_DIR="$HOME/.cursor/tts"
MUTED_FILE="$TTS_DIR/muted_sessions.json"
LOG_FILE="$TTS_DIR/logs/hook.log"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] set_session_mute: $*" >> "$LOG_FILE" 2>/dev/null || true; }

SESSION_ID="${1:-}"
ACTION="${2:-}"

if [ -z "$SESSION_ID" ] || [ -z "$ACTION" ]; then
    echo "Usage: set_session_mute.sh <session_id> mute|unmute" >&2
    exit 1
fi

python3 -c "
import json, sys, os

path = sys.argv[1]
sid = sys.argv[2]
action = sys.argv[3]

data = []
if os.path.isfile(path):
    try:
        with open(path) as f:
            data = json.load(f)
        if not isinstance(data, list):
            data = []
    except (OSError, json.JSONDecodeError):
        data = []

if action == 'mute' and sid not in data:
    data.append(sid)
elif action == 'unmute' and sid in data:
    data.remove(sid)

with open(path, 'w') as f:
    json.dump(data, f, indent=2)
" "$MUTED_FILE" "$SESSION_ID" "$ACTION"

log "Session $SESSION_ID ${ACTION}d"
