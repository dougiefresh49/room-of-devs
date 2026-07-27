#!/usr/bin/env bash
# Print the LAN URL for the mobile room view.
# Usage:
#   mobile_url.sh           # print current URL
#   mobile_url.sh --rotate  # mint a new token (restart daemon to apply in-memory)
set -euo pipefail

# Q-14: honor exported TTS_DIR (shared resolver).
# shellcheck disable=SC1091
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tts-dir.sh"
CONFIG="$TTS_DIR/config.json"
TOKEN_FILE="$TTS_DIR/mobile_token"

if [ "${1:-}" = "--rotate" ]; then
  mkdir -p "$TTS_DIR"
  token=$(openssl rand -hex 16 2>/dev/null || python3 -c 'import secrets; print(secrets.token_hex(16))')
  umask 077
  printf '%s\n' "$token" > "$TOKEN_FILE"
  chmod 600 "$TOKEN_FILE"
  echo "Rotated mobile token at $TOKEN_FILE (restart the daemon if running so it reloads)" >&2
fi

port=4785
if [ -f "$CONFIG" ]; then
  cfg_port=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('mobile_port', 4785))" "$CONFIG" 2>/dev/null || echo 4785)
  if [ -n "$cfg_port" ]; then
    port="$cfg_port"
  fi
fi

if [ ! -f "$TOKEN_FILE" ]; then
  echo "No mobile token yet — start the TTS daemon once so mobile-http can create $TOKEN_FILE" >&2
  exit 1
fi

token=$(tr -d '[:space:]' < "$TOKEN_FILE")
if [ -z "$token" ]; then
  echo "Empty mobile token at $TOKEN_FILE" >&2
  exit 1
fi

# The daemon binds loopback + the Tailscale (CGNAT 100.64.0.0/10) address
# only — never the LAN — so the reachable phone URL is the tailnet one.
# In containers / non-macOS, fall back to loopback.
ip=""
if command -v ifconfig >/dev/null 2>&1; then
  ip=$(ifconfig 2>/dev/null \
    | awk '/inet /{split($2,o,"."); if (o[1]=="100" && o[2]>=64 && o[2]<=127) {print $2; exit}}')
fi
if [ -z "$ip" ]; then
  echo "No Tailscale IPv4 found — the room is bound to 127.0.0.1 only; bring Tailscale up for phone access" >&2
  ip="127.0.0.1"
fi

echo "http://${ip}:${port}/?t=${token}"
