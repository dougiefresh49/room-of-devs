#!/usr/bin/env bash
#
# enqueue_manual.sh — Add a queue item without the Cursor hook (e.g. after listening was paused).
#
# Usage:
#   echo "Your pasted reply..." | enqueue_manual.sh "Thread title"
#   enqueue_manual.sh "Thread title" < ~/Desktop/missed-reply.md
#   pbpaste | enqueue_manual.sh
#
set -euo pipefail

# Q-14: honor exported TTS_DIR (shared resolver).
# shellcheck disable=SC1091
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tts-dir.sh"
QUEUE_DIR="$TTS_DIR/queue"
TITLE="${1:-Manual enqueue}"

mkdir -p "$QUEUE_DIR"

filepath=$(python3 -c "
import json, os, sys, time

title = sys.argv[1]
text = sys.stdin.read()
if not text.strip():
    print('Nothing to enqueue (empty stdin).', file=sys.stderr)
    sys.exit(1)

epoch = int(time.time())
path = os.path.join(os.path.expanduser('$QUEUE_DIR'), f'{epoch}-manual.json')
data = {
    'text': text,
    'conversation_id': 'manual',
    'generation_id': '',
    'model': '',
    'timestamp': str(epoch),
    'thread_title': title,
    'spoken': False,
}
with open(path, 'w') as f:
    json.dump(data, f, indent=2)
print(path)
" "$TITLE")

"$TTS_DIR/scripts/notify_queued.sh" "$filepath" 2>/dev/null || true
