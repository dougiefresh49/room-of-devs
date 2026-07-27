#!/usr/bin/env bash

# Required parameters:
# @raycast.schemaVersion 1
# @raycast.title Read Aloud: Push to Talk
# @raycast.mode compact

# Optional parameters:
# @raycast.icon 🎙️
# @raycast.packageName Cursor Read Aloud
# @raycast.description Toggle push-to-talk: record, transcribe, and route a voice command.

# Documentation:
# @raycast.needsConfirmation false
# @raycast.author dougiefresh49
# @raycast.authorURL https://github.com/dougiefresh49

set -euo pipefail

# Q-14: honor exported TTS_DIR.
TTS_DIR="${TTS_DIR:-$HOME/.cursor/tts}"
exec "${TTS_DIR}/scripts/voice_ptt.sh"
