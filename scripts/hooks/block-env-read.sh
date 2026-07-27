#!/usr/bin/env bash
# PreToolUse: block reads of worktree .env unless LIVE_API_OK is in the command/input.
set -euo pipefail

input=$(cat)
blob=$(echo "$input" | python3 -c '
import json,sys
d=json.load(sys.stdin)
ti=d.get("tool_input") or {}
parts=[d.get("tool_name",""), ti.get("command",""), ti.get("file_path",""), ti.get("path","")]
print("\n".join(str(p) for p in parts if p))
' 2>/dev/null || true)

if echo "$blob" | grep -Eq 'LIVE_API_OK'; then
  exit 0
fi

# Allow the install-world .env (ops) but block repo/worktree .env reads.
# Match common Read/Bash patterns that touch a worktree .env.
if echo "$blob" | grep -Eq '(^|[/"'\''[:space:]])(\./)?\.env([/"'\''[:space:]]|$)|worktrees/.*/\.env|cursor-read-aloud.*/\.env'; then
  # Don't trip on the install path ~/.cursor/tts/.env
  if echo "$blob" | grep -Eq '\.cursor/tts/\.env'; then
    exit 0
  fi
  echo "Blocked: reading worktree .env (live API keys). Add LIVE_API_OK to the command if intentional." >&2
  exit 2
fi
exit 0
