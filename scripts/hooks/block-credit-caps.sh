#!/usr/bin/env bash
# PreToolUse: block credit-sensitive model/cap edits unless CREDIT_OVERRIDE=1.
# Targets assignments / schema keys / truncateForTTS — not bare rg/grep reads.
set -euo pipefail

input=$(cat)
blob=$(echo "$input" | python3 -c '
import json,sys
d=json.load(sys.stdin)
ti=d.get("tool_input") or {}
parts=[d.get("tool_name",""), ti.get("command",""), ti.get("file_path",""), ti.get("path",""),
       ti.get("old_string",""), ti.get("new_string",""), ti.get("content","")]
print("\n".join(str(p) for p in parts if p))
' 2>/dev/null || true)

if echo "$blob" | grep -Eq 'CREDIT_OVERRIDE=1'; then
  exit 0
fi

# Allow read-only inspection of the names.
cmd=$(echo "$input" | python3 -c 'import json,sys; d=json.load(sys.stdin); print((d.get("tool_input") or {}).get("command") or "")' 2>/dev/null || true)
if [ -n "$cmd" ] && echo "$cmd" | grep -Eq '^(rg|grep|ag|git[[:space:]]+(grep|log|show|blame)|head|cat|less|bat|sed[[:space:]]+-n)\b'; then
  exit 0
fi

if echo "$blob" | grep -Eq '"gemini_model"|gemini_model[[:space:]]*:|elevenlabs_model_id|truncateForTTS[[:space:]]*\(|TTS_CHAR_CAP|FALLBACK_CHAR_CAP|GEMINI_INPUT_CAP'; then
  echo "Blocked: credit-sensitive edit (gemini_model / elevenlabs_model_id / truncateForTTS caps). Set CREDIT_OVERRIDE=1 to proceed." >&2
  exit 2
fi
exit 0
