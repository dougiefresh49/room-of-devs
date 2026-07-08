#!/usr/bin/env bash

# Required parameters:
# @raycast.schemaVersion 1
# @raycast.title Read Aloud: Mood — Normal
# @raycast.mode compact

# Optional parameters:
# @raycast.icon 🎮
# @raycast.packageName Cursor Read Aloud
# @raycast.description Applies the normal mood preset (announce, SFX, dynamic responses).

# Documentation:
# @raycast.needsConfirmation false
# @raycast.author dougiefresh49
# @raycast.authorURL https://github.com/dougiefresh49

set -euo pipefail

exec "${HOME}/.cursor/tts/scripts/set_mood.sh" normal
