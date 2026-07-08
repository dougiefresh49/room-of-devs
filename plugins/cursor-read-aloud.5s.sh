#!/usr/bin/env bash
#
# cursor-read-aloud.5s.sh — SwiftBar plugin for Cursor/Claude Code TTS playback.
# Filename convention: <name>.<refresh_interval>.<ext>
# Refreshes every 5 seconds.
#

TTS_DIR="$HOME/.cursor/tts"
QUEUE_DIR="$TTS_DIR/queue"
CONFIG="$TTS_DIR/config.json"
SCRIPTS_DIR="$TTS_DIR/scripts"
PID_FILE="$TTS_DIR/.playback-pid"
LISTENING_FLAG="$TTS_DIR/listening.enabled"
PLAYBACK_FILE_REF="$TTS_DIR/.playback-file"
PAUSED_FLAG="$TTS_DIR/.playback-paused"

# ── Listening on/off (default: on if flag missing) ────────────────
LISTENING=1
if [ -f "$LISTENING_FLAG" ]; then
    case "$(tr -d ' \n' < "$LISTENING_FLAG")" in
        0|false|FALSE|off) LISTENING=0 ;;
    esac
fi

# ── Read config ───────────────────────────────────────────────────
DEFAULT_SPEED="1.25"
VOICE_ID=""
NOTIFICATIONS_ON=0
NOTIFICATION_SOUND="random_sfx"
PLAYBACK_MODE="auto"
if [ -f "$CONFIG" ]; then
    # One python3 call prints all six values, one per line (perf: was 6 spawns).
    CONFIG_VALUES=$(python3 - "$CONFIG" 2>/dev/null <<'PY'
import json, sys
try:
    c = json.load(open(sys.argv[1]))
except Exception:
    c = {}
print(c.get('default_speed', 1.25))
print(c.get('elevenlabs_voice_id', ''))
print(1 if c.get('notifications_enabled') is True else 0)
print(c.get('notification_sound', 'random_sfx'))
mode = c.get('playback_mode')
if mode not in ('auto', 'announce', 'silent'):
    mode = 'auto' if c.get('streaming_enabled') is True else 'silent'
print(mode)
PY
    ) || CONFIG_VALUES=""
    if [ -n "$CONFIG_VALUES" ]; then
        {
            read -r DEFAULT_SPEED
            read -r VOICE_ID
            read -r NOTIFICATIONS_ON
            read -r NOTIFICATION_SOUND
            read -r PLAYBACK_MODE
        } <<< "$CONFIG_VALUES"
    fi
fi

# ── Check TTS server status ──────────────────────────────────────
DAEMON_RUNNING=false
DAEMON_PID_FILE="$TTS_DIR/.tts-server.pid"
if [ -f "$DAEMON_PID_FILE" ]; then
    DAEMON_PID=$(cat "$DAEMON_PID_FILE" 2>/dev/null || true)
    if [ -n "$DAEMON_PID" ] && kill -0 "$DAEMON_PID" 2>/dev/null; then
        DAEMON_RUNNING=true
    fi
fi

# ── Count unplayed items ──────────────────────────────────────────
QUEUE_COUNT=0
if [ -d "$QUEUE_DIR" ]; then
    QUEUE_COUNT=$(find "$QUEUE_DIR" -name '*.json' -maxdepth 1 2>/dev/null | wc -l | tr -d ' ')
fi

# ── Check if playing ──────────────────────────────────────────────
IS_PLAYING=false
if [ -f "$PID_FILE" ]; then
    PLAY_PID=$(cat "$PID_FILE" 2>/dev/null || true)
    if [ -n "$PLAY_PID" ] && kill -0 "$PLAY_PID" 2>/dev/null; then
        IS_PLAYING=true
    fi
fi

IS_PAUSED=false
if [ -f "$PAUSED_FLAG" ]; then
    IS_PAUSED=true
fi

# ── Menu bar image (SwiftBar: image= base64) ──────────────────────
ICON_DIR="$TTS_DIR/icons"
ICON_IDLE_MENU="$ICON_DIR/tmnt-menubar-idle.png"
ICON_QUEUE_MENU="$ICON_DIR/tmnt-menubar-queued.png"
ICON_IDLE_FALLBACK="$ICON_DIR/tmnt-icon.png"
ICON_QUEUE_FALLBACK="$ICON_DIR/tmnt-notification-queued.png"
CACHE_DIR="$TTS_DIR/cache"

swiftbar_image_b64() {
    local src="$1"
    local name cfile
    name=$(basename "$src")
    cfile="$CACHE_DIR/swiftbar-${name}.b64"
    [ -f "$src" ] || return 1
    mkdir -p "$CACHE_DIR" 2>/dev/null || true
    if [ ! -f "$cfile" ] || [ "$src" -nt "$cfile" ]; then
        base64 <"$src" | tr -d '\n' >"$cfile"
    fi
    cat "$cfile"
}

BAR_SRC=""
if [ "$QUEUE_COUNT" -gt 0 ] 2>/dev/null; then
    BAR_SRC="$ICON_QUEUE_MENU"
    [ -f "$BAR_SRC" ] || BAR_SRC="$ICON_QUEUE_FALLBACK"
else
    BAR_SRC="$ICON_IDLE_MENU"
    [ -f "$BAR_SRC" ] || BAR_SRC="$ICON_IDLE_FALLBACK"
fi

BAR_B64=""
if [ -n "$BAR_SRC" ] && [ -f "$BAR_SRC" ]; then
    BAR_B64=$(swiftbar_image_b64 "$BAR_SRC") || BAR_B64=""
fi

# ── Title bar ─────────────────────────────────────────────────────
if [ -n "$BAR_B64" ]; then
    if [ "$QUEUE_COUNT" -gt 0 ] 2>/dev/null; then
        echo "${QUEUE_COUNT} | image=${BAR_B64} dropdown=false"
    else
        echo " | image=${BAR_B64} dropdown=false"
    fi
elif [ "$LISTENING" = 0 ]; then
    if [ "$IS_PLAYING" = true ]; then
        echo "⏸🔊"
    elif [ "$QUEUE_COUNT" -gt 0 ] 2>/dev/null; then
        echo "⏸ $QUEUE_COUNT"
    else
        echo "⏸"
    fi
elif [ "$IS_PLAYING" = true ]; then
    echo "🔊 ($QUEUE_COUNT)"
elif [ "$QUEUE_COUNT" -gt 0 ] 2>/dev/null; then
    echo "🔈 $QUEUE_COUNT"
else
    echo "🔇"
fi

echo "---"

# ── Play latest (SwiftBar: ctrl+shift+p; Hammerspoon: ctrl+Play) ─
echo "Play Latest | bash=$SCRIPTS_DIR/play_latest.sh terminal=false refresh=true shortcut=ctrl+shift+p"
echo "Replay Last | bash=$SCRIPTS_DIR/replay.sh terminal=false refresh=true shortcut=ctrl+shift+r"

# ── Raised Hands (hand-raise mode) ───────────────────────────────
STATE_DIR="$TTS_DIR/state"
MUTED_SESSIONS_PATH="$TTS_DIR/muted_sessions.json"
export STATE_DIR SCRIPTS_DIR QUEUE_DIR MUTED_SESSIONS_PATH
python3 - <<'PY'
import json
import os
from datetime import datetime, timezone

state_dir = os.environ.get("STATE_DIR", "")
queue_dir = os.environ.get("QUEUE_DIR", "")
scripts_dir = os.environ["SCRIPTS_DIR"]
muted_path = os.environ.get("MUTED_SESSIONS_PATH", "")

muted = set()
if muted_path and os.path.isfile(muted_path):
    try:
        with open(muted_path, encoding="utf-8") as fh:
            data = json.load(fh)
        if isinstance(data, list):
            muted = set(data)
    except (OSError, json.JSONDecodeError):
        pass

def humanize_wait(raised_at):
    if not raised_at:
        return "?"
    try:
        then = datetime.fromisoformat(raised_at.replace("Z", "+00:00"))
    except ValueError:
        return "?"
    now = datetime.now(timezone.utc)
    secs = max(0, int((now - then).total_seconds()))
    if secs < 60:
        return f"{secs}s"
    mins = secs // 60
    if mins < 60:
        return f"{mins}m"
    hours = mins // 60
    rem_m = mins % 60
    if rem_m:
        return f"{hours}h {rem_m}m"
    return f"{hours}h"

def queue_count_for(session_id):
    if not queue_dir or not os.path.isdir(queue_dir):
        return 0
    short = session_id[:12]
    suffix = f"-cc-{short}.json"
    try:
        return sum(
            1 for name in os.listdir(queue_dir) if name.endswith(suffix)
        )
    except OSError:
        return 0

hands = []
if state_dir and os.path.isdir(state_dir):
    for fname in os.listdir(state_dir):
        if not fname.endswith(".json"):
            continue
        path = os.path.join(state_dir, fname)
        try:
            with open(path, encoding="utf-8") as fh:
                s = json.load(fh)
        except (OSError, json.JSONDecodeError):
            continue
        if s.get("state") != "hand_raised":
            continue
        sid = s.get("sessionId") or fname[:-5]
        if sid in muted:
            continue
        raised = s.get("raisedAt") or ""
        try:
            sort_key = datetime.fromisoformat(raised.replace("Z", "+00:00"))
        except ValueError:
            sort_key = datetime.max.replace(tzinfo=timezone.utc)
        name = (s.get("name") or sid[:12]).replace("|", "/")
        if len(name) > 24:
            name = name[:22] + ".."
        hands.append((sort_key, sid, name, raised))

if not hands:
    raise SystemExit(0)

hands.sort(key=lambda x: x[0])
print(f"Raised Hands ✋ ({len(hands)}) | disabled=true size=12")

for _, sid, name, raised in hands:
    wait = humanize_wait(raised)
    print(
        f"✋ {name} — waiting {wait} | "
        f"bash={scripts_dir}/grant_floor.sh param1={sid} terminal=false refresh=true"
    )
    qn = queue_count_for(sid)
    if qn > 1:
        print(
            f"--Drain ({qn} items) | "
            f"bash={scripts_dir}/grant_floor.sh param1=drain param2={sid} terminal=false refresh=true"
        )

print(
    f"Go Ahead (next hand) | "
    f"bash={scripts_dir}/grant_floor.sh terminal=false refresh=true shortcut=ctrl+shift+g"
)
PY

echo "---"

# ── Now Playing / Agent Messages / Recent Playback ───────────────
# One python3 call emits all three dynamic sections (perf: was 3 spawns).
PROCESSING_DIR="$TTS_DIR/.processing"
REPLAY_DIR="$TTS_DIR/replay"
export QUEUE_DIR SCRIPTS_DIR PROCESSING_DIR REPLAY_DIR PLAYBACK_FILE_REF
export IS_PLAYING IS_PAUSED QUEUE_COUNT
python3 - <<'PY'
import base64
import json
import os
from collections import defaultdict
from datetime import datetime

queue_dir = os.environ["QUEUE_DIR"]
scripts_dir = os.environ["SCRIPTS_DIR"]
processing_dir = os.environ.get("PROCESSING_DIR", "")
replay_dir = os.environ.get("REPLAY_DIR", "")
playback_ref = os.environ.get("PLAYBACK_FILE_REF", "")
is_playing = os.environ.get("IS_PLAYING", "false") == "true"
is_paused = os.environ.get("IS_PAUSED", "false") == "true"
try:
    queue_count = int(os.environ.get("QUEUE_COUNT", "0"))
except ValueError:
    queue_count = 0
sessions_dir = os.path.expanduser("~/.claude/sessions")

# ── Now playing (media controls) ──────────────────────────────
if is_playing:
    if is_paused:
        print(f"▶ Resume | bash={scripts_dir}/pause.sh terminal=false refresh=true shortcut=ctrl+shift+space")
    else:
        print(f"⏯ Pause | bash={scripts_dir}/pause.sh terminal=false refresh=true shortcut=ctrl+shift+space")
    print(f"⏮ Start Over | bash={scripts_dir}/restart.sh terminal=false refresh=true")
    print(f"⏹ Stop Playback | bash={scripts_dir}/stop.sh terminal=false refresh=true")
    if os.path.isfile(playback_ref):
        try:
            with open(playback_ref) as fh:
                target = fh.read().replace("\n", "")
            with open(target) as fh:
                d = json.load(fh)
            title = (d.get("thread_title") or "").strip()
            if not title:
                title = str(d.get("conversation_id", "unknown"))[:12]
            if len(title) > 28:
                title = title[:26] + "..."
            text = (d.get("text", "") or "")[:60].replace(chr(10), " ").strip()
            now_line = f"Now Playing: {title} — {text}..."
        except Exception:
            now_line = "Now Playing: …"
        print(f"{now_line} | disabled=true size=11")
    print("---")

# ── Agent Messages ────────────────────────────────────────────
print("Agent Messages | disabled=true size=12")

def load_json(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None

def is_processing(queue_path):
    if not processing_dir:
        return False
    marker = os.path.join(processing_dir, os.path.basename(queue_path))
    if not os.path.isfile(marker):
        return False
    try:
        pid = open(marker).read().strip()
        os.kill(int(pid), 0)
        return True
    except (OSError, ValueError):
        try:
            os.unlink(marker)
        except OSError:
            pass
        return False

def lookup_session_name(session_id):
    """Look up session name from ~/.claude/sessions/*.json."""
    if not session_id or not os.path.isdir(sessions_dir):
        return None
    try:
        for fname in os.listdir(sessions_dir):
            if not fname.endswith(".json"):
                continue
            path = os.path.join(sessions_dir, fname)
            try:
                with open(path, encoding="utf-8") as f:
                    s = json.load(f)
                if s.get("sessionId") == session_id and s.get("name"):
                    return s["name"]
            except (OSError, json.JSONDecodeError):
                continue
    except OSError:
        pass
    return None

def preview_for(path, data):
    title = (data.get("thread_title") or "").strip()
    if not title:
        cid = data.get("conversation_id") or "unknown"
        title = str(cid)[:12]
    if len(title) > 22:
        title = title[:20] + "..."
    text = (data.get("text") or "")[:50].replace("\n", " ").strip()
    chars = len(data.get("text") or "")
    est = int(chars / 15)
    mins, secs = divmod(est, 60)
    dur = f"{mins}m{secs:02d}s" if mins > 0 else f"{secs}s"
    return f"[{title}] {text}... (~{dur})"

if queue_count > 0:
    paths = []
    try:
        for name in os.listdir(queue_dir):
            if name.endswith(".json"):
                paths.append(os.path.join(queue_dir, name))
    except OSError:
        paths = []

    paths.sort(key=lambda p: os.path.basename(p), reverse=True)

    groups = defaultdict(list)
    for p in paths:
        d = load_json(p)
        if not d:
            continue
        cid = (d.get("conversation_id") or "").strip()
        key = cid if cid else (d.get("thread_title") or "unknown")
        groups[key].append((p, d))

    def group_sort_key(items):
        return max((os.path.basename(i[0]) for i in items), default="")

    group_list = sorted(groups.items(), key=lambda kv: group_sort_key(kv[1]), reverse=True)

    for grp_key, items in group_list:
        items.sort(key=lambda x: os.path.basename(x[0]), reverse=True)
        first = items[0][1]
        label = (first.get("thread_title") or "").strip()
        cid = (first.get("conversation_id") or "").strip()
        if not label or label == "Claude Code":
            session_name = lookup_session_name(cid)
            if session_name:
                label = session_name
            elif not label:
                label = str(cid or "Chat")[:16]
        if len(label) > 32:
            label = label[:30] + "..."
        n = len(items)
        count_prefix = f"({n:02d}) "
        print(f"{count_prefix}{label} | disabled=true")
        for path, data in items:
            processing = is_processing(path)
            prev = preview_for(path, data)
            prev = prev.replace("|", "/")
            if processing:
                print(f"--⏳ {prev} | disabled=true")
            else:
                print(
                    f"--{prev} | bash={scripts_dir}/play_node.sh param1={path} terminal=false refresh=true"
                )
        token = base64.urlsafe_b64encode(
            json.dumps({"key": grp_key}, separators=(",", ":")).encode("utf-8")
        ).decode("ascii").rstrip("=")
        print("-- | disabled=true")
        print(
            f"--Clear Messages | bash={scripts_dir}/clear_thread_queue.sh param1={token} terminal=false refresh=true"
        )
else:
    print("No queued responses | disabled=true")

print("---")

# ── Recent Playback (replay saved audio) ──────────────────────
if os.path.isdir(replay_dir):
    try:
        replay_files = sorted(
            [f for f in os.listdir(replay_dir) if f.endswith(".mp3")],
            reverse=True,
        )
    except OSError:
        replay_files = []
    if replay_files:
        print("Recent Playback | disabled=true size=12")
        for f in replay_files[:10]:
            path = os.path.join(replay_dir, f)
            meta_path = path.replace(".mp3", ".json")

            meta = {}
            if os.path.isfile(meta_path):
                try:
                    with open(meta_path) as mf:
                        meta = json.load(mf)
                except (OSError, json.JSONDecodeError):
                    pass

            # Use file mtime for local time (always correct timezone)
            mtime = os.path.getmtime(path)
            local_dt = datetime.fromtimestamp(mtime)
            hour = local_dt.hour % 12 or 12
            ampm = "am" if local_dt.hour < 12 else "pm"
            time_str = f"{hour}:{local_dt.minute:02d}{ampm}"

            # Build label from metadata
            parts = []
            session = meta.get("sessionName") or meta.get("sessionId", "")[:12]
            character = meta.get("character")
            source = meta.get("source", "")
            preview = meta.get("textPreview", "")

            if session:
                parts.append(f"[{session}]")
            if character:
                parts.append(character)
            elif source == "dynamic-response":
                parts.append("prompt ack")
            elif source == "ask-user":
                parts.append("question")
            elif source == "queue":
                parts.append("response")

            if preview:
                prev = preview[:50].replace("\n", " ").strip()
                if prev:
                    parts.append(f"— {prev}...")

            label = " ".join(parts) if parts else f.replace(".mp3", "")
            display = f"{time_str} {label}"
            display = display.replace("|", "/")
            if len(display) > 70:
                display = display[:68] + ".."
            print(f"{display} | bash=/usr/bin/afplay param1={path} terminal=false size=12")
        print("---")
PY

# ── Settings (voice, speed, notifications) ────────────────────────
echo "Settings | disabled=true size=12"

# ── Voice: ElevenLabs voices from API cache + per-session overrides ─
# One python3 call emits the Voice line, voice submenu, and Session Voices
# submenu (perf: was 3 spawns).
export VOICE_ID_CURRENT="$VOICE_ID"
export SCRIPTS_DIR_EXPORT="$SCRIPTS_DIR"
python3 - <<'PY'
import json
import os

scripts_dir = os.environ.get("SCRIPTS_DIR_EXPORT", "")
current_vid = os.environ.get("VOICE_ID_CURRENT", "")
tts_dir = os.path.expanduser("~/.cursor/tts")
cache_file = os.path.join(tts_dir, "cache", "voices.json")

voices = []
if os.path.isfile(cache_file):
    try:
        with open(cache_file, encoding="utf-8") as f:
            voices = json.load(f)
    except (OSError, json.JSONDecodeError):
        pass

# Current voice display line
if not current_vid:
    voice_display = "Not set"
elif not os.path.isfile(cache_file):
    voice_display = current_vid
else:
    for v in voices:
        if v.get("voice_id") == current_vid:
            voice_display = v.get("name", current_vid)
            break
    else:
        voice_display = current_vid[:16] + "..." if len(current_vid) > 16 else current_vid
print(f"Voice: {voice_display}")

# Voice submenu from cached ElevenLabs voices
if not voices:
    print(f"--No voices cached | disabled=true")
    print(f"--Refresh Voices | bash={scripts_dir}/fetch_voices.py param1=--refresh terminal=false refresh=true")
else:
    custom_categories = {"cloned", "generated", "professional"}
    custom = [v for v in voices if v.get("category", "").lower() in custom_categories]
    premade = [v for v in voices if v.get("category", "").lower() not in custom_categories]

    def print_voice(v):
        vid = v.get("voice_id", "")
        name = v.get("name", "Unknown")
        labels = v.get("labels", {})
        accent = labels.get("accent", "")
        gender = labels.get("gender", "")
        suffix_parts = [p for p in [gender, accent] if p]
        suffix = f" ({', '.join(suffix_parts)})" if suffix_parts else ""
        mark = "✓ " if vid == current_vid else "  "
        display = f"{name}{suffix}".replace("|", "/")
        if len(display) > 40:
            display = display[:38] + ".."
        print(f"--{mark}{display} | bash={scripts_dir}/set_voice.sh param1={vid} terminal=false refresh=true")

    if custom:
        print("--My Voices | disabled=true size=11")
        for v in custom:
            print_voice(v)
    if custom and premade:
        print("----- | disabled=true size=11")
    if premade:
        print("--Library Voices | disabled=true size=11")
        for v in premade:
            print_voice(v)

    print("----- | disabled=true size=11")
    print(f"--Refresh Voices | bash={scripts_dir}/fetch_voices.py param1=--refresh terminal=false refresh=true")

print(f"--Paste Voice ID... | bash={scripts_dir}/paste_voice_id.sh terminal=false refresh=true")

# ── Per-session voice overrides ──────────────────────────────
print("Session Voices")

sessions_dir = os.path.expanduser("~/.claude/sessions")
session_voices_path = os.path.join(tts_dir, "session_voices.json")

session_voices = {}
if os.path.isfile(session_voices_path):
    try:
        with open(session_voices_path) as f:
            session_voices = json.load(f)
    except (OSError, json.JSONDecodeError):
        pass

voice_names = {v.get("voice_id", ""): v.get("name", "?") for v in voices}

muted_sessions = []
muted_path = os.path.join(tts_dir, "muted_sessions.json")
if os.path.isfile(muted_path):
    try:
        with open(muted_path) as f:
            muted_sessions = json.load(f)
        if not isinstance(muted_sessions, list):
            muted_sessions = []
    except (OSError, json.JSONDecodeError):
        pass

active_sessions = []
if os.path.isdir(sessions_dir):
    try:
        for fname in os.listdir(sessions_dir):
            if not fname.endswith(".json"):
                continue
            path = os.path.join(sessions_dir, fname)
            try:
                with open(path) as f:
                    s = json.load(f)
                sid = s.get("sessionId", "")
                name = s.get("name") or s.get("sessionId", "")[:12]
                if sid:
                    active_sessions.append((sid, name, s.get("cwd", "")))
            except (OSError, json.JSONDecodeError):
                continue
    except OSError:
        pass

if not active_sessions:
    print("--No active sessions | disabled=true")
else:
    for sid, name, cwd in sorted(active_sessions, key=lambda x: x[1]):
        current_voice = session_voices.get(sid, "")
        voice_label = voice_names.get(current_voice, "default") if current_voice else "default"
        is_muted = sid in muted_sessions
        display_name = name.replace("|", "/")
        if len(display_name) > 24:
            display_name = display_name[:22] + ".."
        mute_indicator = " [muted]" if is_muted else ""
        print(f"--{display_name}: {voice_label}{mute_indicator}")

        if is_muted:
            print(f"----Unmute | bash={scripts_dir}/set_session_mute.sh param1={sid} param2=unmute terminal=false refresh=true")
        else:
            print(f"----Mute | bash={scripts_dir}/set_session_mute.sh param1={sid} param2=mute terminal=false refresh=true")
        print("---- | disabled=true")
        print(f"----Use Default | bash={scripts_dir}/set_session_voice.sh param1={sid} param2=--clear terminal=false refresh=true")
        for v in voices:
            vid = v.get("voice_id", "")
            vname = v.get("name", "Unknown").replace("|", "/")
            mark = "✓ " if vid == current_voice else "  "
            print(f"----{mark}{vname} | bash={scripts_dir}/set_session_voice.sh param1={sid} param2={vid} terminal=false refresh=true")
PY

echo "Speed: ${DEFAULT_SPEED}x"
SPEEDS=("0.75" "1.0" "1.1" "1.15" "1.2" "1.25" "1.5" "2.0")
for spd in "${SPEEDS[@]}"; do
    if [ "$spd" = "$DEFAULT_SPEED" ]; then
        LABEL="✓ ${spd}x"
    else
        LABEL="  ${spd}x"
    fi
    echo "--$LABEL | bash=$SCRIPTS_DIR/set_speed.sh param1=$spd terminal=false refresh=true"
done

if [ "$NOTIFICATIONS_ON" = 1 ]; then
    echo "Notifications: On | bash=$SCRIPTS_DIR/set_notifications.sh param1=off terminal=false refresh=true"
else
    echo "Notifications: Off | bash=$SCRIPTS_DIR/set_notifications.sh param1=on terminal=false refresh=true"
fi

case "$PLAYBACK_MODE" in
    auto) PLAYBACK_MODE_LABEL="Auto" ;;
    announce) PLAYBACK_MODE_LABEL="Announce" ;;
    silent) PLAYBACK_MODE_LABEL="Silent" ;;
    *) PLAYBACK_MODE_LABEL="Auto" ;;
esac
echo "Playback: ${PLAYBACK_MODE_LABEL}"
for mode in auto announce silent; do
    case "$mode" in
        auto) LABEL="Auto" ;;
        announce) LABEL="Announce" ;;
        silent) LABEL="Silent" ;;
    esac
    if [ "$mode" = "$PLAYBACK_MODE" ]; then
        echo "--✓ ${LABEL} | bash=$SCRIPTS_DIR/set_playback_mode.sh param1=$mode terminal=false refresh=true"
    else
        echo "--  ${LABEL} | bash=$SCRIPTS_DIR/set_playback_mode.sh param1=$mode terminal=false refresh=true"
    fi
done

case "$NOTIFICATION_SOUND" in
    [Nn][Oo][Nn][Ee]) NOTIFICATION_SOUND_LABEL="None (silent)" ;;
    random_sfx) NOTIFICATION_SOUND_LABEL="Random SFX" ;;
    *) NOTIFICATION_SOUND_LABEL="$NOTIFICATION_SOUND" ;;
esac
echo "Notification sound: ${NOTIFICATION_SOUND_LABEL}"
export NOTIFICATION_SOUND_MENU_SCRIPTS="$SCRIPTS_DIR"
export NOTIFICATION_SOUND_MENU_CURRENT="$NOTIFICATION_SOUND"
python3 - <<'PY'
"""Notification sound submenu: random sfx, built-in alerts, custom ~/Library/Sounds."""
import base64
import os

scripts = os.environ["NOTIFICATION_SOUND_MENU_SCRIPTS"]
current = os.environ.get("NOTIFICATION_SOUND_MENU_CURRENT", "random_sfx").strip()

options = [
    ("random_sfx", "Random SFX (ElevenLabs)"),
    ("default", "Default"),
    ("none", "None (silent)"),
]

builtins = [
    ("Glass", "Glass"),
    ("Ping", "Ping"),
    ("Tink", "Tink"),
    ("Pop", "Pop"),
    ("Submarine", "Submarine"),
    ("Purr", "Purr"),
    ("Funk", "Funk"),
    ("Hero", "Hero"),
    ("Basso", "Basso"),
    ("Blow", "Blow"),
    ("Bottle", "Bottle"),
    ("Frog", "Frog"),
    ("Morse", "Morse"),
    ("Sosumi", "Sosumi"),
]

def selected(sid: str) -> bool:
    return sid.lower() == current.lower()

def enc(s: str) -> str:
    return "B64:" + base64.urlsafe_b64encode(s.encode("utf-8")).decode("ascii").rstrip("=")

for sid, slab in options:
    mark = "✓ " if selected(sid) else "  "
    print(
        f"--{mark}{slab} | bash={scripts}/set_notification_sound.sh param1={sid} terminal=false refresh=true"
    )

print("----- | disabled=true size=11")

builtins_lower = {sid.lower() for sid, _ in builtins}
for sid, slab in builtins:
    mark = "✓ " if selected(sid) else "  "
    print(
        f"--{mark}{slab} | bash={scripts}/set_notification_sound.sh param1={sid} terminal=false refresh=true"
    )

custom_dir = os.path.join(os.path.expanduser("~"), "Library", "Sounds")
exts = {".aiff", ".aif", ".wav", ".caf", ".m4a"}
items = []
if os.path.isdir(custom_dir):
    try:
        for fn in sorted(os.listdir(custom_dir)):
            path = os.path.join(custom_dir, fn)
            if not os.path.isfile(path):
                continue
            stem, ext = os.path.splitext(fn)
            if ext.lower() not in exts:
                continue
            if stem.lower() in builtins_lower:
                continue
            items.append(stem)
    except OSError:
        pass

if items:
    print("----- | disabled=true size=11")
    cur_lower = current.lower()
    for stem in items:
        is_cur = stem == current or stem.lower() == cur_lower
        mark = "✓ " if is_cur else "  "
        display = stem.replace("|", "—")
        print(
            f"--{mark}{display} | bash={scripts}/set_notification_sound.sh param1={enc(stem)} terminal=false refresh=true"
        )

# Generate SFX option
tts_dir = os.path.expanduser("~/.cursor/tts")
sfx_dir = os.path.join(tts_dir, "sounds", "default")
sfx_count = 0
if os.path.isdir(sfx_dir):
    sfx_count = len([f for f in os.listdir(sfx_dir) if f.endswith(".mp3")])
print("----- | disabled=true size=11")
print(f"--Generate New SFX ({sfx_count} cached) | bash={scripts}/generate_sfx.sh terminal=false refresh=true")
print(f"--Regenerate All SFX | bash={scripts}/generate_sfx.sh param1=--force terminal=false refresh=true")
PY

echo "---"

# ── ElevenLabs ──────────────────────────────────────────────────
echo "ElevenLabs | disabled=true size=12"
CREDITS_JSON=$("$SCRIPTS_DIR/fetch_credits.sh" 2>/dev/null || echo '{}')
python3 - "$CREDITS_JSON" <<'PY'
import json, sys
from datetime import datetime
try:
    data = json.loads(sys.argv[1])
except (json.JSONDecodeError, IndexError):
    data = {}
if data.get("error"):
    print(f"Credits: unavailable | disabled=true")
else:
    used = data.get("character_count", 0)
    limit = data.get("character_limit", 0)
    remaining = limit - used
    tier = data.get("tier", "unknown").title()
    pct = int((used / limit * 100)) if limit > 0 else 0
    print(f"Plan: {tier} | disabled=true")
    print(f"Used: {used:,} / {limit:,} ({pct}%) | disabled=true")
    print(f"Remaining: {remaining:,} | disabled=true")
    reset = data.get("next_reset", 0)
    if reset > 0:
        dt = datetime.fromtimestamp(reset)
        print(f"Resets: {dt.strftime('%b %d')} | disabled=true")
PY
echo "Refresh Credits | bash=$SCRIPTS_DIR/fetch_credits.sh param1=--refresh terminal=false refresh=true"

echo "---"

# ── Debug / Logs ────────────────────────────────────────────────
echo "Debug / Logs | disabled=true size=12"
echo "Open Config | bash=/usr/bin/open param1=$CONFIG terminal=false"
echo "Open Logs | bash=/usr/bin/open param1=$TTS_DIR/logs/ terminal=false"

echo "---"

echo "Refresh | refresh=true"
if [ "$QUEUE_COUNT" -gt 0 ] 2>/dev/null && [ "$QUEUE_COUNT" -ne 0 ]; then
    echo "Clear All Messages | bash=$SCRIPTS_DIR/clear_queue.sh terminal=false refresh=true"
fi

if [ "$LISTENING" = 0 ]; then
    echo "▶ Start listening | bash=$SCRIPTS_DIR/set_listening.sh param1=on terminal=false refresh=true"
else
    echo "⏸ Stop listening | bash=$SCRIPTS_DIR/set_listening.sh param1=off terminal=false refresh=true"
fi

echo "Quit | bash=$SCRIPTS_DIR/quit.sh terminal=false refresh=true"
