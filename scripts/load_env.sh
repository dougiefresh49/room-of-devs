#!/usr/bin/env bash
#
# load_env.sh — Source API keys from .env file.
# Checks ~/.cursor/tts/.env first, then the project root.
# Only allowlisted keys are exported (PATH/DYLD_* hijack hazard — H-3).
#
# Usage: source "$SCRIPTS_DIR/load_env.sh"
#

# Keys the hook/daemon layer is allowed to pull from .env.
_LOAD_ENV_ALLOWLIST="ELEVENLABS_API_KEY GEMINI_API_KEY"

_load_env_key_allowed() {
    local candidate="$1"
    local allowed
    for allowed in $_LOAD_ENV_ALLOWLIST; do
        if [ "$candidate" = "$allowed" ]; then
            return 0
        fi
    done
    return 1
}

_load_env_file() {
    local envfile="$1"
    if [ -f "$envfile" ]; then
        while IFS='=' read -r key value || [ -n "$key" ]; do
            # Trim whitespace around the key only (values keep interior spaces).
            key="${key#"${key%%[![:space:]]*}"}"
            key="${key%"${key##*[![:space:]]}"}"
            [[ -z "$key" || "$key" == \#* ]] && continue
            # Reject non-identifier names even if somehow allowlisted later.
            [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
            _load_env_key_allowed "$key" || continue
            value="${value#\"}"
            value="${value%\"}"
            value="${value#\'}"
            value="${value%\'}"
            export "$key=$value"
        done < "$envfile"
        return 0
    fi
    return 1
}

if [ -z "${ELEVENLABS_API_KEY:-}" ] || [ -z "${GEMINI_API_KEY:-}" ]; then
    _load_env_file "$HOME/.cursor/tts/.env" || \
    _load_env_file "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." 2>/dev/null && pwd)/.env" || \
    true
fi
