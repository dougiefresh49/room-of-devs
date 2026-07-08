#!/usr/bin/env bash
#
# set_streaming.sh — Legacy shim for playback mode (on → auto, off → silent).
# Usage: set_streaming.sh on|off
#
set -euo pipefail

TTS_DIR="$HOME/.cursor/tts"
SCRIPTS_DIR="$TTS_DIR/scripts"

ACTION="${1:-}"
case "$ACTION" in
    on|true|1)
        exec "$SCRIPTS_DIR/set_playback_mode.sh" auto
        ;;
    off|false|0)
        exec "$SCRIPTS_DIR/set_playback_mode.sh" silent
        ;;
    *)
        echo "Usage: set_streaming.sh on|off" >&2
        exit 1
        ;;
esac
