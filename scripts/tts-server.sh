#!/usr/bin/env bash
#
# tts-server.sh — Start/stop/status for the Node.js TTS server daemon.
#
# Usage: tts-server.sh {start|stop|status|restart}
#
set -euo pipefail

TTS_DIR="$HOME/.cursor/tts"
SERVER_DIR="$TTS_DIR/tts-server"
PID_FILE="$TTS_DIR/.tts-server.pid"
LOG_FILE="$TTS_DIR/logs/server.log"
REPO_SERVER_DIR="${CURSOR_READ_ALOUD_ROOT:-$HOME/projects/cursor-read-aloud}/tts-server"

mkdir -p "$(dirname "$LOG_FILE")"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] tts-server: $*" >> "$TTS_DIR/logs/hook.log" 2>/dev/null || true; }

is_running() {
    [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE" 2>/dev/null)" 2>/dev/null
}

sync_source() {
    if [ -d "$REPO_SERVER_DIR/src" ]; then
        cp "$REPO_SERVER_DIR"/src/*.ts "$SERVER_DIR/src/" 2>/dev/null || true
        cp "$REPO_SERVER_DIR"/src/*.json "$SERVER_DIR/src/" 2>/dev/null || true
        log "Synced source from $REPO_SERVER_DIR"
    fi
}

start_server() {
    if is_running; then
        echo "tts-server already running (PID $(cat "$PID_FILE"))"
        return 0
    fi

    if [ ! -d "$SERVER_DIR" ] || [ ! -f "$SERVER_DIR/package.json" ]; then
        echo "Error: tts-server not installed at $SERVER_DIR"
        echo "Run: setup.sh to install"
        exit 1
    fi

    if ! command -v pnpm &>/dev/null; then
        echo "Error: pnpm not found"
        exit 1
    fi

    sync_source

    cd "$SERVER_DIR"
    nohup pnpm start >> "$LOG_FILE" 2>&1 &
    local pid=$!
    echo "$pid" > "$PID_FILE"
    disown "$pid" 2>/dev/null || true

    sleep 1
    if kill -0 "$pid" 2>/dev/null; then
        echo "tts-server started (PID $pid)"
        log "Started (PID $pid)"
    else
        echo "tts-server failed to start — check $LOG_FILE"
        rm -f "$PID_FILE"
        exit 1
    fi
}

stop_server() {
    if ! is_running; then
        echo "tts-server not running"
        rm -f "$PID_FILE"
        return 0
    fi

    local pid
    pid=$(cat "$PID_FILE")
    kill "$pid" 2>/dev/null || true

    local waited=0
    while kill -0 "$pid" 2>/dev/null && [ "$waited" -lt 5 ]; do
        sleep 1
        waited=$((waited + 1))
    done

    if kill -0 "$pid" 2>/dev/null; then
        kill -9 "$pid" 2>/dev/null || true
    fi

    rm -f "$PID_FILE"
    echo "tts-server stopped"
    log "Stopped"
}

case "${1:-status}" in
    start)   start_server ;;
    stop)    stop_server ;;
    restart) stop_server; start_server ;;
    status)
        if is_running; then
            echo "running (PID $(cat "$PID_FILE"))"
        else
            rm -f "$PID_FILE" 2>/dev/null
            echo "stopped"
        fi
        ;;
    *)
        echo "Usage: $0 {start|stop|status|restart}"
        exit 1
        ;;
esac
