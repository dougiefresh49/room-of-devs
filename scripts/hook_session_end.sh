#!/usr/bin/env bash
#
# hook_session_end.sh — Claude Code SessionEnd hook.
# Cleans room state for a finished session. Skips clear/resume (lineage rekey).
# Budget ~1.5s — shell + python only, no Node.
#
set -euo pipefail

# Q-14: honor exported TTS_DIR (shared resolver).
# shellcheck disable=SC1091
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tts-dir.sh"
STATE_DIR="$TTS_DIR/state"
SESSION_VOICES="$TTS_DIR/session_voices.json"
TEAM_MAP="$TTS_DIR/team_map.json"
LOG_FILE="$TTS_DIR/logs/hook.log"

mkdir -p "$(dirname "$LOG_FILE")"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] session_end: $*" >> "$LOG_FILE" 2>/dev/null || true; }

PAYLOAD="$(cat)"
SESSION_ID=""
REASON=""
eval "$(
  PAYLOAD="$PAYLOAD" python3 - <<'PY'
import json, os, shlex
try:
    data = json.loads(os.environ.get("PAYLOAD", "") or "{}")
except json.JSONDecodeError:
    data = {}
sid = data.get("session_id") or data.get("sessionId") or ""
reason = data.get("reason") or ""
print(f"SESSION_ID={shlex.quote(str(sid))}")
print(f"REASON={shlex.quote(str(reason))}")
PY
)"

if [ -z "$SESSION_ID" ]; then
    log "No session_id in payload — skip"
    exit 0
fi

# clear/resume rotate sessionId in-place; lineage reconcile owns that path.
if [ "$REASON" = "clear" ] || [ "$REASON" = "resume" ]; then
    log "Skip cleanup for reason=$REASON ($SESSION_ID)"
    exit 0
fi

# SDK-harness sessions (T3 Code): the app tears down the backing process on
# idle while the thread stays open/resumable — keep the room card (the
# daemon's reaper prunes it after the sdk inactivity TTL). Exception: T3's
# Settle button also stops the session; a settled/archived/deleted thread in
# T3's local store means the owner is done → clean now. (Settle emits no
# harness-visible signal — reason=other either way — so we read T3's db.)
if [ -f "$STATE_DIR/$SESSION_ID.json" ]; then
    VERDICT=$(STATE_FILE="$STATE_DIR/$SESSION_ID.json" SESSION_ID="$SESSION_ID" python3 - <<'PY' 2>/dev/null || echo cleanup
import json, os, sqlite3

try:
    sdk = json.load(open(os.environ["STATE_FILE"], encoding="utf-8")).get("sdk") is True
except Exception:
    sdk = False
if not sdk:
    print("cleanup")
    raise SystemExit(0)

db = os.path.expanduser("~/.t3/userdata/state.sqlite")
if os.path.exists(db):
    try:
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=1)
        rows = con.execute(
            "SELECT t.settled_override, t.archived_at, t.deleted_at"
            " FROM provider_session_runtime r"
            " JOIN projection_threads t ON t.thread_id = r.thread_id"
            " WHERE json_extract(r.resume_cursor_json,'$.resume') = ?",
            (os.environ["SESSION_ID"],),
        ).fetchall()
        con.close()
        if rows and all(
            so == "settled" or arch is not None or dele is not None
            for so, arch, dele in rows
        ):
            print("settled")
            raise SystemExit(0)
    except sqlite3.Error:
        pass
print("keep")
PY
)
    if [ "$VERDICT" = "keep" ]; then
        log "Kept sdk-harness card for $SESSION_ID (reason=$REASON — thread resumable)"
        exit 0
    fi
    if [ "$VERDICT" = "settled" ]; then
        log "T3 thread settled — cleaning card for $SESSION_ID (reason=$REASON)"
    fi
fi

STATE_DIR="$STATE_DIR" SESSION_VOICES="$SESSION_VOICES" TEAM_MAP="$TEAM_MAP" \
SESSION_ID="$SESSION_ID" python3 - <<'PY'
import json, os, subprocess

sid = os.environ["SESSION_ID"]
state_path = os.path.join(os.environ["STATE_DIR"], f"{sid}.json")
voices_path = os.environ["SESSION_VOICES"]
team_path = os.environ["TEAM_MAP"]

def atomic_write(path, data):
    tmp = f"{path}.tmp.{os.getpid()}"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2)
        fh.write("\n")
    os.replace(tmp, path)

# Drop room card
try:
    os.unlink(state_path)
except FileNotFoundError:
    pass
except OSError:
    pass

# Drop voice binding
if os.path.isfile(voices_path):
    try:
        with open(voices_path, encoding="utf-8") as fh:
            voices = json.load(fh)
        if isinstance(voices, dict) and sid in voices:
            del voices[sid]
            atomic_write(voices_path, voices)
    except (OSError, json.JSONDecodeError):
        pass

# Drop team_map entry only if its tmux session is gone
if os.path.isfile(team_path):
    try:
        with open(team_path, encoding="utf-8") as fh:
            team = json.load(fh)
        if not isinstance(team, dict):
            raise SystemExit(0)
        changed = False
        for persona, entry in list(team.items()):
            if not isinstance(entry, dict) or entry.get("sessionId") != sid:
                continue
            tmux = entry.get("tmux") or ""
            alive = False
            if tmux:
                r = subprocess.run(
                    ["tmux", "has-session", "-t", f"={tmux}"],
                    capture_output=True,
                )
                alive = r.returncode == 0
            if not alive:
                del team[persona]
                changed = True
        if changed:
            atomic_write(team_path, team)
    except (OSError, json.JSONDecodeError):
        pass
PY

log "Cleaned session $SESSION_ID (reason=$REASON)"
exit 0
