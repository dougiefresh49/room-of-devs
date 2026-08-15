#!/usr/bin/env bash
# scripts/lib/tsx-run.sh — shared tsx runner for scripts that shell into
# tts-server TypeScript entry points.
#
# Why not `pnpm exec tsx`: pnpm >= 11.20 runs a deps-status check before exec
# and, when the installed node_modules looks stale to it, tries to reinstall —
# which needs to purge the modules dir and aborts with
# ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY when there's no TTY. Hooks have no
# TTY, so a routine pnpm upgrade silently killed EVERY hook (2026-08-06).
# tts-server.sh already launches the local tsx binary directly; this makes the
# hooks and helper scripts do the same, with pnpm kept only as a fallback.
#
# Source after lib/tts-dir.sh:
#   source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tsx-run.sh"
#   tsx_available && tsx_exec src/ingest.ts      # replaces this process
#   (cd "$SERVER_DIR" && run_tsx src/phrases.ts) # ordinary subshell call

TSX_BIN="${TTS_DIR}/tts-server/node_modules/.bin/tsx"

# True when a tsx can be resolved at all (direct binary or pnpm fallback).
tsx_available() {
    [ -x "$TSX_BIN" ] || command -v pnpm >/dev/null 2>&1
}

# Run tsx and return.
run_tsx() {
    if [ -x "$TSX_BIN" ]; then
        "$TSX_BIN" "$@"
    else
        pnpm exec tsx "$@"
    fi
}

# Run tsx replacing the current process (hook hot path — no extra shell level).
tsx_exec() {
    if [ -x "$TSX_BIN" ]; then
        exec "$TSX_BIN" "$@"
    else
        exec pnpm exec tsx "$@"
    fi
}
