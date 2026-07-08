#!/usr/bin/env bash

# Required parameters:
# @raycast.schemaVersion 1
# @raycast.title Read Aloud: Go Ahead (next hand)
# @raycast.mode compact

# Optional parameters:
# @raycast.icon ✋
# @raycast.packageName Cursor Read Aloud
# @raycast.description Grants the floor to the next raised hand (oldest wait).

# Documentation:
# @raycast.needsConfirmation false
# @raycast.author dougiefresh49
# @raycast.authorURL https://github.com/dougiefresh49

set -euo pipefail

exec "${HOME}/.cursor/tts/scripts/grant_floor.sh"
