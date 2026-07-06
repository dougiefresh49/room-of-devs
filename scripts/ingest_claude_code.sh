#!/usr/bin/env bash
#
# ingest_claude_code.sh — Claude Code "Stop" hook script.
# Reads the hook payload from stdin, extracts the latest assistant response
# from the transcript JSONL, and queues it for TTS playback.
#
set -euo pipefail

TTS_DIR="$HOME/.cursor/tts"
QUEUE_DIR="$TTS_DIR/queue"
LOG_FILE="$TTS_DIR/logs/hook.log"

mkdir -p "$QUEUE_DIR" "$(dirname "$LOG_FILE")"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] ingest_cc: $*" >> "$LOG_FILE"; }

LISTENING_FLAG="$TTS_DIR/listening.enabled"
if [ -f "$LISTENING_FLAG" ]; then
    case "$(tr -d ' \n' < "$LISTENING_FLAG")" in
        0|false|FALSE|off)
            log "Listening paused — skipping queue"
            exit 0
            ;;
    esac
fi

# Read the hook payload from stdin and save to a temp file for Python
PAYLOAD_FILE=$(mktemp /tmp/cc-hook-payload.XXXXXX)
cat > "$PAYLOAD_FILE"

# Wait for the transcript to finish flushing the final assistant message
sleep 1

# The Python block prints the exact queue file path it wrote (or nothing)
QUEUED_FILE=$(python3 - "$TTS_DIR" "$LOG_FILE" "$PAYLOAD_FILE" <<'PY'
import json
import hashlib
import os
import sys
from datetime import datetime

tts_dir = sys.argv[1]
log_path = sys.argv[2]
payload_file = sys.argv[3]
queue_dir = os.path.join(tts_dir, "queue")

def log(msg):
    try:
        with open(log_path, "a", encoding="utf-8") as f:
            ts = datetime.now().strftime("[%Y-%m-%d %H:%M:%S]")
            f.write(f"{ts} ingest_cc: {msg}\n")
    except OSError:
        pass

try:
    with open(payload_file, encoding="utf-8") as f:
        payload_raw = f.read().strip()
except OSError:
    log("Could not read payload file")
    sys.exit(0)

if not payload_raw:
    log("Empty payload from Claude Code hook")
    sys.exit(0)

try:
    payload = json.loads(payload_raw)
except json.JSONDecodeError as e:
    log(f"Invalid JSON from hook: {e}")
    sys.exit(0)

transcript_path = payload.get("transcript_path", "")
session_id = payload.get("session_id", "unknown")

if not transcript_path or not os.path.isfile(transcript_path):
    log(f"No transcript file: {transcript_path}")
    sys.exit(0)

# Read the transcript and find the last assistant message with text
text = ""
try:
    with open(transcript_path, encoding="utf-8") as f:
        lines = f.readlines()

    for line in reversed(lines):
        line = line.strip()
        if not line:
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue

        if entry.get("type") != "assistant":
            continue

        content = entry.get("message", {}).get("content", [])
        texts = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                t = block.get("text", "").strip()
                if t:
                    texts.append(t)
            elif isinstance(block, str) and block.strip():
                texts.append(block.strip())

        if texts:
            text = "\n\n".join(texts)
            break
except Exception as e:
    log(f"Error reading transcript: {e}")
    sys.exit(0)

if not text:
    log("No assistant text found in transcript")
    sys.exit(0)

# Dedup: skip if we already queued this exact response
text_hash = hashlib.md5(text.encode()).hexdigest()[:12]
dedup_file = os.path.join(tts_dir, ".last_cc_hash")
try:
    if os.path.isfile(dedup_file):
        with open(dedup_file) as f:
            last_hash = f.read().strip()
        if last_hash == text_hash:
            log("Duplicate response — skipping")
            sys.exit(0)
except OSError:
    pass

try:
    with open(dedup_file, "w") as f:
        f.write(text_hash)
except OSError:
    pass

# Write queue file
now = datetime.now().timestamp()
epoch = int(now)
# Millisecond suffix avoids same-second filename collisions (matches ingest.ts).
ms = int(now * 1000) % 1000
short_session = session_id[:12] if session_id else "unknown"
filename = f"{epoch}-{ms:03d}-cc-{short_session}.json"
filepath = os.path.join(queue_dir, filename)

session_name = "Claude Code"
sessions_dir = os.path.expanduser("~/.claude/sessions")
if os.path.isdir(sessions_dir):
    try:
        for fname in os.listdir(sessions_dir):
            if not fname.endswith(".json"):
                continue
            spath = os.path.join(sessions_dir, fname)
            try:
                with open(spath, encoding="utf-8") as sf:
                    sess = json.loads(sf.read())
                if sess.get("sessionId") == session_id and sess.get("name"):
                    session_name = sess["name"]
                    break
            except (OSError, json.JSONDecodeError):
                continue
    except OSError:
        pass

data = {
    "text": text,
    "conversation_id": session_id,
    "generation_id": "",
    "model": "claude-code",
    "timestamp": str(epoch),
    "thread_title": session_name,
    "spoken": False,
    "source": "claude-code",
}

with open(filepath, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2)

log(f"Queued Claude Code response: {filename} ({len(text)} chars)")
print(filepath)
PY
)

rm -f "$PAYLOAD_FILE"

# Send notification (if enabled) for the exact file this run wrote
if [ -n "$QUEUED_FILE" ] && [ -f "$QUEUED_FILE" ]; then
    "$TTS_DIR/scripts/notify_queued.sh" "$QUEUED_FILE" 2>/dev/null || true
fi


# Cleanup old played files in background
"$TTS_DIR/scripts/cleanup_played.sh" &>/dev/null &

exit 0
