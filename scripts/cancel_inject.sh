#!/usr/bin/env bash
#
# cancel_inject.sh — Abort an armed-but-not-yet-sent prompt injection.
#
# Injections written by inject_prompt.sh sit in a 4-second undo window as
# pending-inject.json. Removing that file makes the pending commit subshell
# no-op (its armedAt no longer matches). If nothing is pending, stay silent.
#
set -euo pipefail

TTS_DIR="${TTS_DIR:-$HOME/.cursor/tts}"
PENDING="$TTS_DIR/ptt/pending-inject.json"

if [ -f "$PENDING" ]; then
    rm -f "$PENDING"
    say "cancelled" 2>/dev/null || true
fi

exit 0
