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

text=$(echo "$input" | python3 -c "import sys,json; print(json.load(sys.stdin).get('text',''))" 2>/dev/null) || {
    log "Failed to parse text from hook payload"
    exit 0
}

if [ -z "$text" ]; then
    log "Empty text in hook payload — skipping"
    exit 0
fi

conversation_id=$(echo "$input" | python3 -c "import sys,json; print(json.load(sys.stdin).get('conversation_id','unknown'))" 2>/dev/null) || conversation_id="unknown"
generation_id=$(echo "$input" | python3 -c "import sys,json; print(json.load(sys.stdin).get('generation_id',''))" 2>/dev/null) || generation_id=""
model=$(echo "$input" | python3 -c "import sys,json; print(json.load(sys.stdin).get('model',''))" 2>/dev/null) || model=""
workspace_roots=$(echo "$input" | python3 -c "import sys,json; r=json.load(sys.stdin).get('workspace_roots',[]); print(r[0] if r else '')" 2>/dev/null) || workspace_roots=""

epoch=$(date +%s)
short_conv=$(echo "$conversation_id" | cut -c1-12)
filename="${epoch}-${short_conv}.json"
filepath="$QUEUE_DIR/$filename"

python3 - "$text" "$conversation_id" "$generation_id" "$model" "$epoch" "$filepath" "$workspace_roots" <<'PY'
import json
import os
import sqlite3
import sys

text, conversation_id, generation_id, model, epoch, filepath, workspace_root = (
    sys.argv[1],
    sys.argv[2],
    sys.argv[3],
    sys.argv[4],
    sys.argv[5],
    sys.argv[6],
    sys.argv[7],
)

thread_title = ""


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


# 1) Legacy: full composer rows under workspace state.vscdb → composer.composerData
ws_storage = os.path.expanduser("~/Library/Application Support/Cursor/User/workspaceStorage")
if os.path.isdir(ws_storage):
    for ws_dir in os.listdir(ws_storage):
        ws_json = os.path.join(ws_storage, ws_dir, "workspace.json")
        db_path = os.path.join(ws_storage, ws_dir, "state.vscdb")
        if not os.path.isfile(ws_json) or not os.path.isfile(db_path):
            continue

        try:
            with open(ws_json) as f:
                ws_data = json.load(f)
            ws_folder = ws_data.get("folder", "")
            if workspace_root and workspace_root not in ws_folder:
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
                    if c.get("composerId") == conversation_id:
                        thread_title = (c.get("name") or "").strip()
                        break
        except Exception:
            pass

        if thread_title:
            break

# 2) Migrated Cursor: workspace composer.composerData keeps only selectedComposerIds;
#    thread titles are in global composer.composerHeaders.
if not thread_title:
    thread_title = _lookup_global_composer_headers(conversation_id, workspace_root)

if len(thread_title) > 40:
    thread_title = thread_title[:37] + "..."

data = {
    "text": text,
    "conversation_id": conversation_id,
    "generation_id": generation_id,
    "model": model,
    "timestamp": epoch,
    "thread_title": thread_title,
    "spoken": False,
}
with open(filepath, "w") as f:
    json.dump(data, f, indent=2)
PY

tt_ok=false
if python3 -c "import json,sys; d=json.load(open(sys.argv[1])); sys.exit(0 if str(d.get('thread_title','')).strip() else 1)" "$filepath" 2>/dev/null; then
    tt_ok=true
fi

if [ "$tt_ok" = true ]; then
    log "Queued response: $filename (conv=$short_conv, ${#text} chars)"
else
    log "Queued response: $filename (conv=$short_conv, ${#text} chars) — thread title not resolved"
fi

"$TTS_DIR/scripts/notify_queued.sh" "$filepath" 2>/dev/null || true


# Periodically clean old played files (runs in background, non-blocking)
"$TTS_DIR/scripts/cleanup_played.sh" &>/dev/null &

exit 0
