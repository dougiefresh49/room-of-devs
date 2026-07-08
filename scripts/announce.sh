#!/usr/bin/env bash
#
# announce.sh <queue-file-path> — announce-mode chime for a newly queued CC item.
#
# Called by notify_queued.sh (independent of the notifications gate). In
# announce mode only: plays the session voice's cached announce phrase when the
# floor is free, or records a deferral when it's busy. Any other mode → exit 0.
#
# Floor free  → play a cached announce_N.mp3 as meta audio (falls back to a
#               legacy random SFX when the voice has no announce phrases).
# Floor busy  → append the sessionId to ~/.cursor/tts/.pending-announce (dedup);
#               index.ts speaks the deferred hands by name once the floor frees.
#
set -u

filepath="${1:-}"
if [ -z "$filepath" ] || [ ! -f "$filepath" ]; then
  exit 0
fi

TTS_DIR="${HOME}/.cursor/tts"
CONFIG="${TTS_DIR}/config.json"
SESSION_VOICES="${TTS_DIR}/session_voices.json"
MUTED="${TTS_DIR}/muted_sessions.json"
LOCK="${TTS_DIR}/.stream-lock"
PENDING="${TTS_DIR}/.pending-announce"
PHRASES_DIR="${TTS_DIR}/sounds/phrases"
SCRIPTS_DIR="${TTS_DIR}/scripts"
SERVER_DIR="${TTS_DIR}/tts-server"
LOG_FILE="${TTS_DIR}/logs/hook.log"

loga() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] announce: $*" >>"$LOG_FILE" 2>/dev/null || true; }

# Resolve sessionId, effective mode, voice, and mute in one python pass.
read -r SESSION_ID MODE VOICE MUTED_FLAG < <(
  FILEPATH="$filepath" CONFIG="$CONFIG" SESSION_VOICES="$SESSION_VOICES" MUTED="$MUTED" python3 - <<'PY'
import json, os

def load(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}

item = load(os.environ["FILEPATH"])
cfg = load(os.environ["CONFIG"])
voices = load(os.environ["SESSION_VOICES"])
muted = load(os.environ["MUTED"])

sid = (item.get("conversation_id") or "").strip()

# Mirror config.ts effectivePlaybackMode(): explicit key wins, else legacy map.
if "playback_mode" in cfg:
    mode = cfg.get("playback_mode") or "auto"
else:
    mode = "auto" if cfg.get("streaming_enabled") else "silent"

voice = voices.get(sid) or cfg.get("elevenlabs_voice_id") or ""
is_muted = "1" if (isinstance(muted, list) and sid in muted) else "0"

print(sid or "-", mode, voice or "-", is_muted)
PY
)

[ "$SESSION_ID" = "-" ] && exit 0
[ "$MODE" != "announce" ] && exit 0
# Muted sessions never reach here (ingest guards first), but be defensive.
[ "$MUTED_FLAG" = "1" ] && exit 0
[ "$VOICE" = "-" ] && exit 0

defer() {
  # Append the sessionId, dedup (grep -qxF against existing lines).
  touch "$PENDING"
  if ! grep -qxF "$SESSION_ID" "$PENDING" 2>/dev/null; then
    echo "$SESSION_ID" >>"$PENDING"
  fi
  loga "floor busy — deferred ${SESSION_ID:0:12}"
}

# Play the cached announce phrase; fall back to a legacy SFX when the voice has
# no announce phrases cached yet. Both are free (no synthesis). The lock is
# acquired and held *inside* phrases.ts play (try-once): rc 2 means the floor was
# busy → defer the hand; rc 0/1 means the chime played or there was nothing to
# play. This closes the check-then-play race the old read-only lock check had.
if ls "${PHRASES_DIR}/${VOICE}"/announce_*.mp3 >/dev/null 2>&1; then
  if [ -f "$SERVER_DIR/src/phrases.ts" ] && command -v pnpm >/dev/null 2>&1; then
    rc=0
    (cd "$SERVER_DIR" && pnpm exec tsx src/phrases.ts play "$VOICE" announce) >/dev/null 2>&1 || rc=$?
    if [ "$rc" = "2" ]; then
      defer
    else
      loga "announce phrase for ${SESSION_ID:0:12} (voice ${VOICE})"
    fi
  fi
else
  # Legacy SFX fallback (voice has no announce phrases yet). Best-effort: played
  # without holding the stream lock, so a grant landing at the same instant could
  # briefly overlap. Accepted as a tiny risk for this rare no-phrase case.
  sfx="$(bash "$SCRIPTS_DIR/random_sfx.sh" 2>/dev/null || true)"
  if [ -n "$sfx" ] && [ -f "$sfx" ]; then
    loga "no announce phrases for ${VOICE} — legacy SFX $(basename "$sfx")"
    afplay "$sfx" >/dev/null 2>&1 &
  fi
fi

exit 0
