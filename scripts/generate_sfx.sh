#!/usr/bin/env bash
#
# generate_sfx.sh — Pre-generate notification sounds via ElevenLabs Sound Effects API.
# Generates a batch of short sounds from configured categories and caches them.
#
# Usage: generate_sfx.sh [--force]
#   --force: regenerate even if cache is populated
#
set -euo pipefail

TTS_DIR="$HOME/.cursor/tts"
CONFIG="$TTS_DIR/config.json"
SCRIPTS_DIR="$TTS_DIR/scripts"
SFX_DIR="$TTS_DIR/sounds/default"
LOG_FILE="$TTS_DIR/logs/hook.log"
TARGET_COUNT=10

source "$SCRIPTS_DIR/load_env.sh" 2>/dev/null || true

mkdir -p "$SFX_DIR" "$(dirname "$LOG_FILE")"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] generate_sfx: $*" >> "$LOG_FILE" 2>/dev/null || true; }

ELEVENLABS_API_KEY="${ELEVENLABS_API_KEY:-}"
if [ -z "$ELEVENLABS_API_KEY" ]; then
    log "No ELEVENLABS_API_KEY — cannot generate sound effects"
    exit 0
fi

FORCE=false
[ "${1:-}" = "--force" ] && FORCE=true

EXISTING=$(find "$SFX_DIR" -name '*.mp3' -maxdepth 1 2>/dev/null | wc -l | tr -d ' ')
if [ "$FORCE" = false ] && [ "$EXISTING" -ge "$TARGET_COUNT" ]; then
    log "Already have $EXISTING sounds cached — skipping"
    exit 0
fi

# With --force, move the old sounds aside so the directory doesn't grow forever
# (random_sfx.sh only picks from the top level, so old/ is excluded).
if [ "$FORCE" = true ] && [ "$EXISTING" -gt 0 ]; then
    OLD_DIR="$SFX_DIR/old"
    rm -rf "$OLD_DIR"
    mkdir -p "$OLD_DIR"
    mv "$SFX_DIR"/*.mp3 "$OLD_DIR"/ 2>/dev/null || true
    log "Moved $EXISTING old sounds to $OLD_DIR"
    EXISTING=0
fi

# Sound effect prompts by category
declare -a PROMPTS
PROMPTS=(
    "Short dramatic boom impact, cinematic trailer hit, 1 second"
    "Quick deep bass boom with reverb tail, movie impact, 1 second"
    "Epic orchestral bram hit, brass stab with tension, 1.5 seconds"
    "Dark cinematic braam, deep horn impact, Hans Zimmer style, 1.5 seconds"
    "Fantasy magic spell cast, sparkle whoosh, enchantment sound, 1 second"
    "Mystical chime notification, crystal bell fantasy alert, 1 second"
    "Heavy sword clash impact, metallic weapon hit, 1 second"
    "Sci-fi energy weapon discharge, laser blast notification, 1 second"
    "Thunderous explosion impact, dramatic rumble hit, 1.5 seconds"
    "Epic power-up sound, achievement unlock, gaming notification, 1 second"
    "Futuristic alert ping, sci-fi computer notification beep, 1 second"
    "Fantasy horn call, short herald trumpet fanfare, 1.5 seconds"
)

GENERATED=0
for i in "${!PROMPTS[@]}"; do
    TOTAL=$((EXISTING + GENERATED))
    if [ "$TOTAL" -ge "$TARGET_COUNT" ] && [ "$FORCE" = false ]; then
        break
    fi

    PROMPT="${PROMPTS[$i]}"
    FILENAME="sfx_$(date +%s)_${i}.mp3"
    OUTFILE="$SFX_DIR/$FILENAME"

    PAYLOAD=$(python3 -c "
import json, sys
print(json.dumps({
    'text': sys.argv[1],
    'duration_seconds': 1.5,
    'prompt_influence': 0.5
}))
" "$PROMPT")

    HTTP_CODE=$(curl -s -o "$OUTFILE" -w "%{http_code}" \
        -X POST "https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128" \
        -H "xi-api-key: ${ELEVENLABS_API_KEY}" \
        -H "Content-Type: application/json" \
        -d "$PAYLOAD" 2>/dev/null) || HTTP_CODE="000"

    if [ "$HTTP_CODE" = "200" ] && [ -f "$OUTFILE" ] && [ "$(wc -c < "$OUTFILE" | tr -d ' ')" -gt 100 ]; then
        log "Generated: $FILENAME ($PROMPT)"
        GENERATED=$((GENERATED + 1))
    else
        log "Failed to generate sound (HTTP $HTTP_CODE): $PROMPT"
        rm -f "$OUTFILE"
    fi

    # Small delay to avoid rate limiting
    sleep 0.5
done

log "Generated $GENERATED new sounds (total: $((EXISTING + GENERATED)))"
