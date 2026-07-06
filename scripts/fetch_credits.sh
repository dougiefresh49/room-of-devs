#!/usr/bin/env bash
#
# fetch_credits.sh — Fetch and cache ElevenLabs subscription/credits info.
# Outputs JSON with character_count, character_limit, tier, etc.
# Cache: ~/.cursor/tts/cache/credits.json (refreshes every 5 minutes)
#
set -euo pipefail

TTS_DIR="$HOME/.cursor/tts"
SCRIPTS_DIR="$TTS_DIR/scripts"
CACHE_DIR="$TTS_DIR/cache"
CACHE_FILE="$CACHE_DIR/credits.json"
LOG_FILE="$TTS_DIR/logs/hook.log"
CACHE_TTL=300

source "$SCRIPTS_DIR/load_env.sh" 2>/dev/null || true

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] fetch_credits: $*" >> "$LOG_FILE" 2>/dev/null || true; }

mkdir -p "$CACHE_DIR"

FORCE=false
[ "${1:-}" = "--refresh" ] && FORCE=true

if [ "$FORCE" = false ] && [ -f "$CACHE_FILE" ]; then
    AGE=$(( $(date +%s) - $(stat -f %m "$CACHE_FILE" 2>/dev/null || echo 0) ))
    if [ "$AGE" -lt "$CACHE_TTL" ]; then
        cat "$CACHE_FILE"
        exit 0
    fi
fi

ELEVENLABS_API_KEY="${ELEVENLABS_API_KEY:-}"
if [ -z "$ELEVENLABS_API_KEY" ]; then
    echo '{"error":"no_api_key"}'
    exit 0
fi

RESPONSE=$(curl -s -f --max-time 5 \
    -H "xi-api-key: ${ELEVENLABS_API_KEY}" \
    "https://api.elevenlabs.io/v1/user/subscription" 2>/dev/null) || {
    log "API call failed"
    [ -f "$CACHE_FILE" ] && cat "$CACHE_FILE" || echo '{"error":"api_failed"}'
    exit 0
}

python3 -c "
import json, sys
data = json.loads(sys.argv[1])
result = {
    'character_count': data.get('character_count', 0),
    'character_limit': data.get('character_limit', 0),
    'tier': data.get('tier', 'unknown'),
    'next_reset': data.get('next_character_count_reset_unix', 0),
}
print(json.dumps(result, indent=2))
with open(sys.argv[2], 'w') as f:
    json.dump(result, f, indent=2)
" "$RESPONSE" "$CACHE_FILE" 2>/dev/null || {
    log "Failed to parse subscription response"
    echo '{"error":"parse_failed"}'
}
