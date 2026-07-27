#!/usr/bin/env bash
# Dev install for the Room panel: build → verify fresh → replace installed
# bundle → relaunch. Fails loudly on stale artifacts (the v2-consensus fix
# for "setup.sh silently installed an old build"). For ordinary component
# work use `pnpm tauri dev` instead — this is for testing the REAL bundle
# (NSPanel windows, activation policy, install-path behavior).
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Q-14: honor exported TTS_DIR (shared resolver).
# shellcheck disable=SC1091
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tts-dir.sh"
ROOM_SRC="$PROJECT_DIR/panel/src-tauri/target/debug/bundle/macos/Room.app"
ROOM_DST="$TTS_DIR/Room.app"
CARGO_BIN="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin"

log() { printf '[panel-dev-install] %s\n' "$*"; }

if [ ! -x "$CARGO_BIN/cargo" ]; then
    log "cargo not found at $CARGO_BIN — install rustup stable first"
    exit 1
fi

BUILD_STARTED=$(date +%s)
log "Building Room.app (debug)..."
(cd "$PROJECT_DIR/panel" && PATH="$CARGO_BIN:$PATH" pnpm tauri build --debug)

# Fail on stale artifacts: the bundle binary must postdate the build start.
BIN="$ROOM_SRC/Contents/MacOS/room-panel"
if [ ! -f "$BIN" ]; then
    log "ERROR: built bundle missing at $ROOM_SRC"
    exit 1
fi
BIN_MTIME=$(stat -f %m "$BIN")
if [ "$BIN_MTIME" -lt "$BUILD_STARTED" ]; then
    log "ERROR: bundle binary predates this build (stale artifact) — aborting install"
    exit 1
fi

log "Installing to $ROOM_DST"
rsync -a --delete "$ROOM_SRC/" "$ROOM_DST/"

if pgrep -x room-panel >/dev/null 2>&1 || pgrep -f "Room.app/Contents/MacOS" >/dev/null 2>&1; then
    log "Stopping running Room.app..."
    if [ "$(uname -s)" = "Darwin" ] && command -v osascript >/dev/null 2>&1; then
      osascript -e 'tell application "Room" to quit' 2>/dev/null || true
    fi
    for _ in 1 2 3 4 5 6 7 8 9 10; do
        pgrep -f "Room.app/Contents/MacOS" >/dev/null 2>&1 || break
        sleep 0.3
    done
    pkill -f "Room.app/Contents/MacOS" 2>/dev/null || true
fi

log "Launching $ROOM_DST"
open "$ROOM_DST"
log "Done."
