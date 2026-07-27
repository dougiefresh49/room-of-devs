#!/usr/bin/env bash
#
# set_speed.sh — Update the default playback speed in config.json.
#
# Usage: set_speed.sh <speed>
#   e.g.: set_speed.sh 1.5
#
set -euo pipefail

# Q-14: honor exported TTS_DIR (shared resolver).
# shellcheck disable=SC1091
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tts-dir.sh"
CONFIG="$TTS_DIR/config.json"

SPEED="${1:-1.0}"

if [ ! -f "$CONFIG" ]; then
    echo '{}' > "$CONFIG"
fi

python3 -c "
import json, sys
speed = float(sys.argv[1])
with open(sys.argv[2]) as f:
    config = json.load(f)
config['default_speed'] = speed
with open(sys.argv[2], 'w') as f:
    json.dump(config, f, indent=2)
    f.write('\n')
" "$SPEED" "$CONFIG"
