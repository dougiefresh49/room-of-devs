#!/usr/bin/env bash
#
# notify_queued.sh — macOS notification after a queue file is written (if enabled in config).
#
# Supports "random_sfx" notification sound mode that picks a random ElevenLabs-generated
# sound effect from the cache.
#
# Usage: notify_queued.sh /absolute/path/to/queue/file.json
#
set -u

filepath="${1:-}"
if [ -z "$filepath" ] || [ ! -f "$filepath" ]; then
  exit 0
fi

TTS_DIR="${HOME}/.cursor/tts"
CONFIG="${TTS_DIR}/config.json"
LOG_FILE="${TTS_DIR}/logs/hook.log"

logn() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] notify: $*" >>"$LOG_FILE" 2>/dev/null || true
}

# Announce chime runs BEFORE (and independent of) the notifications gate — the
# helper self-gates on announce mode. Announce mode without announces would be
# no mode at all, so it must not ride on notifications_enabled.
ANNOUNCE_SH="${TTS_DIR}/scripts/announce.sh"
if [ -f "$ANNOUNCE_SH" ]; then
  bash "$ANNOUNCE_SH" "$filepath" 2>/dev/null || true
fi

enabled=$(python3 - "$CONFIG" <<'PY'
import json, sys

path = sys.argv[1]
try:
    with open(path, encoding="utf-8") as f:
        c = json.load(f)
    print("1" if c.get("notifications_enabled") is True else "0")
except (OSError, json.JSONDecodeError, TypeError):
    print("0")
PY
)

if [ "$enabled" != "1" ]; then
  exit 0
fi

logn "preparing notification for $(basename "$filepath")"

python3 - "$filepath" "$CONFIG" "$LOG_FILE" <<'PY'
import json
import os
import plistlib
import shlex
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

filepath, config_path, log_path = sys.argv[1], sys.argv[2], sys.argv[3]

TTS_DIR = os.path.expanduser("~/.cursor/tts")
PLAY = os.path.join(TTS_DIR, "scripts", "play_node.sh")
GRANT = os.path.join(TTS_DIR, "scripts", "grant_floor.sh")
RANDOM_SFX = os.path.join(TTS_DIR, "scripts", "random_sfx.sh")


def log(msg: str) -> None:
    try:
        with open(log_path, "a", encoding="utf-8") as fh:
            ts = datetime.now().strftime("[%Y-%m-%d %H:%M:%S] ")
            fh.write(ts + "notify: " + msg + "\n")
    except OSError:
        pass


# ── Load config ──────────────────────────────────────────────────
try:
    with open(config_path, encoding="utf-8") as f:
        config = json.load(f)
except (OSError, json.JSONDecodeError):
    config = {}


# Mirror config.ts effectivePlaybackMode(): explicit key wins, else legacy map.
def effective_mode(cfg: dict) -> str:
    if "playback_mode" in cfg:
        return cfg.get("playback_mode") or "auto"
    return "auto" if cfg.get("streaming_enabled") else "silent"


announce_mode = effective_mode(config) == "announce"

# ── Load queue item ──────────────────────────────────────────────
try:
    with open(filepath, encoding="utf-8") as f:
        d = json.load(f)
except (OSError, json.JSONDecodeError):
    d = {}

# ── Clean text for preview ───────────────────────────────────────
scripts_dir = os.path.join(TTS_DIR, "scripts")
if scripts_dir not in sys.path:
    sys.path.insert(0, scripts_dir)

try:
    from clean_text import clean
except ImportError:
    clean = None

tt = (d.get("thread_title") or "").strip().replace("\n", " ") or "Queued message"
raw = (d.get("text") or "").strip()
if raw and clean is not None:
    try:
        preview = clean(raw)
    except Exception:
        preview = raw
else:
    preview = raw

preview = preview.replace("\n", " ").strip()
if len(preview) > 150:
    preview = preview[:147] + "..."
if not preview:
    preview = "New reply queued."
if len(tt) > 60:
    tt = tt[:57] + "..."


# ── Notification image (optional config key) ─────────────────────
icon_uri = ""
icon_cfg = config.get("notification_icon", "")
if icon_cfg:
    ip = Path(os.path.expanduser(str(icon_cfg)))
    if ip.is_file():
        icon_uri = ip.resolve().as_uri()
    elif icon_cfg.strip():
        log(f"notification_icon not found, skipping image: {ip}")

notification_sound = (config.get("notification_sound") or "default").strip() or "default"


def sound_is_silent(name: str) -> bool:
    return name.strip().lower() == "none"


def sound_is_random_sfx(name: str) -> bool:
    return name.strip().lower() == "random_sfx"


# ── Handle random_sfx: play a random sound effect ────────────────
# In announce mode the cached announce phrase (played by announce.sh) replaces
# the notification's sound entirely — suppress the banner SFX here.
sfx_path = None
if sound_is_random_sfx(notification_sound) and not announce_mode:
    try:
        r = subprocess.run(
            ["bash", RANDOM_SFX],
            capture_output=True, text=True, timeout=5
        )
        if r.returncode == 0 and r.stdout.strip():
            sfx_path = r.stdout.strip()
            log(f"random sfx: {os.path.basename(sfx_path)}")
    except Exception as e:
        log(f"random_sfx failed: {e}")


# ── Resolve terminal-notifier binary ─────────────────────────────
def exe_from_app_bundle(bundle: Path):
    if not bundle.is_dir():
        return None
    plist_path = bundle / "Contents" / "Info.plist"
    macos_bin = bundle / "Contents" / "MacOS"
    if not plist_path.is_file():
        return None
    try:
        with open(plist_path, "rb") as fp:
            info = plistlib.load(fp)
        exe_name = info.get("CFBundleExecutable", "terminal-notifier")
    except Exception:
        exe_name = "terminal-notifier"
    candidate = macos_bin / exe_name
    if candidate.is_file() and os.access(candidate, os.X_OK):
        return str(candidate)
    return None


def resolve_terminal_notifier(cfg: dict):
    custom = (cfg.get("terminal_notifier_app") or "").strip()
    bundles = []
    if custom:
        bundles.append(Path(os.path.expanduser(custom)))
    home_app = Path.home() / "Applications" / "CursorReadAloudNotifier.app"
    try:
        custom_res = Path(os.path.expanduser(custom)).resolve() if custom else None
    except OSError:
        custom_res = None
    try:
        home_res = home_app.resolve()
    except OSError:
        home_res = home_app
    if custom_res != home_res:
        bundles.append(home_app)

    seen = set()
    for bundle in bundles:
        try:
            key = bundle.resolve()
        except OSError:
            key = bundle
        if key in seen:
            continue
        seen.add(key)
        exe = exe_from_app_bundle(bundle)
        if exe:
            return exe

    if custom:
        log(f"terminal_notifier_app not usable (falling back to stock): {custom}")

    stock = "/Applications/terminal-notifier.app/Contents/MacOS/terminal-notifier"
    if os.path.isfile(stock) and os.access(stock, os.X_OK):
        return stock
    return shutil.which("terminal-notifier")


tn_bin = resolve_terminal_notifier(config)
if tn_bin:
    log(f"notifier binary: {tn_bin}")

if tn_bin:
    # In announce mode every surface funnels through the grant path (Decision 8):
    # clicking the banner grants that session's floor instead of playing directly.
    sid = (d.get("conversation_id") or "").strip()
    if announce_mode and sid:
        execute = shlex.quote(GRANT) + " " + shlex.quote(sid)
    else:
        execute = shlex.quote(PLAY) + " " + shlex.quote(filepath)
    nid = os.path.splitext(os.path.basename(filepath))[0]

    cmd = [tn_bin, "-group", nid]

    # For random_sfx / announce mode, suppress the built-in notification sound
    # (announce mode's chime is the announce phrase; random_sfx plays via afplay).
    if (
        sound_is_random_sfx(notification_sound)
        or sound_is_silent(notification_sound)
        or announce_mode
    ):
        pass  # no -sound flag = silent notification
    else:
        cmd += ["-sound", notification_sound]

    cmd += [
        "-ignoreDnD",
        "-title", tt,
        "-message", preview,
        "-execute", execute,
    ]
    if icon_uri:
        cmd += ["-contentImage", icon_uri]

    sender = (config.get("notification_sender") or "").strip()
    if sender:
        cmd += ["-sender", sender]

    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode == 0:
        log(f"terminal-notifier ok {os.path.basename(filepath)}")
    else:
        err = (r.stderr or r.stdout or "").strip()
        log(f"terminal-notifier exit {r.returncode}: {err}; falling back to osascript")
        tn_bin = None
    if r.stderr and r.stderr.strip():
        log(f"terminal-notifier stderr: {r.stderr.strip()}")

# ── Fallback: osascript ──────────────────────────────────────────
if not tn_bin:
    def esc(s: str) -> str:
        return s.replace("\\", "\\\\").replace('"', '\\"')

    osa_sound = notification_sound
    if osa_sound.lower() == "default":
        osa_sound = "Glass"

    script = (
        f'display notification "{esc(preview)}" '
        f'with title "{esc(tt)}"'
    )
    if (
        not sound_is_silent(notification_sound)
        and not sound_is_random_sfx(notification_sound)
        and not announce_mode
    ):
        script += f' sound name "{esc(osa_sound)}"'
    r = subprocess.run(["osascript", "-e", script], capture_output=True, text=True)
    if r.returncode == 0:
        log(f"notification sent (osascript) {os.path.basename(filepath)}")
    else:
        err = (r.stderr or r.stdout or "").strip()
        log(f"osascript failed (exit {r.returncode}): {err}")

# ── Play random sfx separately ───────────────────────────────────
if sfx_path and os.path.isfile(sfx_path):
    try:
        subprocess.Popen(
            ["afplay", sfx_path],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        log(f"playing sfx: {os.path.basename(sfx_path)}")
    except Exception as e:
        log(f"afplay sfx failed: {e}")
PY

exit 0
