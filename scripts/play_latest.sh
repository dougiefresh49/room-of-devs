#!/usr/bin/env bash
#
# play_latest.sh — Play the newest queued message (same sort as SwiftBar menu).
#
set -euo pipefail

TTS_DIR="$HOME/.cursor/tts"
SCRIPTS_DIR="$TTS_DIR/scripts"
QUEUE_DIR="$TTS_DIR/queue"
LOG_FILE="$TTS_DIR/logs/hook.log"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] play_latest: $*" >> "$LOG_FILE" 2>/dev/null || true; }

mkdir -p "$(dirname "$LOG_FILE")"

LATEST="$(QUEUE_DIR="$QUEUE_DIR" python3 - <<'PY'
import glob
import os
import sys

q = os.environ.get("QUEUE_DIR", "")
if not q or not os.path.isdir(q):
    sys.exit(0)
paths = glob.glob(os.path.join(q, "*.json"))
if not paths:
    sys.exit(0)
paths.sort(key=lambda p: os.path.basename(p), reverse=True)
print(paths[0])
PY
)"

if [ -z "$LATEST" ] || [ ! -f "$LATEST" ]; then
    log "No queued messages"
    exit 0
fi

log "Playing latest: $(basename "$LATEST")"
exec "$SCRIPTS_DIR/play_node.sh" "$LATEST"
