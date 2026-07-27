# HANDOFF-61 — changes owned by other lanes (forbidden files for this lane)

## H-5 remainder: `tts-server/src/signal.ts` + hook callers

`hook_prompt.sh` and `hook_ask_user.sh` still pass prompt/question text as
`process.argv[4]` because `signal.ts` only reads that argv slot. This lane
owns the shell scripts but **must not** edit `tts-server/src/signal.ts`.

### Exact change for `tts-server/src/signal.ts`

After the existing:
```ts
const action = process.argv[2];
const sessionId = process.argv[3] || "";
const textArg = process.argv[4] || "";
```

Replace the plain `textArg` consumption for `prompt-submitted` / `ask-user`
with a helper that prefers `--text-file <path>` (and deletes the file after
read), falling back to argv for back-compat:

```ts
import { readFileSync, unlinkSync } from "fs";

function resolveTextArg(argv: string[]): string {
  const idx = argv.indexOf("--text-file");
  if (idx >= 0 && argv[idx + 1]) {
    const path = argv[idx + 1];
    try {
      const text = readFileSync(path, "utf-8");
      try { unlinkSync(path); } catch {}
      return text;
    } catch (err: any) {
      log("signal", `Failed to read --text-file: ${err.message}`);
      return "";
    }
  }
  // Legacy: text still in argv[4] when not using --text-file.
  return argv[4] || "";
}

const action = process.argv[2];
const sessionId = process.argv[3] || "";
const textArg = resolveTextArg(process.argv);
```

(Keep the muted-session / replay branches unchanged. Replay still uses
`argv[4]` as the nth index — `resolveTextArg` must only apply the file path
when `--text-file` is present, otherwise `argv[4]` remains the nth / text.)

### Exact change for `scripts/hook_prompt.sh` (final H-5 form)

Replace the `exec pnpm exec tsx … "$USER_PROMPT"` block with:

```bash
if [ -f "$SERVER_DIR/src/signal.ts" ] && command -v pnpm &>/dev/null; then
    cd "$SERVER_DIR"
    TEXT_FILE=$(mktemp "${TMPDIR:-/tmp}/hook-prompt-text.XXXXXX")
    printf '%s' "$USER_PROMPT" > "$TEXT_FILE"
    exec pnpm exec tsx src/signal.ts prompt-submitted "$SESSION_ID" --text-file "$TEXT_FILE"
fi
```

### Exact change for `scripts/hook_ask_user.sh` (final H-5 form)

```bash
if [ -f "$SERVER_DIR/src/signal.ts" ] && command -v pnpm &>/dev/null; then
    cd "$SERVER_DIR"
    TEXT_FILE=$(mktemp "${TMPDIR:-/tmp}/hook-ask-text.XXXXXX")
    printf '%s' "$QUESTION_TEXT" > "$TEXT_FILE"
    exec pnpm exec tsx src/signal.ts ask-user "$SESSION_ID" --text-file "$TEXT_FILE"
fi
```

Deploy order: land `signal.ts` first (or atomically with the two hook
scripts). Flipping the hooks before `signal.ts` would speak empty prompts.

## H-6 remainder: `scripts/ptt.sh` (forbidden — owned by ptt lane)

Audit H-6 also cites `ptt.sh:228` for verbatim transcript logging. This lane
must not edit `ptt.sh`. Gate that log behind `TTS_HOOK_DEBUG=1` the same way
`hook_prompt.sh` / `hook_ask_user.sh` now do.

## Skipped by design (other lanes)

- **H-1** — `scripts/setup.sh` hooks.json absolute paths
- **H-7** — `scripts/setup.sh` `.env` chmod 600
