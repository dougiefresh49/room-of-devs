#!/usr/bin/env bash
#
# restart.sh — Start the current message over: stop playback, then replay the
# newest saved mp3 from replay/ (no API cost). Falls back to the full pipeline
# (play_node.sh) only when no replay exists yet.
#
set -euo pipefail

TTS_DIR="$HOME/.cursor/tts"
SCRIPTS_DIR="$TTS_DIR/scripts"
SERVER_DIR="$TTS_DIR/tts-server"
REPLAY_DIR="$TTS_DIR/replay"
PLAYBACK_REF="$TTS_DIR/.playback-file"
LOG_FILE="$TTS_DIR/logs/hook.log"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] restart: $*" >> "$LOG_FILE" 2>/dev/null || true; }

mkdir -p "$(dirname "$LOG_FILE")"

# Capture state BEFORE stopping — stop.sh removes .playback-file, and the
# replay mp3 for the current message is only written when ffplay closes.
QUEUE_FILE=""
if [ -f "$PLAYBACK_REF" ]; then
    QUEUE_FILE=$(tr -d '\n' < "$PLAYBACK_REF")
fi
WAS_PLAYING=0
[ -n "$QUEUE_FILE" ] && WAS_PLAYING=1
NEWEST_BEFORE=$(ls -t "$REPLAY_DIR"/*.mp3 2>/dev/null | head -1 || true)

"$SCRIPTS_DIR/stop.sh" 2>/dev/null || true

# If we interrupted live playback, the server's close handler writes the replay
# mp3 asynchronously — wait for a NEW file so we don't replay the previous message.
NEWEST_AFTER="$NEWEST_BEFORE"
if [ "$WAS_PLAYING" = "1" ]; then
    for _ in 1 2 3 4 5 6 7 8; do
        NEWEST_AFTER=$(ls -t "$REPLAY_DIR"/*.mp3 2>/dev/null | head -1 || true)
        [ -n "$NEWEST_AFTER" ] && [ "$NEWEST_AFTER" != "$NEWEST_BEFORE" ] && break
        sleep 0.5
    done
fi

replay_newest() {
    log "Replaying newest saved audio from replay/"
    cd "$SERVER_DIR"
    exec pnpm exec tsx src/signal.ts replay "" 1
}

# Idle restart ("say that again"): newest replay IS the last message.
if [ "$WAS_PLAYING" = "0" ] && [ -n "$NEWEST_BEFORE" ]; then
    replay_newest
fi

# Interrupted playback and its replay landed: replay it.
if [ "$WAS_PLAYING" = "1" ] && [ -n "$NEWEST_AFTER" ] && [ "$NEWEST_AFTER" != "$NEWEST_BEFORE" ]; then
    replay_newest
fi

# Replay didn't land in time — fall back to the captured queue item (it may
# have already been moved to played/ since synthesis succeeded).
if [ -n "$QUEUE_FILE" ]; then
    if [ ! -f "$QUEUE_FILE" ] && [ -f "$TTS_DIR/played/$(basename "$QUEUE_FILE")" ]; then
        QUEUE_FILE="$TTS_DIR/played/$(basename "$QUEUE_FILE")"
    fi
    if [ -f "$QUEUE_FILE" ]; then
        log "No fresh replay — re-running full pipeline for $QUEUE_FILE"
        exec "$SCRIPTS_DIR/play_node.sh" "$QUEUE_FILE"
    fi
fi

# Last resort: any saved replay at all.
if [ -n "$NEWEST_AFTER" ]; then
    replay_newest
fi

log "Nothing to restart — no replay audio and no restartable queue file"
exit 1
