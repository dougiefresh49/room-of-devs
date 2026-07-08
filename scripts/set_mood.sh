#!/usr/bin/env bash
#
# set_mood.sh — Apply a bundled mood preset to config.json.
# Usage: set_mood.sh focus|arcade|quiet|normal
#
set -euo pipefail

TTS_DIR="$HOME/.cursor/tts"
CONFIG="$TTS_DIR/config.json"
SCRIPTS_DIR="$TTS_DIR/scripts"
LOG_FILE="$TTS_DIR/logs/hook.log"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] set_mood: $*" >> "$LOG_FILE" 2>/dev/null || true; }

MOOD="${1:-}"
case "$MOOD" in
    focus|arcade|quiet|normal)
        python3 -c "
import json

path = '$CONFIG'
mood = '$MOOD'

presets = {
    'focus': {
        'playback_mode': 'announce',
        'default_speed': 1.5,
        'notification_sound': 'none',
        'dynamic_responses': 'cached',
    },
    'arcade': {
        'playback_mode': 'auto',
        'default_speed': 1.5,
        'notification_sound': 'random_sfx',
        'dynamic_responses': 'always',
    },
    'quiet': {
        'playback_mode': 'silent',
        'default_speed': 1.25,
        'notification_sound': 'none',
        'dynamic_responses': 'off',
    },
    'normal': {
        'playback_mode': 'announce',
        'default_speed': 1.5,
        'notification_sound': 'random_sfx',
        'dynamic_responses': 'always',
    },
}

bundle = presets[mood]
with open(path, encoding='utf-8') as f:
    c = json.load(f)

c['playback_mode'] = bundle['playback_mode']
c['default_speed'] = bundle['default_speed']
c['notification_sound'] = bundle['notification_sound']
c['dynamic_responses'] = bundle['dynamic_responses']
c['streaming_enabled'] = (bundle['playback_mode'] == 'auto')

with open(path, 'w', encoding='utf-8') as f:
    json.dump(c, f, indent=2)
    f.write('\n')
"
        log "Mood set to $MOOD"
        "$SCRIPTS_DIR/tts-server.sh" start 2>/dev/null || true
        ;;
    *)
        echo "Usage: set_mood.sh focus|arcade|quiet|normal" >&2
        exit 1
        ;;
esac
