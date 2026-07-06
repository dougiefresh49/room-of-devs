#!/usr/bin/env bash
#
# ingest.sh — afterAgentResponse hook script
# Reads hook JSON payload from stdin and writes a queue file for later playback.
# Runs from ~/.cursor/ (user-level hook working directory).
#
set -euo pipefail

TTS_DIR="$HOME/.cursor/tts"
QUEUE_DIR="$TTS_DIR/queue"
LOG_FILE="$TTS_DIR/logs/hook.log"

mkdir -p "$QUEUE_DIR" "$(dirname "$LOG_FILE")"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] ingest: $*" >> "$LOG_FILE"; }

LISTENING_FLAG="$TTS_DIR/listening.enabled"
if [ -f "$LISTENING_FLAG" ]; then
    case "$(tr -d ' \n' < "$LISTENING_FLAG")" in
        0|false|FALSE|off)
            log "Listening paused — skipping queue"
            exit 0
            ;;
    esac
fi

input=$(cat)
epoch=$(date +%s)

# One python invocation: parse the payload, resolve the thread title (cached
# per conversation_id under cache/titles/ so the SQLite scan doesn't run on
# every response), write the queue file, and print its exact path.
filepath=$(python3 - "$input" "$TTS_DIR" "$LOG_FILE" "$epoch" <<'PY'
import json
import os
import sqlite3
import sys
import time
from datetime import datetime

payload_raw, tts_dir, log_path, epoch = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
queue_dir = os.path.join(tts_dir, "queue")
titles_cache_dir = os.path.join(tts_dir, "cache", "titles")


def log(msg):
    try:
        with open(log_path, "a", encoding="utf-8") as f:
            ts = datetime.now().strftime("[%Y-%m-%d %H:%M:%S]")
            f.write(f"{ts} ingest: {msg}\n")
    except OSError:
        pass


try:
    payload = json.loads(payload_raw)
except (json.JSONDecodeError, ValueError):
    log("Failed to parse hook payload")
    sys.exit(0)

text = payload.get("text", "")
if not text:
    log("Empty text in hook payload — skipping")
    sys.exit(0)

conversation_id = payload.get("conversation_id") or "unknown"
generation_id = payload.get("generation_id", "")
model = payload.get("model", "")
roots = payload.get("workspace_roots") or []
workspace_root = roots[0] if roots else ""


def _workspace_matches_header(header: dict, root: str) -> bool:
    if not root:
        return True
    root = root.rstrip("/")
    uri = (header.get("workspaceIdentifier") or {}).get("uri") or {}
    fs_path = uri.get("fsPath") or ""
    external = str(uri.get("external") or "")
    return root in fs_path or root in external


def _lookup_global_composer_headers(cid: str, root: str) -> str:
    """Newer Cursor: titles live in globalStorage composer.composerHeaders (allComposers)."""
    gdb = os.path.expanduser(
        "~/Library/Application Support/Cursor/User/globalStorage/state.vscdb"
    )
    if not os.path.isfile(gdb):
        return ""
    try:
        conn = sqlite3.connect(gdb)
        cur = conn.cursor()
        cur.execute(
            "SELECT value FROM ItemTable WHERE key = 'composer.composerHeaders'"
        )
        row = cur.fetchone()
        conn.close()
    except Exception:
        return ""
    if not row:
        return ""
    try:
        payload = json.loads(row[0])
    except Exception:
        return ""
    composers = payload.get("allComposers") or []
    if not isinstance(composers, list):
        return ""

    def name_for_match(require_workspace: bool) -> str:
        for c in composers:
            if not isinstance(c, dict):
                continue
            if c.get("composerId") != cid:
                continue
            if require_workspace and not _workspace_matches_header(c, root):
                continue
            n = (c.get("name") or "").strip()
            if n:
                return n
        return ""

    # Prefer row tied to this workspace when hook sends workspace_roots
    if root:
        hit = name_for_match(require_workspace=True)
        if hit:
            return hit
    return name_for_match(require_workspace=False)


def _lookup_workspace_storage(cid: str, root: str) -> str:
    """Legacy: full composer rows under workspace state.vscdb → composer.composerData."""
    ws_storage = os.path.expanduser(
        "~/Library/Application Support/Cursor/User/workspaceStorage"
    )
    if not os.path.isdir(ws_storage):
        return ""
    for ws_dir in os.listdir(ws_storage):
        ws_json = os.path.join(ws_storage, ws_dir, "workspace.json")
        db_path = os.path.join(ws_storage, ws_dir, "state.vscdb")
        if not os.path.isfile(ws_json) or not os.path.isfile(db_path):
            continue

        try:
            with open(ws_json) as f:
                ws_data = json.load(f)
            ws_folder = ws_data.get("folder", "")
            if root and root not in ws_folder:
                continue
        except Exception:
            continue

        try:
            conn = sqlite3.connect(db_path)
            cur = conn.cursor()
            cur.execute(
                "SELECT value FROM ItemTable WHERE key = 'composer.composerData'"
            )
            row = cur.fetchone()
            conn.close()
            if row:
                composer_data = json.loads(row[0])
                for c in composer_data.get("allComposers") or []:
                    if c.get("composerId") == cid:
                        name = (c.get("name") or "").strip()
                        if name:
                            return name
        except Exception:
            pass
    return ""


# Thread title: check the per-conversation cache first so the workspaceStorage
# SQLite scan doesn't run on every response.
safe_cid = "".join(ch for ch in conversation_id if ch.isalnum() or ch in "-_")[:64] or "unknown"
cache_file = os.path.join(titles_cache_dir, f"{safe_cid}.txt")

thread_title = ""
try:
    with open(cache_file, encoding="utf-8") as f:
        thread_title = f.read().strip()
except OSError:
    pass

if not thread_title:
    thread_title = _lookup_workspace_storage(conversation_id, workspace_root)
    if not thread_title:
        # Migrated Cursor: workspace composer.composerData keeps only
        # selectedComposerIds; titles are in global composer.composerHeaders.
        thread_title = _lookup_global_composer_headers(conversation_id, workspace_root)
    if thread_title:
        try:
            os.makedirs(titles_cache_dir, exist_ok=True)
            with open(cache_file, "w", encoding="utf-8") as f:
                f.write(thread_title)
        except OSError:
            pass

display_title = thread_title
if len(display_title) > 40:
    display_title = display_title[:37] + "..."

short_conv = conversation_id[:12]
# Millisecond suffix avoids same-second filename collisions (matches ingest.ts).
ms = int(time.time() * 1000) % 1000
filename = f"{epoch}-{ms:03d}-{short_conv}.json"
filepath = os.path.join(queue_dir, filename)

data = {
    "text": text,
    "conversation_id": conversation_id,
    "generation_id": generation_id,
    "model": model,
    "timestamp": epoch,
    "thread_title": display_title,
    "spoken": False,
}
with open(filepath, "w") as f:
    json.dump(data, f, indent=2)

suffix = "" if display_title else " — thread title not resolved"
log(f"Queued response: {filename} (conv={short_conv}, {len(text)} chars){suffix}")
print(filepath)
PY
) || filepath=""

if [ -n "$filepath" ] && [ -f "$filepath" ]; then
    "$TTS_DIR/scripts/notify_queued.sh" "$filepath" 2>/dev/null || true
fi

# Periodically clean old played files (runs in background, non-blocking)
"$TTS_DIR/scripts/cleanup_played.sh" &>/dev/null &

exit 0
