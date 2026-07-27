#!/usr/bin/env bash
#
# team.sh — Launch a persona'd Claude Code session in tmux and bind team_map.json.
#
# Usage: team.sh <persona> [project-dir] [--resume <sessionId>]
#
set -euo pipefail

# Q-14: honor exported TTS_DIR (shared resolver).
# shellcheck disable=SC1091
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tts-dir.sh"
SCRIPTS_DIR="$TTS_DIR/scripts"
TEAM_MAP="$TTS_DIR/team_map.json"
SESSIONS_DIR="$HOME/.claude/sessions"
LOG_FILE="$TTS_DIR/logs/hook.log"
CHARACTERS_JSON="$TTS_DIR/characters.json"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] team: $*" >> "$LOG_FILE" 2>/dev/null || true; }

PERSONA="${1:-}"
shift || true
PROJECT_DIR="$PWD"
RESUME_ID=""

while [ $# -gt 0 ]; do
    case "$1" in
        --resume)
            RESUME_ID="${2:-}"
            if [ -z "$RESUME_ID" ]; then
                echo "Usage: team.sh <persona> [project-dir] [--resume <sessionId>]" >&2
                exit 1
            fi
            shift 2
            ;;
        *)
            PROJECT_DIR="$1"
            shift
            ;;
    esac
done

if [ -z "$PERSONA" ]; then
    echo "Usage: team.sh <persona> [project-dir] [--resume <sessionId>]" >&2
    exit 1
fi

# PERSONA becomes a tmux session name (and a team_map key). Anything outside
# this set is either a typo or an attempt to smuggle tmux/shell syntax through.
case "$PERSONA" in
    *[!A-Za-z0-9_-]*|"")
        echo "invalid persona: $PERSONA (expected [A-Za-z0-9_-]+)" >&2
        exit 1
        ;;
esac

if ! command -v tmux >/dev/null 2>&1; then
    echo "tmux not found — install with: brew install tmux" >&2
    exit 1
fi

TMUX_NAME="cr-${PERSONA}"

mkdir -p "$(dirname "$LOG_FILE")" "$(dirname "$TEAM_MAP")"

# Preflight: cr-<persona> is global (one per machine). If a dead pane we own
# is left behind, reclaim it; never kill a live unexpected session.
if tmux has-session -t "=$TMUX_NAME" 2>/dev/null; then
    PANE_DEAD="$(tmux list-panes -t "=$TMUX_NAME" -F '#{pane_dead}' 2>/dev/null | head -1 || true)"
    OWNED="$(
        TEAM_MAP="$TEAM_MAP" PERSONA="$PERSONA" TMUX_NAME="$TMUX_NAME" python3 - <<'PY'
import json, os
path = os.environ["TEAM_MAP"]
persona = os.environ["PERSONA"]
tmux_name = os.environ["TMUX_NAME"]
if not os.path.isfile(path):
    raise SystemExit(1)
try:
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
except (OSError, json.JSONDecodeError):
    raise SystemExit(1)
entry = data.get(persona) if isinstance(data, dict) else None
if isinstance(entry, dict) and entry.get("tmux") == tmux_name:
    print("yes")
    raise SystemExit(0)
raise SystemExit(1)
PY
    )" || OWNED=""
    if [ "$PANE_DEAD" = "1" ] && [ "$OWNED" = "yes" ]; then
        log "Reclaiming dead tmux session $TMUX_NAME"
        tmux kill-session -t "=$TMUX_NAME" 2>/dev/null || true
    else
        echo "tmux session $TMUX_NAME already exists (live or not owned) — refuse spawn" >&2
        log "Refuse spawn: $TMUX_NAME already exists (pane_dead=$PANE_DEAD owned=$OWNED)"
        exit 2
    fi
fi

# Snapshot session filenames before launch.
BEFORE_SNAPSHOT="$(
    SESSIONS_DIR="$SESSIONS_DIR" python3 - <<'PY'
import glob
import os

sessions_dir = os.environ["SESSIONS_DIR"]
paths = glob.glob(os.path.join(sessions_dir, "*.json"))
for path in sorted(paths):
    print(os.path.basename(path))
PY
)"

# Launch flags — picker checkboxes arrive as env:
#   CR_SKIP_PERMISSIONS=1 → --dangerously-skip-permissions (opt-IN; default OFF,
#                           so a missing/garbled flag can't grant free rein)
#   CR_REMOTE_CONTROL=0   → no Claude-mobile-app remote control channel
#   CR_MODEL=<alias>      → pass --model (empty/unset = CLI default)
CLAUDE_ARGS=()
if [ "${CR_SKIP_PERMISSIONS:-0}" = "1" ]; then
    CLAUDE_ARGS+=(--dangerously-skip-permissions)
fi
if [ "${CR_REMOTE_CONTROL:-1}" = "1" ]; then
    CLAUDE_ARGS+=(--remote-control "$TMUX_NAME")
fi
if [ -n "${CR_MODEL:-}" ]; then
    CLAUDE_ARGS+=(--model "$CR_MODEL")
fi
# The tmux server inherits our cwd at first launch, and ours is the synced
# tts-server dir — which setup.sh rm-rf's on every re-install, leaving the
# server in an unlinked cwd where Bun-based claude dies on getcwd (ENOENT).
# Start from HOME so the server is born somewhere that can't be deleted.
cd "$HOME"

if [ -n "$RESUME_ID" ]; then
    log "Launching $TMUX_NAME in $PROJECT_DIR (resume $RESUME_ID; flags: ${CLAUDE_ARGS[*]:-none})"
    tmux new-session -d -s "$TMUX_NAME" -c "$PROJECT_DIR" \
        claude ${CLAUDE_ARGS[@]+"${CLAUDE_ARGS[@]}"} --resume "$RESUME_ID"
else
    log "Launching $TMUX_NAME in $PROJECT_DIR (flags: ${CLAUDE_ARGS[*]:-none})"
    tmux new-session -d -s "$TMUX_NAME" -c "$PROJECT_DIR" \
        claude ${CLAUDE_ARGS[@]+"${CLAUDE_ARGS[@]}"}
fi

tmux set-option -t "$TMUX_NAME" mouse on 2>/dev/null || true

SESSION_ID=""
# 90 attempts (~90s): fresh claude sessions can sit on first-run dialogs
# before registering their session file. At ~15s, nudge once with Enter —
# a no-op on an empty prompt, but it dismisses blocking first-run dialogs.
for ATTEMPT in $(seq 1 90); do
    if [ "$ATTEMPT" -eq 15 ]; then
        log "No session file yet — sending Enter to dismiss a possible first-run dialog"
        tmux send-keys -t "$TMUX_NAME" Enter 2>/dev/null || true
    fi
    SESSION_ID="$(
        SESSIONS_DIR="$SESSIONS_DIR" BEFORE_SNAPSHOT="$BEFORE_SNAPSHOT" python3 - <<'PY'
import glob
import json
import os
import sys

sessions_dir = os.environ["SESSIONS_DIR"]
before = set(os.environ.get("BEFORE_SNAPSHOT", "").splitlines())

for path in sorted(glob.glob(os.path.join(sessions_dir, "*.json"))):
    base = os.path.basename(path)
    if base in before:
        continue
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        sid = data.get("sessionId")
        if sid:
            print(sid)
            raise SystemExit(0)
    except (OSError, json.JSONDecodeError):
        continue

raise SystemExit(1)
PY
    )" && break
    SESSION_ID=""
    sleep 1
done

if [ -z "$SESSION_ID" ]; then
    # Grab the pane's last lines before killing it — a dead shell here usually
    # means the tmux server can't access PROJECT_DIR (macOS privacy/TCC, e.g.
    # Google Drive / Documents). The stderr tail surfaces as a room notice.
    PANE_TAIL="$(tmux capture-pane -t "$TMUX_NAME" -p 2>/dev/null | grep -v '^$' | tail -2 | tr '\n' ' ' || true)"
    tmux kill-session -t "$TMUX_NAME" 2>/dev/null || true
    log "Timeout binding $PERSONA — killed $TMUX_NAME (pane: ${PANE_TAIL:-empty})"
    echo "no session appeared for ${PERSONA}${PANE_TAIL:+ — ${PANE_TAIL}}" >&2
    exit 1
fi

TEAM_MAP="$TEAM_MAP" PERSONA="$PERSONA" TMUX_NAME="$TMUX_NAME" SESSION_ID="$SESSION_ID" python3 - <<'PY'
import json
import os
from datetime import datetime, timezone

path = os.environ["TEAM_MAP"]
persona = os.environ["PERSONA"]
tmux_name = os.environ["TMUX_NAME"]
session_id = os.environ["SESSION_ID"]

data = {}
if os.path.isfile(path):
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        if not isinstance(data, dict):
            data = {}
    except (OSError, json.JSONDecodeError):
        data = {}

data[persona] = {
    "tmux": tmux_name,
    "sessionId": session_id,
    "createdAt": datetime.now(timezone.utc).isoformat(),
}

tmp = f"{path}.tmp.{os.getpid()}"
with open(tmp, "w", encoding="utf-8") as fh:
    json.dump(data, fh, indent=2)
    fh.write("\n")
os.replace(tmp, path)
PY

log "Bound $PERSONA → $SESSION_ID ($TMUX_NAME)"

VOICE_ID="$(
    CHARACTERS_JSON="$CHARACTERS_JSON" PERSONA="$PERSONA" python3 - <<'PY'
import json
import os
import sys

path = os.environ["CHARACTERS_JSON"]
persona = os.environ["PERSONA"].lower()

if not os.path.isfile(path):
    raise SystemExit(1)

try:
    with open(path, encoding="utf-8") as fh:
        chars = json.load(fh)
except (OSError, json.JSONDecodeError):
    raise SystemExit(1)

for voice_id, entry in chars.items():
    if not isinstance(entry, dict):
        continue
    name = entry.get("name", "")
    if name.lower() == persona:
        print(voice_id)
        raise SystemExit(0)

raise SystemExit(1)
PY
)" || VOICE_ID=""

if [ -n "$VOICE_ID" ]; then
    "$SCRIPTS_DIR/set_session_voice.sh" "$SESSION_ID" "$VOICE_ID"
    log "Assigned voice $VOICE_ID to $SESSION_ID"
fi

# Seed the room card now — the session's first hook is otherwise the only
# thing that creates a state file, so a freshly spawned agent is invisible
# in the panel ("launching…" then nothing) until someone talks to it.
STATE_DIR="$TTS_DIR/state"
mkdir -p "$STATE_DIR"
python3 - "$STATE_DIR/$SESSION_ID.json" "$SESSION_ID" "$(basename "$PROJECT_DIR")" <<'PY'
import json, sys, datetime, os
path, sid, name = sys.argv[1:4]
if not os.path.exists(path):
    tmp = f"{path}.tmp.{os.getpid()}"
    with open(tmp, "w") as f:
        json.dump({"sessionId": sid, "name": name, "state": "idle",
                   "raisedAt": None,
                   "updatedAt": datetime.datetime.now(datetime.timezone.utc)
                       .isoformat().replace("+00:00", "Z")}, f)
    os.replace(tmp, path)
PY
log "Seeded room card for $SESSION_ID ($(basename "$PROJECT_DIR"))"

echo "$TMUX_NAME"
echo "$SESSION_ID"
