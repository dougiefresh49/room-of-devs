#!/usr/bin/env bash
# PreToolUse: block Write/Edit targeting the live install (~/.cursor/tts/).
# Deny semantics: exit 2 + message on stderr.
set -euo pipefail

input=$(cat)
tool=$(echo "$input" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("tool_name",""))' 2>/dev/null || true)
path=$(echo "$input" | python3 -c '
import json,sys
d=json.load(sys.stdin)
ti=d.get("tool_input") or {}
print(ti.get("file_path") or ti.get("path") or "")
' 2>/dev/null || true)

case "$tool" in
  Write|Edit|MultiEdit) ;;
  *) exit 0 ;;
esac

# Expand ~ and compare against the install root.
expanded=$(python3 -c 'import os,sys; print(os.path.realpath(os.path.expanduser(sys.argv[1])))' "$path" 2>/dev/null || echo "$path")
install=$(python3 -c 'import os; print(os.path.realpath(os.path.expanduser("~/.cursor/tts")))')

case "$expanded" in
  "$install"|"$install"/*)
    echo "Edit in the repo, never the install — CLAUDE.md two-location gotcha" >&2
    exit 2
    ;;
esac
exit 0
