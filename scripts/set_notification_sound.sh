#!/usr/bin/env bash
#
# set_notification_sound.sh — Update notification_sound in config.json for terminal-notifier / AppleScript.
#
# Usage: set_notification_sound.sh <name>
#   e.g.: set_notification_sound.sh Glass
#   Use "default" for terminal-notifier’s default chime.
#   Use "none" for silent notifications (banner only, no alert sound).
#
set -euo pipefail

# Q-14: honor exported TTS_DIR (shared resolver).
# shellcheck disable=SC1091
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tts-dir.sh"
CONFIG="$TTS_DIR/config.json"

SOUND="${1:-default}"
# SwiftBar-safe transport for names with spaces / specials (see plugin custom sound menu).
if [[ "$SOUND" == B64:* ]]; then
    SOUND=$(python3 -c "
import base64
import sys
raw = sys.argv[1]
pad = '=' * ((4 - len(raw) % 4) % 4)
print(base64.urlsafe_b64decode(raw + pad).decode('utf-8'))
" "${SOUND#B64:}")
fi

if [ ! -f "$CONFIG" ]; then
    echo '{}' > "$CONFIG"
fi

python3 -c "
import json
import sys

sound = (sys.argv[1] or 'default').strip() or 'default'
path = sys.argv[2]
with open(path, encoding='utf-8') as f:
    config = json.load(f)
config['notification_sound'] = sound
with open(path, 'w', encoding='utf-8') as f:
    json.dump(config, f, indent=2)
    f.write('\n')
" "$SOUND" "$CONFIG"
