#!/bin/bash

# Required parameters:
# @raycast.schemaVersion 1
# @raycast.title Read Aloud: Enqueue Clipboard
# @raycast.mode silent

# Optional parameters:
# @raycast.icon 📋
# @raycast.argument1 { "type": "text", "placeholder": "Thread title (optional)", "optional": true }

# Documentation:
# @raycast.description Queues the current clipboard text for Cursor Read Aloud (SwiftBar / ElevenLabs). Copy an assistant reply, then run this command.
# @raycast.packageName Cursor Read Aloud
# @raycast.needsConfirmation false
# @raycast.author dougiefresh49
# @raycast.authorURL https://github.com/dougiefresh49

set -euo pipefail

ENQUEUE="${HOME}/.cursor/tts/scripts/enqueue_manual.sh"
if [ ! -x "$ENQUEUE" ]; then
  echo "Missing or not executable: $ENQUEUE — run scripts/setup.sh first." >&2
  exit 1
fi

title="${1:-Manual enqueue}"

if ! pbpaste | "$ENQUEUE" "$title"; then
  echo "Nothing enqueued — is the clipboard empty?" >&2
  exit 1
fi

echo "Queued clipboard for read aloud."
