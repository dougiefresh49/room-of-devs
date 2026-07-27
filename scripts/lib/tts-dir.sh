#!/usr/bin/env bash
# scripts/lib/tts-dir.sh — shared TTS_DIR resolver (audit Q-14).
#
# Honor an already-exported TTS_DIR; otherwise default to ~/.cursor/tts.
# Source from any script under scripts/:
#   # shellcheck source=lib/tts-dir.sh
#   source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tts-dir.sh"
# From scripts/hooks/ (one level deeper):
#   source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib/tts-dir.sh"
#
# Makes the eventual ~/.cursor/tts → ~/.room-of-devs rename a one-line change.

: "${TTS_DIR:=${HOME}/.cursor/tts}"
export TTS_DIR
