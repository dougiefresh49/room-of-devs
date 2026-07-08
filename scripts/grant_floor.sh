#!/usr/bin/env bash
#
# grant_floor.sh — Grant the floor to a raised hand (one item) or drain a backlog.
#
# Usage:
#   grant_floor.sh              # next raised hand (oldest raisedAt)
#   grant_floor.sh next         # same as no arg
#   grant_floor.sh <sessionId>  # grant that session
#   grant_floor.sh drain <sessionId>  # play all queue files oldest-first
#
set -euo pipefail

TTS_DIR="$HOME/.cursor/tts"
STATE_DIR="$TTS_DIR/state"
QUEUE_DIR="$TTS_DIR/queue"
SCRIPTS_DIR="$TTS_DIR/scripts"
MUTED_PATH="$TTS_DIR/muted_sessions.json"
LOG_FILE="$TTS_DIR/logs/hook.log"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] grant_floor: $*" >> "$LOG_FILE" 2>/dev/null || true; }

MODE="single"
SESSION_ID=""

if [ "${1:-}" = "drain" ]; then
    MODE="drain"
    SESSION_ID="${2:-}"
    if [ -z "$SESSION_ID" ]; then
        echo "Usage: grant_floor.sh drain <sessionId>" >&2
        exit 1
    fi
elif [ -n "${1:-}" ] && [ "$1" != "next" ]; then
    SESSION_ID="$1"
fi

if [ "$MODE" = "single" ] && [ -z "$SESSION_ID" ]; then
    SESSION_ID="$(
        STATE_DIR="$STATE_DIR" MUTED_PATH="$MUTED_PATH" python3 - <<'PY'
import json
import os
from datetime import datetime

state_dir = os.environ["STATE_DIR"]
muted_path = os.environ.get("MUTED_PATH", "")

muted = set()
if muted_path and os.path.isfile(muted_path):
    try:
        with open(muted_path, encoding="utf-8") as fh:
            data = json.load(fh)
        if isinstance(data, list):
            muted = set(data)
    except (OSError, json.JSONDecodeError):
        pass

hands = []
if not os.path.isdir(state_dir):
    raise SystemExit(0)

for fname in os.listdir(state_dir):
    if not fname.endswith(".json"):
        continue
    path = os.path.join(state_dir, fname)
    try:
        with open(path, encoding="utf-8") as fh:
            s = json.load(fh)
    except (OSError, json.JSONDecodeError):
        continue
    if s.get("state") != "hand_raised":
        continue
    sid = s.get("sessionId") or fname[:-5]
    if sid in muted:
        continue
    raised = s.get("raisedAt") or ""
    try:
        key = datetime.fromisoformat(raised.replace("Z", "+00:00"))
    except ValueError:
        key = datetime.max
    hands.append((key, sid))

if not hands:
    raise SystemExit(0)

hands.sort(key=lambda x: x[0])
print(hands[0][1])
PY
    )"
fi

if [ -z "$SESSION_ID" ]; then
    log "No raised hands — nothing to grant"
    exit 0
fi

# Muted sessions never get the floor.
if [ -f "$MUTED_PATH" ]; then
    if SESSION_ID="$SESSION_ID" MUTED_PATH="$MUTED_PATH" python3 - <<'PY'
import json, os, sys
sid = os.environ["SESSION_ID"]
try:
    with open(os.environ["MUTED_PATH"], encoding="utf-8") as fh:
        muted = json.load(fh)
    if isinstance(muted, list) and sid in muted:
        sys.exit(0)
except (OSError, json.JSONDecodeError):
    pass
sys.exit(1)
PY
    then
        log "Session ${SESSION_ID:0:12} is muted — skipping grant"
        exit 0
    fi
fi

SHORT="${SESSION_ID:0:12}"
SUFFIX="-cc-${SHORT}.json"

# bash 3.2 (macOS default) has no mapfile — build the array with a read loop.
QUEUE_FILES=()
while IFS= read -r line; do
    [ -n "$line" ] && QUEUE_FILES+=("$line")
done < <(
    QUEUE_DIR="$QUEUE_DIR" SUFFIX="$SUFFIX" python3 - <<'PY'
import os
import sys

queue_dir = os.environ["QUEUE_DIR"]
suffix = os.environ["SUFFIX"]
if not os.path.isdir(queue_dir):
    raise SystemExit(0)

paths = []
for name in os.listdir(queue_dir):
    if name.endswith(suffix):
        paths.append(os.path.join(queue_dir, name))

for path in sorted(paths, key=lambda p: os.path.basename(p)):
    print(path)
PY
)

if [ "${#QUEUE_FILES[@]}" -eq 0 ]; then
    log "No queued items for ${SHORT} — nothing to play"
    exit 0
fi

if [ "$MODE" = "drain" ]; then
    log "Draining ${#QUEUE_FILES[@]} item(s) for ${SHORT}"
    last_idx=$(( ${#QUEUE_FILES[@]} - 1 ))
    idx=0
    for f in "${QUEUE_FILES[@]}"; do
        # Suppress the deferred "hands up" nudge between drain items — the floor
        # isn't free while grant items are still queued. Only the last item lets
        # index.ts fire it, once, after the backlog is fully drained.
        if [ "$idx" -lt "$last_idx" ]; then
            CR_SUPPRESS_DEFERRED=1 CR_GRANTED=1 "$SCRIPTS_DIR/play_node.sh" "$f"
        else
            CR_GRANTED=1 "$SCRIPTS_DIR/play_node.sh" "$f"
        fi
        idx=$(( idx + 1 ))
    done
    exit 0
fi

# Single grant: play the latest queued item (supersede keeps CC to one file).
TARGET="${QUEUE_FILES[${#QUEUE_FILES[@]}-1]}"
log "Granting floor to ${SHORT}: $(basename "$TARGET")"
exec env CR_GRANTED=1 "$SCRIPTS_DIR/play_node.sh" "$TARGET"
