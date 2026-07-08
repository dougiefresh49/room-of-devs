#!/usr/bin/env bash
#
# hold_room.sh — Panic-quiet the whole room (zero credits).
#
# Usage:
#   hold_room.sh              Hold: stop audio, stash the current playback mode,
#                             and force `silent` until released.
#   hold_room.sh <minutes>    Hold, then auto-release after N minutes.
#   hold_room.sh off          Release: restore the stashed mode + nudge any
#                             hands raised during the hold to announce by name.
#
# This script is THE single owner of playback-mode stash/restore. While a hold
# is active (.hold-room.json exists) set_mood.sh / set_playback_mode.sh refuse
# to touch the mode — a mood change mid-hold would corrupt the restore. Those
# scripts only proceed when invoked by us (CR_HOLD_ROOM=1).
#
set -euo pipefail

TTS_DIR="${TTS_DIR:-$HOME/.cursor/tts}"
CONFIG="$TTS_DIR/config.json"
SCRIPTS_DIR="$TTS_DIR/scripts"
SERVER_DIR="$TTS_DIR/tts-server"
HOLD_FILE="$TTS_DIR/.hold-room.json"
LOG_FILE="$TTS_DIR/logs/hook.log"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] hold_room: $*" >> "$LOG_FILE" 2>/dev/null || true; }

# Current *effective* playback mode: explicit playback_mode, else derived from
# streaming_enabled (mirrors config.ts effectivePlaybackMode / the SwiftBar plugin).
effective_mode() {
    CONFIG="$CONFIG" python3 - <<'PY'
import json, os
try:
    with open(os.environ["CONFIG"], encoding="utf-8") as f:
        c = json.load(f)
except Exception:
    c = {}
mode = c.get("playback_mode")
if mode not in ("auto", "announce", "silent"):
    mode = "auto" if c.get("streaming_enabled") is True else "silent"
print(mode)
PY
}

write_hold() {
    local prev="$1" until="$2" pid="$3"
    PREV="$prev" UNTIL="$until" PID="$pid" \
    HELD_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)" HOLD_FILE="$HOLD_FILE" python3 - <<'PY'
import json, os
data = {"heldAt": os.environ["HELD_AT"], "prevMode": os.environ["PREV"]}
if os.environ.get("UNTIL"):
    data["until"] = int(os.environ["UNTIL"])
if os.environ.get("PID"):
    data["pid"] = int(os.environ["PID"])
if os.environ.get("CR_DND") == "1":
    data["source"] = "dnd"
p = os.environ["HOLD_FILE"]
tmp = f"{p}.tmp.{os.getpid()}"
with open(tmp, "w", encoding="utf-8") as f:
    json.dump(data, f)
os.replace(tmp, p)
PY
}

read_field() {
    FIELD="$1" HOLD_FILE="$HOLD_FILE" python3 - <<'PY'
import json, os
try:
    with open(os.environ["HOLD_FILE"], encoding="utf-8") as f:
        d = json.load(f)
    v = d.get(os.environ["FIELD"], "")
    print("" if v is None else v)
except Exception:
    print("")
PY
}

ARG="${1:-}"

case "$ARG" in
    off)
        if [ ! -f "$HOLD_FILE" ]; then
            log "release: not held — noop"
            exit 0
        fi
        prev="$(read_field prevMode)"
        [ -n "$prev" ] || prev="announce"
        pid="$(read_field pid)"

        # Cancel a pending auto-release timer (unless the timer itself is the
        # one calling us — then there is nothing to kill).
        if [ "${CR_HOLD_TIMER:-}" != "1" ] && [ -n "$pid" ] && [ "$pid" != "$$" ]; then
            kill "$pid" 2>/dev/null || true
        fi

        CR_HOLD_ROOM=1 "$SCRIPTS_DIR/set_playback_mode.sh" "$prev" 2>/dev/null || true
        rm -f "$HOLD_FILE"
        log "released — restored $prev"

        # Nudge the deferred-announce path so hands raised during the hold get
        # announced by name on lift (free local `say`, no API calls).
        if [ -f "$SERVER_DIR/src/announce.ts" ]; then
            (cd "$SERVER_DIR" && pnpm exec tsx src/announce.ts fire) >/dev/null 2>&1 || true
        fi
        ;;
    ""|[0-9]*)
        minutes="$ARG"
        if [ -f "$HOLD_FILE" ]; then
            # Already held — never re-stash (that would overwrite prevMode with
            # `silent`). Just make sure audio is stopped.
            log "hold: already held — re-stopping audio"
            "$SCRIPTS_DIR/stop.sh" 2>/dev/null || true
            exit 0
        fi

        prev="$(effective_mode)"
        "$SCRIPTS_DIR/stop.sh" 2>/dev/null || true

        until=""
        timer_pid=""
        if [ "${minutes:-0}" -gt 0 ] 2>/dev/null; then
            until="$(python3 -c 'import time,sys; print(int(time.time())+int(sys.argv[1])*60)' "$minutes")"
            ( sleep "$((minutes * 60))"; CR_HOLD_TIMER=1 "$SCRIPTS_DIR/hold_room.sh" off ) &
            timer_pid=$!
            disown 2>/dev/null || true
        fi

        write_hold "$prev" "$until" "$timer_pid"
        CR_HOLD_ROOM=1 "$SCRIPTS_DIR/set_playback_mode.sh" silent 2>/dev/null || true
        log "held (prev=$prev${minutes:+, ${minutes}m})"
        ;;
    *)
        echo "Usage: hold_room.sh [minutes|off]" >&2
        exit 1
        ;;
esac
