#!/usr/bin/env bash

# Required parameters:
# @raycast.schemaVersion 1
# @raycast.title Read Aloud: Open Room Panel
# @raycast.mode compact

# Optional parameters:
# @raycast.icon 🐢
# @raycast.packageName Cursor Read Aloud
# @raycast.description Start the tts-server daemon (if needed) and open the Room panel (Room.app).

# Documentation:
# @raycast.needsConfirmation false
# @raycast.author dougiefresh49
# @raycast.authorURL https://github.com/dougiefresh49

set -euo pipefail

# Honor exported TTS_DIR, same as push-to-talk.sh.
TTS_DIR="${TTS_DIR:-$HOME/.cursor/tts}"
PANEL="${TTS_DIR}/scripts/panel.sh"

if [ ! -x "$PANEL" ]; then
    echo "panel.sh not installed at $PANEL — run scripts/setup.sh first"
    exit 1
fi

# panel.sh starts the daemon idempotently, then `open`s the installed Room.app
# (activates the existing window if it's already running).
"$PANEL"
echo "Room panel opened"
