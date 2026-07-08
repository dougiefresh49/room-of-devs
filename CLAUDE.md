# CLAUDE.md

Personal macOS dev tool that reads AI coding agent responses aloud with character voices. Pipeline: Claude Code hooks → JSON queue files → Node.js/TypeScript watcher (`tts-server/`) → Gemini preprocessing → ElevenLabs streaming TTS → ffplay. SwiftBar plugin (`plugins/`) is the menu bar UI; `scripts/` holds bash utilities.

This is a local personal tool, not production software. Optimize for working + cheap to run, not for hardening, test coverage, or CI.

## The two-location gotcha

The repo is NOT what runs. `scripts/setup.sh` installs everything to `~/.cursor/tts/` (scripts, config, SwiftBar plugin), and `tts-server.sh start|restart` syncs `tts-server/src/*.ts` from the repo into `~/.cursor/tts/tts-server/` before launching. So:

- Edit files **in the repo**, never in `~/.cursor/tts/` directly (they get overwritten on sync).
- A TypeScript change takes effect only after `~/.cursor/tts/scripts/tts-server.sh restart`.
- A change to `scripts/*.sh` or the SwiftBar plugin takes effect after re-running `scripts/setup.sh`.
- Runtime state lives in `~/.cursor/tts/`: `queue/`, `played/`, `replay/`, `logs/hook.log`, `logs/server.log`, `config.json`, `session_voices.json`.

## API credit efficiency (top priority)

Every queue item costs one Gemini call (`gemini-3.1-flash-lite`) and one ElevenLabs synthesis (billed per character — the expensive one). Rules for any work in this repo:

- When verifying the pipeline live, use SHORT text (< 200 chars) via `echo "short test" | ~/.cursor/tts/scripts/enqueue_manual.sh "Test"`, or process a single file with `cd tts-server && pnpm exec tsx src/index.ts once <queue-file>`. One run is enough — never loop live synthesis.
- If the thing being verified isn't synthesis itself (queue logic, parsing, dedup, menu rendering), test WITHOUT burning credits: both `processWithGemini` and `streamTTS` skip gracefully when `GEMINI_API_KEY` / `ELEVENLABS_API_KEY` are absent, falling back to `fallbackClean` and cached phrases.
- Don't regenerate cached phrase MP3s (`phrases.ts` skips existing files — preserve that behavior).
- Don't raise the `truncateForTTS` 4800-char cap, change `gemini_model`, or change `elevenlabs_model_id` without asking.
- Watch for changes that could double-fire API calls: the dedup hash in `ingest.ts`, mute checks in `index.ts` (these run BEFORE the API calls — keep it that way), and the processing markers/locks in `audio.ts`.

## Code style

- Always strive for concise, simple solutions.
- If a problem can be solved in a simpler way, propose it.
- Filesystem-based state (JSON files, PID files, lock files) is the house style here — don't introduce a database or framework.

## General preferences

- Use pnpm, never npm.
- Delegation roster: cursor-agent, codex, and Claude models only. Don't delegate to agy/Antigravity (owner call, 2026-07-07 — flaky headless behavior).
- If asked to do too much work at once, stop and state that clearly.
- If computer use is helpful for completing or verifying work, shell out to gpt-5.x with Codex for it (see the `codex-computer-use` skill).

## Picking the right models for workflows and subagents

Rankings, higher = better. Cost reflects what we actually pay (subscriptions with generous limits rank cheap), not list price. Intelligence is how hard a problem you can hand the model unsupervised. Taste covers UI/UX, code quality, API design, and copy.

| model        | cost | intelligence | taste | reachable via                    |
| ------------ | ---- | ------------ | ----- | -------------------------------- |
| composer-2.5 | 8    | 5            | 5     | cursor-agent CLI (`agent`)       |
| grok-4.5     | 8    | 6            | 6     | cursor-agent CLI (`--model grok-4.5-fast-xhigh`; everyday tier `-fast-high`) |
| gpt-5.x      | 8    | 7            | 5     | codex CLI (`codex`)              |
| sonnet-5     | 5    | 5            | 7     | Agent/Workflow `model: 'sonnet'` |
| opus-4.8     | 4    | 7            | 8     | Agent/Workflow `model: 'opus'`   |
| fable-5      | 2    | 9            | 9     | Agent/Workflow `model: 'fable'`  |

How to apply:

- These are defaults, not limits. You have standing permission to override them: if a cheaper model's output doesn't meet the bar, rerun or redo the work with a smarter model without asking. Judge the output, not the price tag. Escalating costs less than shipping mediocre work.
- Cost is a tie-breaker only; when axes conflict for anything that ships, intelligence > taste > cost.
- Bulk/mechanical work (clear-spec implementation, formatting sweeps, migrations, batch refactors): composer-2.5 or grok-4.5 via cursor-agent (grok audition 2026-07-08: passed a 9-file cross-module task with distinction — modifier-path suppression, circular-import defense, unprompted deterministic tie-breaking; prefer grok for trickier multi-file work, composer for pure mechanical) — it's effectively free and runs in an isolated worktree while you keep working.
- Anything user-facing (SwiftBar menu labels, spoken-text prompts, character copy) needs taste ≥ 7: sonnet-5 minimum, opus-4.8/fable-5 preferred. The Gemini system prompts in `gemini.ts` and `dynamic-response.ts` directly shape what gets spoken — treat prompt edits as user-facing work.
- Reviews of plans/implementations: fable-5 or opus-4.8, optionally composer-2.5 or gpt-5.x as an extra independent perspective (see the `codex-review` skill).
- Never use Haiku. For trivial work (classification, log filtering, glue, bulk edits), use composer-2.5 or gpt-5.x — they're effectively free and better.

Mechanics:

- **Check CLI availability before delegating** — `command -v agent` for cursor-agent, `command -v codex` for codex. If the CLI you want is missing, fall back to a Claude subagent via the Agent tool instead of telling the user to install anything.
- composer-2.5 runs through the cursor-agent CLI: `agent --worktree -p --force "prompt"` (see the `cursor-agent` skill for full flags, spec-file workflow, and output formats). Always pass `--force` for tasks that write code; default model is composer, or pin with `--model composer-2.5`.
- gpt-5.x runs through the codex CLI — `codex exec` / `codex review`. On this machine codex has the computer-use plugin set up and MCP servers connected (verify with `codex mcp list` if a task depends on a specific one). Use the `codex-review` and `codex-computer-use` skills; for work they don't cover (investigation, data analysis), run `codex exec -s read-only` directly with a self-contained prompt.
- Claude models (sonnet, opus, fable) run via the Agent/Workflow `model` parameter — no CLI needed.
- Codex runs can exceed Bash's 10-minute timeout: pass an explicit timeout, or run in the background and poll for the report file.
- Parallel implementation agents that write code must use `isolation: 'worktree'` so edits don't collide in the shared checkout.

Repo-specific rules for delegated agents:

- No `.env` in worktrees: cursor-agent `--worktree` checkouts don't inherit `.env` — copy it from the source checkout if the task needs live API calls (usually it shouldn't; see credit efficiency rules).
- Delegated agents must NOT make live Gemini/ElevenLabs calls unless the task is explicitly about synthesis; state this in every delegated prompt.
- Verification gate for code tasks: `cd tts-server && pnpm exec tsc --noEmit` clean, plus `bash -n` on any changed shell scripts. (No test suite or linter in this repo — don't add one unprompted.)

## Computer use / verifying this app

The app's output is audio + a menu bar UI, so "does it work" means triggering the pipeline and observing side effects:

1. Restart to pick up changes: `~/.cursor/tts/scripts/tts-server.sh restart` (syncs repo src, relaunches daemon).
2. Trigger cheaply: `echo "test one two" | ~/.cursor/tts/scripts/enqueue_manual.sh "Verify"` — this simulates the Claude Code hook without needing a real agent response.
3. Observe instead of listen: `tail -40 ~/.cursor/tts/logs/hook.log` shows the full pipeline (ingest → gemini → elevenlabs → audio); `~/.cursor/tts/replay/` gets an MP3 + JSON sidecar per playback (the sidecar's `textPreview` shows what was spoken); queue files move from `queue/` to `played/` on success.
4. SwiftBar UI checks (menu contents, replay section, toggles) need real computer use — screenshots of the menu bar dropdown. Shell out to codex via the `codex-computer-use` skill for this.
5. `signal.ts` actions can be invoked directly: `pnpm exec tsx src/signal.ts replay "" 1` replays the last message without any API calls — a free end-to-end audio check.

Launching the app, taking screenshots, and playing short test audio are fine without asking; ask first before anything that clears the queue, deletes replay history, or changes `~/.cursor/tts/config.json`.
