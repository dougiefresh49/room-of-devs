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
# Repo root is recorded by setup.sh (audit C-3). This script runs from the
# installed copy at ~/.cursor/tts/scripts/, so BASH_SOURCE cannot yield the
# source checkout — never trust CURSOR_READ_ALOUD_ROOT or a hardcoded path.
REPO_ROOT_FILE="$TTS_DIR/repo_root"
if [ ! -f "$REPO_ROOT_FILE" ]; then
    echo "Error: repo root not recorded at $REPO_ROOT_FILE — re-run scripts/setup.sh from the checkout"
    exit 1
fi
REPO_ROOT="$(tr -d '\n' < "$REPO_ROOT_FILE")"
if [ -z "$REPO_ROOT" ] || [ ! -d "$REPO_ROOT" ]; then
    echo "Error: invalid repo root in $REPO_ROOT_FILE: ${REPO_ROOT:-empty}"
    exit 1
fi
REPO_SERVER_DIR="$REPO_ROOT/tts-server"

mkdir -p "$(dirname "$LOG_FILE")"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] tts-server: $*" >> "$TTS_DIR/logs/hook.log" 2>/dev/null || true; }

is_running() {
    [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE" 2>/dev/null)" 2>/dev/null
}

# Fail-loud sync (Phase 1): every step either succeeds or aborts the start —
# the old `|| true` chain could boot a daemon on stale or mixed sources.
sync_source() {
    if [ ! -d "$REPO_SERVER_DIR/src" ]; then
        echo "Error: repo source not found at $REPO_SERVER_DIR/src — not syncing"
        exit 1
    fi
    if ! command -v rsync >/dev/null 2>&1; then
        echo "Error: rsync not found (required for source sync)"
        exit 1
    fi

    # Full tree sync (src/services/ and any future subdirs included) with
    # deletion of removed files, so a renamed/deleted module can't linger in
    # the install and shadow the new code. src/protocol is a repo symlink —
    # excluded here (exclusion also protects the staged copy from --delete)
    # and staged as real files below. characters.json is runtime data at
    # $TTS_DIR/characters.json — never deploy or retain a copy under src/.
    rsync -a --delete \
        --exclude=/protocol \
        --exclude=/characters.json \
        "$REPO_SERVER_DIR/src/" "$SERVER_DIR/src/" \
        || { echo "Error: source sync failed"; exit 1; }
    rm -f "$SERVER_DIR/src/characters.json"

    # Shared protocol package, staged as plain files: the installed daemon
    # must never resolve modules back into the repo workspace (valibot comes
    # from SERVER_DIR's own node_modules).
    REPO_PROTOCOL_SRC="$REPO_ROOT/packages/protocol/src"
    if [ ! -d "$REPO_PROTOCOL_SRC" ]; then
        echo "Error: packages/protocol/src missing in repo — not syncing"
        exit 1
    fi
    # A symlinked target (e.g. copied in by an older setup.sh) would dangle
    # or write back into the repo — replace it with a real dir.
    if [ -L "$SERVER_DIR/src/protocol" ]; then
        rm -f "$SERVER_DIR/src/protocol"
    fi
    mkdir -p "$SERVER_DIR/src/protocol"
    rsync -a --delete --copy-links "$REPO_PROTOCOL_SRC"/ "$SERVER_DIR/src/protocol/" \
        || { echo "Error: protocol staging failed"; exit 1; }

    # Legacy mobile.html deleted in Phase 6 — clean it out of old installs.
    rm -f "$SERVER_DIR/mobile.html"

    # Mobile Vite SPA artifact — fatal if missing; / serves it.
    REPO_MOBILE_DIST="$REPO_ROOT/packages/mobile/dist"
    if [ ! -d "$REPO_MOBILE_DIST" ] || [ ! -f "$REPO_MOBILE_DIST/index.html" ]; then
        echo "Error: packages/mobile/dist missing in repo — build with: pnpm --filter @room/mobile build"
        exit 1
    fi
    mkdir -p "$SERVER_DIR/mobile-dist"
    rsync -a --delete "$REPO_MOBILE_DIST"/ "$SERVER_DIR/mobile-dist/" \
        || { echo "Error: mobile-dist sync failed"; exit 1; }

    # Avatar frames for LAN mobile clients
    REPO_AVATARS="$REPO_ROOT/panel/public/avatars"
    if [ -d "$REPO_AVATARS" ]; then
        mkdir -p "$TTS_DIR/mobile-assets/avatars"
        rsync -a --delete "$REPO_AVATARS"/ "$TTS_DIR/mobile-assets/avatars/" \
            || { echo "Error: avatar sync failed"; exit 1; }
    fi

    # Scripts on the same cadence as the daemon (audit A-7). Exclude
    # install/dev-only tools that stay in the repo.
    REPO_SCRIPTS="$REPO_ROOT/scripts"
    if [ ! -d "$REPO_SCRIPTS" ]; then
        echo "Error: scripts/ missing in repo — not syncing"
        exit 1
    fi
    rsync -a --delete \
        --exclude=setup.sh \
        --exclude=panel-dev-install.sh \
        --exclude=docs-publish.mjs \
        --exclude=raycast/ \
        "$REPO_SCRIPTS/" "$TTS_DIR/scripts/" \
        || { echo "Error: scripts sync failed"; exit 1; }
    chmod +x "$TTS_DIR/scripts/"*.sh "$TTS_DIR/scripts/"*.py 2>/dev/null || true

    # Sync package.json + lockfile; reinstall when either changed.
    # Frozen lockfile only — no silent unpinned fallback (audit H-8 / Q-13).
    if [ ! -f "$REPO_SERVER_DIR/pnpm-lock.yaml" ]; then
        echo "Error: pnpm-lock.yaml missing at $REPO_SERVER_DIR — cannot pin install"
        exit 1
    fi
    NEED_INSTALL=false
    if [ -f "$REPO_SERVER_DIR/package.json" ] && \
       ! diff -q "$REPO_SERVER_DIR/package.json" "$SERVER_DIR/package.json" >/dev/null 2>&1; then
        cp "$REPO_SERVER_DIR/package.json" "$SERVER_DIR/package.json"
        NEED_INSTALL=true
    fi
    if ! diff -q "$REPO_SERVER_DIR/pnpm-lock.yaml" "$SERVER_DIR/pnpm-lock.yaml" >/dev/null 2>&1; then
        cp "$REPO_SERVER_DIR/pnpm-lock.yaml" "$SERVER_DIR/pnpm-lock.yaml"
        NEED_INSTALL=true
    fi
    if [ "$NEED_INSTALL" = true ]; then
        log "package.json/lockfile changed — running pnpm install --frozen-lockfile"
        (cd "$SERVER_DIR" && pnpm install --frozen-lockfile >> "$LOG_FILE" 2>&1) \
            || { echo "Error: pnpm install --frozen-lockfile failed — check $LOG_FILE"; exit 1; }
    fi
    log "Synced source from $REPO_SERVER_DIR"
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

    # server.log is shell-redirected (the daemon can't rotate its own stdout)
    # — single-slot rotate at 5MB, mirroring the daemon's hook.log rotation.
    if [ -f "$LOG_FILE" ] && [ "$(stat -f%z "$LOG_FILE" 2>/dev/null || echo 0)" -gt 5242880 ]; then
        mv -f "$LOG_FILE" "$LOG_FILE.1" 2>/dev/null || true
    fi

    TSX_BIN="$SERVER_DIR/node_modules/.bin/tsx"
    if [ ! -x "$TSX_BIN" ]; then
        echo "Error: tsx not found at $TSX_BIN — run setup.sh (or pnpm install in $SERVER_DIR)"
        exit 1
    fi

    cd "$SERVER_DIR"
    # Launch tsx directly (not via pnpm) so the PID file holds the real watcher
    # PID. set -m gives the background job its own process group so stop can
    # kill the whole group as a safety net.
    set -m
    nohup "$TSX_BIN" src/index.ts >> "$LOG_FILE" 2>&1 &
    local pid=$!
    set +m
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
    # Kill the whole process group (safety net for any children), then the PID
    kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true

    local waited=0
    while kill -0 "$pid" 2>/dev/null && [ "$waited" -lt 5 ]; do
        sleep 1
        waited=$((waited + 1))
    done

    if kill -0 "$pid" 2>/dev/null; then
        kill -9 -- "-$pid" 2>/dev/null || kill -9 "$pid" 2>/dev/null || true
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
