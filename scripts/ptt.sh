#!/usr/bin/env bash
#
# ptt.sh — Push-to-talk capture: duck playback, record mic, transcribe, route.
#
# Usage:
#   ptt.sh start [sessionId]     Start recording (optional pre-bound target)
#   ptt.sh stop [sessionId]      Stop recording, transcribe, route command
#   ptt.sh _transcribe <wav> [sessionId]   Test hook: transcribe + route only
#
set -euo pipefail

TTS_DIR="$HOME/.cursor/tts"
PTT_DIR="$TTS_DIR/ptt"
SCRIPTS_DIR="$TTS_DIR/scripts"
LOG_FILE="$TTS_DIR/logs/hook.log"
MODEL="$TTS_DIR/models/ggml-base.en.bin"
PID_FILE="$TTS_DIR/.playback-pid"
PAUSED_FLAG="$TTS_DIR/.playback-paused"
TTS_SERVER_DIR="$TTS_DIR/tts-server"
VOICE_TS="$TTS_SERVER_DIR/src/voice.ts"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] ptt: $*" >> "$LOG_FILE" 2>/dev/null || true; }

mkdir -p "$PTT_DIR" "$(dirname "$LOG_FILE")"

get_mic_device() {
    python3 - <<'PY'
import json
import os

p = os.path.join(os.path.expanduser("~"), ".cursor", "tts", "config.json")
try:
    with open(p, encoding="utf-8") as f:
        c = json.load(f)
    print(c.get("mic_device", ":default"))
except (OSError, json.JSONDecodeError):
    print(":default")
PY
}

build_whisper_prompt() {
    python3 - <<'PY'
import glob
import json
import os

names = []
sessions_dir = os.path.expanduser("~/.claude/sessions")
for path in glob.glob(os.path.join(sessions_dir, "*.json")):
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        name = data.get("name")
        if name:
            names.append(name)
    except (OSError, json.JSONDecodeError):
        pass

chars_path = os.path.join(
    os.path.expanduser("~"), ".cursor", "tts", "tts-server", "src", "characters.json"
)
if os.path.isfile(chars_path):
    try:
        with open(chars_path, encoding="utf-8") as f:
            chars = json.load(f)
        for entry in chars.values():
            if isinstance(entry, dict) and entry.get("name"):
                names.append(entry["name"])
    except (OSError, json.JSONDecodeError):
        pass

seen = set()
unique = []
for name in names:
    if name not in seen:
        seen.add(name)
        unique.append(name)

suffix = "go ahead, pause, say again, status, mute"
if unique:
    print(", ".join(unique) + ", " + suffix)
else:
    print(suffix)
PY
}

is_playback_playing() {
    if [ ! -f "$PID_FILE" ]; then
        return 1
    fi
    local pid
    pid=$(cat "$PID_FILE" 2>/dev/null || true)
    if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then
        return 1
    fi
    if [ -f "$PAUSED_FLAG" ]; then
        return 1
    fi
    return 0
}

play_tick() {
    local sfx
    sfx=$("$SCRIPTS_DIR/random_sfx.sh" 2>/dev/null) || return 0
    afplay "$sfx" >/dev/null 2>&1 &
}

clean_ptt_files() {
    local id="$1"
    rm -f "$PTT_DIR/$id.pid" "$PTT_DIR/$id.wav" "$PTT_DIR/$id.target" "$PTT_DIR/$id.ducked"
}

clean_stale_pidfile() {
    local pidfile="$1"
    local id pid
    id=$(basename "$pidfile" .pid)
    pid=$(cat "$pidfile" 2>/dev/null || true)
    if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then
        clean_ptt_files "$id"
        return 0
    fi
    return 1
}

find_ptt_by_target() {
    local session_id="$1"
    local targetfile
    for targetfile in "$PTT_DIR"/*.target; do
        [ -f "$targetfile" ] || continue
        if [ "$(cat "$targetfile" 2>/dev/null)" = "$session_id" ]; then
            basename "$targetfile" .target
            return 0
        fi
    done
    return 1
}

find_newest_live_ptt_id() {
    local newest_id=""
    local newest_ts=0
    local pidfile id ts pid

    for pidfile in "$PTT_DIR"/*.pid; do
        [ -f "$pidfile" ] || continue
        if clean_stale_pidfile "$pidfile"; then
            continue
        fi
        id=$(basename "$pidfile" .pid)
        ts=${id%%-*}
        if [ "$ts" -gt "$newest_ts" ] 2>/dev/null; then
            newest_ts=$ts
            newest_id=$id
        fi
    done

    echo "$newest_id"
}

resolve_ptt_id() {
    local session_id="${1:-}"

    if [ -n "$session_id" ]; then
        find_ptt_by_target "$session_id" && return 0
        echo "ptt: no live recording for session $session_id" >&2
        return 1
    fi

    local id
    id=$(find_newest_live_ptt_id)
    if [ -z "$id" ]; then
        echo "ptt: no live recording" >&2
        return 1
    fi
    echo "$id"
}

transcribe_wav() {
    local wav="$1"
    local prompt out_base transcript

    if [ ! -f "$MODEL" ]; then
        echo "ptt: whisper model missing at $MODEL" >&2
        return 1
    fi
    if [ ! -f "$wav" ]; then
        echo "ptt: wav not found: $wav" >&2
        return 1
    fi

    prompt=$(build_whisper_prompt)
    out_base="${wav%.wav}"

    whisper-cli -m "$MODEL" \
        --prompt "$prompt" \
        -f "$wav" \
        --no-timestamps \
        --output-txt \
        -of "$out_base" \
        >/dev/null 2>&1

    transcript=""
    if [ -f "${out_base}.txt" ]; then
        transcript=$(sed 's/^[[:space:]]*//;s/[[:space:]]*$//' "${out_base}.txt" | head -1)
        rm -f "${out_base}.txt"
    fi

    if [ -z "$transcript" ]; then
        echo "ptt: empty transcript" >&2
        return 1
    fi

    log "transcript: $transcript"
    echo "$transcript"
}

route_transcript() {
    local transcript="$1"
    local target="${2:-}"
    local route_exit=0

    if [ -f "$VOICE_TS" ]; then
        if [ -n "$target" ]; then
            (cd "$TTS_SERVER_DIR" && pnpm exec tsx src/voice.ts route --target "$target" "$transcript") || route_exit=$?
        else
            (cd "$TTS_SERVER_DIR" && pnpm exec tsx src/voice.ts route "$transcript") || route_exit=$?
        fi
    else
        log "voice.ts missing — transcript only: $transcript"
        route_exit=0
    fi

    return "$route_exit"
}

resume_if_ducked() {
    local id="$1"
    local route_exit="$2"

    if [ -f "$PTT_DIR/$id.ducked" ] && [ "$route_exit" -ne 10 ]; then
        "$SCRIPTS_DIR/pause.sh" || true
    fi
}

transcribe_and_route() {
    local wav="$1"
    local target="${2:-}"
    local id="${3:-}"
    local transcript route_exit=0

    transcript=$(transcribe_wav "$wav")
    route_transcript "$transcript" "$target" || route_exit=$?

    if [ -n "$id" ]; then
        resume_if_ducked "$id" "$route_exit"
        clean_ptt_files "$id"
    fi

    echo "$transcript"
    return 0
}

cmd_start() {
    local session_id="${1:-}"
    local id mic_device

    id="$(date +%s)-$$"

    if is_playback_playing; then
        "$SCRIPTS_DIR/pause.sh" || true
        : > "$PTT_DIR/$id.ducked"
        log "ducked playback for $id"
    fi

    play_tick

    mic_device=$(get_mic_device)
    ffmpeg -f avfoundation -i "$mic_device" -ar 16000 -ac 1 -y "$PTT_DIR/$id.wav" \
        >>"$LOG_FILE" 2>&1 &
    echo $! > "$PTT_DIR/$id.pid"

    if [ -n "$session_id" ]; then
        echo "$session_id" > "$PTT_DIR/$id.target"
    fi

    log "started $id (mic=$mic_device target=${session_id:-none})"
    echo "$id"
}

cmd_stop() {
    local session_id="${1:-}"
    local id pid target wav transcript route_exit=0

    id=$(resolve_ptt_id "$session_id")
    pid=$(cat "$PTT_DIR/$id.pid" 2>/dev/null || true)
    if [ -z "$pid" ]; then
        echo "ptt: missing pid for $id" >&2
        clean_ptt_files "$id"
        return 1
    fi

    kill -INT "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true

    play_tick

    wav="$PTT_DIR/$id.wav"
    target=""
    if [ -f "$PTT_DIR/$id.target" ]; then
        target=$(cat "$PTT_DIR/$id.target" 2>/dev/null || true)
    fi

    transcript=$(transcribe_wav "$wav")
    route_transcript "$transcript" "$target" || route_exit=$?
    resume_if_ducked "$id" "$route_exit"
    clean_ptt_files "$id"

    echo "$transcript"
    return 0
}

cmd_transcribe() {
    local wav="${1:-}"
    local session_id="${2:-}"

    if [ -z "$wav" ]; then
        echo "Usage: ptt.sh _transcribe <wav> [sessionId]" >&2
        return 1
    fi

    transcribe_and_route "$wav" "$session_id"
}

case "${1:-}" in
    start)
        cmd_start "${2:-}"
        ;;
    stop)
        cmd_stop "${2:-}"
        ;;
    _transcribe)
        cmd_transcribe "${2:-}" "${3:-}"
        ;;
    *)
        echo "Usage: ptt.sh start|stop [sessionId] | ptt.sh _transcribe <wav> [sessionId]" >&2
        exit 1
        ;;
esac
