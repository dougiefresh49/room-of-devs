#!/usr/bin/env bash
#
# load_env.sh — Source API keys from .env file.
#
# M-19 / Q-14 precedence (must match tts-server/src/config.ts loadEnv):
#   1. explicit environment (never overwritten)
#   2. .env file ($TTS_DIR/.env, then repo-root .env)
#   3. unset / caller default
#
# Only allowlisted keys are exported (PATH/DYLD_* hijack hazard — H-3).
#
# Usage: source "$SCRIPTS_DIR/load_env.sh"
#

# Q-14: honor exported TTS_DIR when resolving the install .env.
: "${TTS_DIR:=${HOME}/.cursor/tts}"

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
            # M-19: never clobber an explicit env value (TS loadEnv parity).
            if eval "[ -n \"\${$key+x}\" ]"; then
                continue
            fi
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

# Fill in missing allowlisted keys only — never overwrite.
_load_env_file "$TTS_DIR/.env" || \
_load_env_file "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." 2>/dev/null && pwd)/.env" || \
true
