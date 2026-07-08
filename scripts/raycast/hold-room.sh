#!/usr/bin/env bash

# Required parameters:
# @raycast.schemaVersion 1
# @raycast.title Read Aloud: Hold / Release Room
# @raycast.mode compact

# Optional parameters:
# @raycast.icon 🔇
# @raycast.packageName Cursor Read Aloud
# @raycast.description Toggles room hold (panic-quiet) on or off.

# Documentation:
# @raycast.needsConfirmation false
# @raycast.author dougiefresh49
# @raycast.authorURL https://github.com/dougiefresh49

set -euo pipefail

TTS_DIR="${HOME}/.cursor/tts"
HOLD_FILE="$TTS_DIR/.hold-room.json"
SCRIPTS_DIR="$TTS_DIR/scripts"

if [ -f "$HOLD_FILE" ]; then
  exec "$SCRIPTS_DIR/hold_room.sh" off
else
  exec "$SCRIPTS_DIR/hold_room.sh"
fi
