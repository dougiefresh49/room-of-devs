#!/usr/bin/env bash
#
# nickname.sh — Set or clear a per-session display nickname.
# Usage: nickname.sh <sessionId> <label|--clear>
#
set -euo pipefail

TTS_DIR="$HOME/.cursor/tts"
NICKNAMES_FILE="$TTS_DIR/nicknames.json"
LOG_FILE="$TTS_DIR/logs/hook.log"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] nickname: $*" >> "$LOG_FILE" 2>/dev/null || true; }

SESSION_ID="${1:-}"
LABEL="${2:-}"

if [ -z "$SESSION_ID" ] || [ -z "$LABEL" ]; then
    echo "Usage: nickname.sh <sessionId> <label|--clear>" >&2
    exit 1
fi

mkdir -p "$TTS_DIR" "$(dirname "$LOG_FILE")"

python3 -c "
import json, os, sys, tempfile

path = sys.argv[1]
sid = sys.argv[2]
label = sys.argv[3]

data = {}
if os.path.isfile(path):
    try:
        with open(path, encoding='utf-8') as f:
            raw = json.load(f)
        if isinstance(raw, dict):
            data = raw
    except (OSError, json.JSONDecodeError):
        data = {}

if label == '--clear':
    data.pop(sid, None)
    log_msg = f'cleared nickname for {sid}'
else:
    data[sid] = label
    log_msg = f'set nickname for {sid}: {label}'

parent = os.path.dirname(path) or '.'
fd, tmp = tempfile.mkstemp(dir=parent, suffix='.tmp')
try:
    with os.fdopen(fd, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2)
        f.write('\n')
    os.replace(tmp, path)
except Exception:
    try:
        os.unlink(tmp)
    except OSError:
        pass
    raise

print(log_msg)
" "$NICKNAMES_FILE" "$SESSION_ID" "$LABEL" | while read -r msg; do log "$msg"; done
