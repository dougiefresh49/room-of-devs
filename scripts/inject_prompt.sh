#!/usr/bin/env bash
#
# inject_prompt.sh — Send a prompt into a team-launched tmux session.
#
# Usage:
#   inject_prompt.sh [--now] <persona|sessionId> "<message>"
#
# By default the send is ARMED, not immediate: it writes a pending-inject.json
# undo record, plays a short local tick, and only actually types the prompt into
# tmux after a 4-second window (during which `cancel_inject.sh` or any stop can
# abort it). `--now` bypasses the window and sends immediately — used by the
# commit subshell itself, and available to power users who want no undo delay.
#
set -euo pipefail

TTS_DIR="${TTS_DIR:-$HOME/.cursor/tts}"
TEAM_MAP="$TTS_DIR/team_map.json"
PENDING_DIR="$TTS_DIR/ptt"
PENDING="$PENDING_DIR/pending-inject.json"

NOW=0
if [ "${1:-}" = "--now" ]; then
    NOW=1
    shift
fi

TARGET="${1:-}"
MSG="${2:-}"

if [ -z "$TARGET" ] || [ -z "$MSG" ]; then
    echo "Usage: inject_prompt.sh [--now] <persona|sessionId> \"<message>\"" >&2
    exit 1
fi

# Absolute path to self, so the deferred commit subshell can re-invoke us with
# --now regardless of how we were called.
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"

# Resolve persona/sessionId → tmux target. Fail fast (exit 3) BEFORE arming so
# voice.ts can speak a "can't reach them" error while the caller is still
# listening — the undo window only opens for reachable sessions.
TMUX_TARGET="$(
    TEAM_MAP="$TEAM_MAP" TARGET="$TARGET" python3 - <<'PY'
import json
import os

path = os.environ["TEAM_MAP"]
target = os.environ["TARGET"]

if not os.path.isfile(path):
    raise SystemExit(1)

try:
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
except (OSError, json.JSONDecodeError):
    raise SystemExit(1)

if not isinstance(data, dict):
    raise SystemExit(1)

if target in data:
    entry = data.get(target) or {}
    tmux = entry.get("tmux")
    if tmux:
        print(tmux)
        raise SystemExit(0)

for entry in data.values():
    if not isinstance(entry, dict):
        continue
    if entry.get("sessionId") == target:
        tmux = entry.get("tmux")
        if tmux:
            print(tmux)
            raise SystemExit(0)

raise SystemExit(1)
PY
)" || exit 3

if ! tmux has-session -t "$TMUX_TARGET" 2>/dev/null; then
    exit 3
fi

MESSAGE="$(printf '%s' "$MSG" | tr -s '[:space:]' ' ')"

send_now() {
    tmux send-keys -t "$TMUX_TARGET" -l -- "$MESSAGE"
    sleep 0.3
    tmux send-keys -t "$TMUX_TARGET" Enter
}

if [ "$NOW" -eq 1 ]; then
    send_now
    exit 0
fi

# ── Arm: stash the pending send, tick, and defer the real send by 4s ──
mkdir -p "$PENDING_DIR"

# Unique arming token — latest write wins; the commit only fires if the pending
# record still carries the token we wrote.
ARMED_AT="$(python3 -c 'import time; print(int(time.time()*1000))')-$$-${RANDOM:-0}"

write_pending() {
    TARGET="$TARGET" MSG="$MSG" ARMED_AT="$ARMED_AT" PENDING="$PENDING" python3 - <<'PY'
import json, os
data = {
    "target": os.environ["TARGET"],
    "message": os.environ["MSG"],
    "armedAt": os.environ["ARMED_AT"],
}
p = os.environ["PENDING"]
tmp = f"{p}.tmp.{os.getpid()}"
with open(tmp, "w", encoding="utf-8") as f:
    json.dump(data, f)
os.replace(tmp, p)
PY
}

pending_armed_at() {
    PENDING="$PENDING" python3 - <<'PY'
import json, os
try:
    with open(os.environ["PENDING"], encoding="utf-8") as f:
        print(json.load(f).get("armedAt", ""))
except Exception:
    print("")
PY
}

# Subtle local tick — shortest cached SFX (smallest file ≈ shortest clip).
play_tick() {
    local sfx
    sfx="$(TTS_DIR="$TTS_DIR" python3 - <<'PY'
import os, glob
d = os.path.join(os.environ["TTS_DIR"], "sounds", "default")
files = [f for f in glob.glob(os.path.join(d, "*.mp3")) if os.path.isfile(f)]
if files:
    print(min(files, key=os.path.getsize))
PY
)" || return 0
    [ -n "$sfx" ] && afplay "$sfx" >/dev/null 2>&1 &
}

write_pending
play_tick

# Defer: if still our pending record after the window, send for real. Re-invoke
# self with --now so the target/session is re-resolved fresh at send time.
(
    sleep 4
    if [ "$(pending_armed_at)" = "$ARMED_AT" ]; then
        "$SELF" --now "$TARGET" "$MSG" || true
        # Clear the record only if it is still ours (never clobber a newer arm).
        [ "$(pending_armed_at)" = "$ARMED_AT" ] && rm -f "$PENDING"
    fi
) &
disown 2>/dev/null || true

exit 0
