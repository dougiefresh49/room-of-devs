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
STREAMING_ON=0
if [ -f "$CONFIG" ]; then
    DEFAULT_SPEED=$(python3 -c "import json; print(json.load(open('$CONFIG')).get('default_speed', 1.25))" 2>/dev/null || echo "1.25")
    VOICE_ID=$(python3 -c "import json; print(json.load(open('$CONFIG')).get('elevenlabs_voice_id', ''))" 2>/dev/null || echo "")
    NOTIFICATIONS_ON=$(python3 -c "import json; print(1 if json.load(open('$CONFIG')).get('notifications_enabled') is True else 0)" 2>/dev/null || echo "0")
    NOTIFICATION_SOUND=$(python3 -c "import json; print(json.load(open('$CONFIG')).get('notification_sound', 'random_sfx'))" 2>/dev/null || echo "random_sfx")
    STREAMING_ON=$(python3 -c "import json; print(1 if json.load(open('$CONFIG')).get('streaming_enabled') is True else 0)" 2>/dev/null || echo "0")
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

echo "---"

# ── Now playing (media controls) ──────────────────────────────────
if [ "$IS_PLAYING" = true ]; then
    if [ "$IS_PAUSED" = true ]; then
        echo "▶ Resume | bash=$SCRIPTS_DIR/pause.sh terminal=false refresh=true shortcut=ctrl+shift+space"
    else
        echo "⏯ Pause | bash=$SCRIPTS_DIR/pause.sh terminal=false refresh=true shortcut=ctrl+shift+space"
    fi
    echo "⏮ Start Over | bash=$SCRIPTS_DIR/restart.sh terminal=false refresh=true"
    echo "⏹ Stop Playback | bash=$SCRIPTS_DIR/stop.sh terminal=false refresh=true"
    if [ -f "$PLAYBACK_FILE_REF" ]; then
        NOW_LINE=$(python3 -c "
import json, sys
path = sys.argv[1]
try:
    with open(path) as fh:
        d = json.load(fh)
    title = (d.get('thread_title') or '').strip()
    if not title:
        title = str(d.get('conversation_id', 'unknown'))[:12]
    if len(title) > 28:
        title = title[:26] + '...'
    text = (d.get('text', '') or '')[:60].replace(chr(10), ' ').strip()
    print(f'Now Playing: {title} — {text}...')
except Exception:
    print('Now Playing: …')
" "$(tr -d '\n' < "$PLAYBACK_FILE_REF")" 2>/dev/null || echo "Now Playing: …")
        echo "$NOW_LINE | disabled=true size=11"
    fi
    echo "---"
fi

# ── Agent Messages ──────────────────────────────────────────────
echo "Agent Messages | disabled=true size=12"
export QUEUE_DIR SCRIPTS_DIR
PROCESSING_DIR="$TTS_DIR/.processing"
export PROCESSING_DIR
if [ "$QUEUE_COUNT" -gt 0 ] 2>/dev/null && [ "$QUEUE_COUNT" -ne 0 ]; then
    python3 - <<'PY'
import base64
import json
import os
from collections import defaultdict

queue_dir = os.environ["QUEUE_DIR"]
scripts_dir = os.environ["SCRIPTS_DIR"]
processing_dir = os.environ.get("PROCESSING_DIR", "")
sessions_dir = os.path.expanduser("~/.claude/sessions")

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
PY
else
    echo "No queued responses | disabled=true"
fi

echo "---"

# ── Settings (voice, speed, notifications) ────────────────────────
echo "Settings | disabled=true size=12"

# ── Voice: ElevenLabs voices from API cache ───────────────────────
export VOICE_ID_CURRENT="$VOICE_ID"
export SCRIPTS_DIR_EXPORT="$SCRIPTS_DIR"
VOICE_DISPLAY="$VOICE_ID"
if [ -z "$VOICE_ID" ]; then
    VOICE_DISPLAY="Not set"
fi

# Try to get voice name from cache
if [ -n "$VOICE_ID" ] && [ -f "$TTS_DIR/cache/voices.json" ]; then
    VOICE_NAME=$(python3 -c "
import json, sys
vid = sys.argv[1]
try:
    with open(sys.argv[2]) as f:
        voices = json.load(f)
    for v in voices:
        if v.get('voice_id') == vid:
            print(v.get('name', vid))
            break
    else:
        print(vid[:16] + '...' if len(vid) > 16 else vid)
except Exception:
    print(vid[:16] + '...' if len(vid) > 16 else vid)
" "$VOICE_ID" "$TTS_DIR/cache/voices.json" 2>/dev/null) || VOICE_NAME="$VOICE_ID"
    VOICE_DISPLAY="$VOICE_NAME"
fi

echo "Voice: ${VOICE_DISPLAY}"

# Voice submenu from cached ElevenLabs voices
python3 - <<'PY'
import json
import os
from collections import defaultdict

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
PY

# ── Per-session voice overrides ──────────────────────────────────
echo "Session Voices"
python3 - <<'PY'
import json
import os

tts_dir = os.path.expanduser("~/.cursor/tts")
scripts_dir = os.path.join(tts_dir, "scripts")
sessions_dir = os.path.expanduser("~/.claude/sessions")
session_voices_path = os.path.join(tts_dir, "session_voices.json")
cache_file = os.path.join(tts_dir, "cache", "voices.json")

session_voices = {}
if os.path.isfile(session_voices_path):
    try:
        with open(session_voices_path) as f:
            session_voices = json.load(f)
    except (OSError, json.JSONDecodeError):
        pass

voices = []
if os.path.isfile(cache_file):
    try:
        with open(cache_file) as f:
            voices = json.load(f)
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

if [ "$STREAMING_ON" = 1 ]; then
    if [ "$DAEMON_RUNNING" = true ]; then
        echo "Streaming: On (server running) | bash=$SCRIPTS_DIR/set_streaming.sh param1=off terminal=false refresh=true"
    else
        echo "Streaming: On (server stopped) | bash=$SCRIPTS_DIR/set_streaming.sh param1=on terminal=false refresh=true"
    fi
else
    echo "Streaming: Off | bash=$SCRIPTS_DIR/set_streaming.sh param1=on terminal=false refresh=true"
fi

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
