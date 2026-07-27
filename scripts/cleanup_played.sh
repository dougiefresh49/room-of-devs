#!/usr/bin/env bash
#
# cleanup_played.sh — Prune old files from the played/ directory.
# Keeps the most recent N files (default: 50, configurable via played_retention_count).
#
# Usage: cleanup_played.sh
#
set -euo pipefail

TTS_DIR="$HOME/.cursor/tts"
CONFIG="$TTS_DIR/config.json"
PLAYED_DIR="$TTS_DIR/played"
LOG_FILE="$TTS_DIR/logs/hook.log"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] cleanup: $*" >> "$LOG_FILE" 2>/dev/null || true; }

if [ ! -d "$PLAYED_DIR" ]; then
    exit 0
fi

RETENTION=50
if [ -f "$CONFIG" ]; then
    RETENTION=$(python3 -c "
import json, sys
try:
    v = json.load(open(sys.argv[1])).get('played_retention_count', 50)
except Exception:
    v = 50
print(v)
" "$CONFIG" 2>/dev/null || echo "50")
fi

# M-8: refuse to mass-delete unless retention is a positive integer.
if ! [[ "$RETENTION" =~ ^[1-9][0-9]*$ ]]; then
    echo "cleanup_played: abort — played_retention_count must be a positive integer (got: ${RETENTION})" >&2
    log "ABORT — invalid played_retention_count: ${RETENTION}"
    exit 1
fi

TOTAL=$(find "$PLAYED_DIR" -name '*.json' -maxdepth 1 2>/dev/null | wc -l | tr -d ' ')

if [ "$TOTAL" -le "$RETENTION" ]; then
    exit 0
fi

TO_DELETE=$((TOTAL - RETENTION))

find "$PLAYED_DIR" -name '*.json' -maxdepth 1 -print0 2>/dev/null | \
    xargs -0 ls -1t | \
    tail -n "$TO_DELETE" | \
    while IFS= read -r f; do
        rm -f "$f"
    done

log "Cleaned $TO_DELETE old played files (kept $RETENTION)"
