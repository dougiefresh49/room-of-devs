#!/usr/bin/env bash
# PreToolUse: block a single Bash command that invokes enqueue_manual.sh more than once.
set -euo pipefail

input=$(cat)
cmd=$(echo "$input" | python3 -c '
import json,sys
d=json.load(sys.stdin)
if d.get("tool_name") != "Bash":
  raise SystemExit
print((d.get("tool_input") or {}).get("command") or "")
' 2>/dev/null || true)

[ -z "$cmd" ] && exit 0

# Count enqueue_manual.sh occurrences (path-tolerant).
count=$(echo "$cmd" | grep -oE 'enqueue_manual\.sh' | wc -l | tr -d ' ' || true)
count=${count:-0}
if [ "$count" -gt 1 ]; then
  echo "Blocked: synthesis-loop guard — enqueue_manual.sh appears ${count} times in one Bash command. One manual enqueue only." >&2
  exit 2
fi
exit 0
