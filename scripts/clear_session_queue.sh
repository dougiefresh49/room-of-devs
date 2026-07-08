#!/usr/bin/env bash
#
# clear_session_queue.sh — Move a session's CC queue files to played/,
# remove its .pending-announce lines, and recompute session state.
#
# Usage: clear_session_queue.sh <sessionId>
#
set -euo pipefail

TTS_DIR="$HOME/.cursor/tts"
QUEUE_DIR="$TTS_DIR/queue"
PLAYED_DIR="$TTS_DIR/played"
PENDING_FILE="$TTS_DIR/.pending-announce"
SERVER_DIR="$TTS_DIR/tts-server"
LOG_FILE="$TTS_DIR/logs/hook.log"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] clear_session_queue: $*" >> "$LOG_FILE" 2>/dev/null || true; }

SESSION_ID="${1:-}"
if [ -z "$SESSION_ID" ]; then
    echo "Usage: clear_session_queue.sh <sessionId>" >&2
    exit 1
fi

SHORT="${SESSION_ID:0:12}"
SUFFIX="-cc-${SHORT}.json"
COUNT=0

mkdir -p "$PLAYED_DIR"
if [ -d "$QUEUE_DIR" ]; then
    for f in "$QUEUE_DIR"/*"$SUFFIX"; do
        [ -f "$f" ] || continue
        mv "$f" "$PLAYED_DIR/"
        COUNT=$((COUNT + 1))
    done
fi

if [ -f "$PENDING_FILE" ]; then
    PENDING_FILE="$PENDING_FILE" SESSION_ID="$SESSION_ID" python3 - <<'PY'
import os

path = os.environ["PENDING_FILE"]
sid = os.environ["SESSION_ID"]
try:
    with open(path, encoding="utf-8") as fh:
        lines = [ln.strip() for ln in fh if ln.strip()]
except OSError:
    raise SystemExit(0)

kept = [ln for ln in lines if ln != sid]
if kept == lines:
    raise SystemExit(0)

if kept:
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(kept) + "\n")
else:
    os.unlink(path)
PY
fi

if [ -f "$SERVER_DIR/src/state.ts" ] && command -v pnpm &>/dev/null; then
    (cd "$SERVER_DIR" && pnpm exec tsx src/state.ts recompute "$SESSION_ID") || true
fi

log "Cleared $COUNT queued item(s) for ${SHORT}"
echo "Cleared $COUNT queued item(s) for session ${SHORT}"
