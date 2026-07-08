#!/usr/bin/env bash

# Required parameters:
# @raycast.schemaVersion 1
# @raycast.title Read Aloud: Open Room Panel
# @raycast.mode compact

# Optional parameters:
# @raycast.icon 🐢
# @raycast.packageName Cursor Read Aloud
# @raycast.description Opens the Room agent panel (Tauri).

# Documentation:
# @raycast.needsConfirmation false
# @raycast.author dougiefresh49
# @raycast.authorURL https://github.com/dougiefresh49

set -euo pipefail

exec "${HOME}/.cursor/tts/scripts/panel.sh"
