#!/usr/bin/env bash
#
# inject_prompt.sh — Send a prompt into a team-launched tmux session.
#
# Usage: inject_prompt.sh <persona|sessionId> "<message>"
#
set -euo pipefail

TTS_DIR="${TTS_DIR:-$HOME/.cursor/tts}"
TEAM_MAP="$TTS_DIR/team_map.json"

TARGET="${1:-}"
MSG="${2:-}"

if [ -z "$TARGET" ] || [ -z "$MSG" ]; then
    echo "Usage: inject_prompt.sh <persona|sessionId> \"<message>\"" >&2
    exit 1
fi

TMUX_TARGET="$(
    TEAM_MAP="$TEAM_MAP" TARGET="$TARGET" python3 - <<'PY'
import json
import os
import sys

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

tmux send-keys -t "$TMUX_TARGET" -l -- "$MESSAGE"
sleep 0.3
tmux send-keys -t "$TMUX_TARGET" Enter
