#!/usr/bin/env bash

# Required parameters:
# @raycast.schemaVersion 1
# @raycast.title Read Aloud: Start (setup + listening)
# @raycast.mode compact

# Optional parameters:
# @raycast.icon 🐢
# @raycast.packageName Cursor Read Aloud
# @raycast.description Runs setup.sh, turns listening on (ElevenLabs + hooks path), and opens SwiftBar.

# Documentation:
# @raycast.needsConfirmation false
# @raycast.author dougiefresh49
# @raycast.authorURL https://github.com/dougiefresh49

set -euo pipefail

THIS="${BASH_SOURCE[0]:-$0}"
if command -v realpath >/dev/null 2>&1; then
  SCRIPT_DIR="$(cd "$(dirname "$(realpath "$THIS")")" && pwd)"
else
  SCRIPT_DIR="$(cd "$(dirname "$THIS")" && pwd)"
fi
PROJECT_DIR="${CURSOR_READ_ALOUD_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
SETUP_SH="$PROJECT_DIR/scripts/setup.sh"
SET_LISTENING="${HOME}/.cursor/tts/scripts/set_listening.sh"

if [ ! -f "$SETUP_SH" ]; then
  echo "Missing setup script: $SETUP_SH (set CURSOR_READ_ALOUD_ROOT to your clone if you symlinked this script)"
  exit 1
fi

echo "Running setup…"
bash "$SETUP_SH"

if [ -x "$SET_LISTENING" ]; then
  "$SET_LISTENING" on
else
  echo "Warning: $SET_LISTENING missing after setup."
fi

# Start the TTS server daemon if streaming is enabled
TTS_SERVER_SH="${HOME}/.cursor/tts/scripts/tts-server.sh"
STREAMING_ON=$(python3 -c "import json; print(1 if json.load(open('${HOME}/.cursor/tts/config.json')).get('streaming_enabled') else 0)" 2>/dev/null || echo "0")
if [ "$STREAMING_ON" = "1" ] && [ -x "$TTS_SERVER_SH" ]; then
  "$TTS_SERVER_SH" start
fi

if open -a SwiftBar 2>/dev/null; then
  echo "SwiftBar opened."
else
  echo "SwiftBar not found — install with: brew install --cask swiftbar"
  exit 1
fi

echo "Cursor Read Aloud is on."
