#!/usr/bin/env bash
#
# set_notifications.sh — Toggle enqueue notifications in config.json.
#
# Usage: set_notifications.sh on|off|toggle
#
set -euo pipefail

# Q-14: honor exported TTS_DIR (shared resolver).
# shellcheck disable=SC1091
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tts-dir.sh"
CONFIG="$TTS_DIR/config.json"

MODE="${1:-toggle}"

case "$MODE" in
  on|1|true|TRUE|yes)
    VAL=true
    ;;
  off|0|false|FALSE|no)
    VAL=false
    ;;
  toggle)
    cur=$(python3 - "$CONFIG" <<'PY'
import json, sys

path = sys.argv[1]
try:
    with open(path, encoding="utf-8") as f:
        c = json.load(f)
    print("true" if c.get("notifications_enabled") is True else "false")
except (OSError, json.JSONDecodeError):
    print("false")
PY
)
    if [ "$cur" = "true" ]; then
      VAL=false
    else
      VAL=true
    fi
    ;;
  *)
    echo "Usage: $0 on|off|toggle" >&2
    exit 1
    ;;
esac

if [ ! -f "$CONFIG" ]; then
  echo '{}' > "$CONFIG"
fi

py_bool="false"
[ "$VAL" = true ] && py_bool="true"

python3 - "$CONFIG" "$py_bool" <<'PY'
import json
import sys

path, val_s = sys.argv[1], sys.argv[2]
val = val_s == "true"
with open(path, encoding="utf-8") as f:
    config = json.load(f)
config["notifications_enabled"] = val
with open(path, "w", encoding="utf-8") as f:
    json.dump(config, f, indent=2)
    f.write("\n")
PY
