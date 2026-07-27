#!/usr/bin/env bash
#
# random_sfx.sh — Pick a random sound effect from the cache.
# Outputs the path to a random sound file, or exits 1 if none available.
#
set -euo pipefail

# Q-14: honor exported TTS_DIR (shared resolver).
# shellcheck disable=SC1091
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tts-dir.sh"
SFX_DIR="$TTS_DIR/sounds/default"

if [ ! -d "$SFX_DIR" ]; then
    exit 1
fi

SOUNDS=()
while IFS= read -r -d '' f; do
    SOUNDS+=("$f")
done < <(find "$SFX_DIR" -name '*.mp3' -maxdepth 1 -print0 2>/dev/null)

if [ "${#SOUNDS[@]}" -eq 0 ]; then
    exit 1
fi

INDEX=$((RANDOM % ${#SOUNDS[@]}))
echo "${SOUNDS[$INDEX]}"
