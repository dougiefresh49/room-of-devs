#!/usr/bin/env bash
#
# replay.sh — Replay the last TTS audio message (or Nth from last).
# Usage: replay.sh [N]  (default: 1 = most recent)
#
set -euo pipefail

TTS_DIR="$HOME/.cursor/tts"
SERVER_DIR="$TTS_DIR/tts-server"
LOG_FILE="$TTS_DIR/logs/hook.log"
NTH="${1:-1}"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] replay: $*" >> "$LOG_FILE" 2>/dev/null || true; }

mkdir -p "$(dirname "$LOG_FILE")"

log "Replaying message (nth=$NTH)"
cd "$SERVER_DIR"
exec npx tsx src/signal.ts replay "" "$NTH"
