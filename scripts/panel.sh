#!/usr/bin/env bash
#
# panel.sh — Launch the Room agent panel (Tauri).
# Prefers ~/.cursor/tts/Room.app, then a repo build; otherwise runs `pnpm tauri dev` in the background.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PANEL_DIR="$PROJECT_DIR/panel"
TTS_DIR="$HOME/.cursor/tts"
INSTALLED_APP="$TTS_DIR/Room.app"

# The panel is a WebSocket client of the tts-server daemon — without it the
# Room opens disconnected and empty. Idempotent: no-ops when already running.
if [ -x "$TTS_DIR/scripts/tts-server.sh" ]; then
    bash "$TTS_DIR/scripts/tts-server.sh" start >/dev/null 2>&1 || true
fi

find_built_app() {
  for dir in \
    "$PANEL_DIR/src-tauri/target/release/bundle/macos" \
    "$PANEL_DIR/src-tauri/target/debug/bundle/macos"; do
    if [ -d "$dir" ]; then
      local app
      app=$(find "$dir" -maxdepth 1 -name '*.app' -print -quit 2>/dev/null || true)
      if [ -n "$app" ]; then
        echo "$app"
        return 0
      fi
    fi
  done
  return 1
}

if [ -d "$INSTALLED_APP" ]; then
  open "$INSTALLED_APP"
else
  APP=$(find_built_app || true)
  if [ -n "$APP" ]; then
    open "$APP"
  else
    cd "$PANEL_DIR"
    nohup pnpm tauri dev >/dev/null 2>&1 &
  fi
fi
