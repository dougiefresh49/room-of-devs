# Room of Devs (cursor-read-aloud)

@AGENTS.md

# Claude main-session guidance

Everything above (AGENTS.md) is the shared rulebook. It applies to every agent, including subagents. What follows is for the orchestrating Claude session only.

## Working with models and delegates

Rankings, higher = better. Cost reflects what we actually pay (subscriptions with generous limits rank cheap). Intelligence is how hard a problem you can hand the model unsupervised. Taste covers UI/UX, code quality, API design and copy.

| model         | cost | intelligence | taste | reachable via                                                                |
| ------------- | ---- | ------------ | ----- | ---------------------------------------------------------------------------- |
| composer-2.5  | 8    | 5            | 5     | cursor-agent CLI (`agent`)                                                   |
| grok-4.5      | 8    | 6            | 6     | cursor-agent CLI (`--model cursor-grok-4.5-high`; `-medium`/`-low` lighter) |
| gpt-5.6 Sol   | 7    | 8            | 5     | codex CLI (`codex -m` Sol tier; the local default)                           |
| gpt-5.6 Terra | 8    | 7            | 5     | codex CLI (Terra tier; bare "gpt-5.6" in prose means Terra)                  |
| gpt-5.6 Luna  | 8    | 4            | 4     | codex CLI (Luna tier)                                                        |
| sonnet-5      | 5    | 5            | 7     | Agent/Workflow `model: 'sonnet'`                                             |
| opus-5        | 7    | 8            | 8     | Agent/Workflow `model: 'opus'`                                               |
| fable-5       | 2    | 9            | 9     | Agent/Workflow `model: 'fable'`                                              |

- Fable is the scarce resource: it drives the main session and burns the weekly budget fast. Sonnet is cheap and capable; use it liberally as a subagent. opus-5 was auditioned and lost (claimed-fixed-still-broken, degrades on long runs): use it only when neither Fable nor Sol has budget left. codex has plenty of headroom: lean on it, Sol for deep work (`-c model_reasoning_effort="high"`), Luna only for trivia. Throttle a provider only when `ai-usage` shows it near its cap; check `ai-usage` before a big delegation round.
- composer/grok via cursor-agent for mechanical and multi-file work (grok for the trickier jobs): `agent --worktree -p --force "prompt"`, non-fast variants. cursor-agent runs composer/grok by default: any other model through it bills the small Cursor API pool (the `api` metric, not `models`). Fable through cursor-agent is the overflow route when the Anthropic Fable budget is nearly out and `ai-usage` shows the Cursor `api` pool under 80%; the `cursor-agent` skill says how to list the current model ids.
- Never Haiku. Never agy/Antigravity (flaky headless).
- Defaults, not limits: redo a cheaper model's output with a smarter model when it misses the bar, without asking. When axes conflict on anything that ships: intelligence > taste > cost. User-facing work needs taste 7 or better (sonnet minimum, fable preferred); visual concept work goes to fable, or opus only as the budget fallback.
- Reviews: fable, with codex (Sol for deep reviews) or composer as an independent perspective (`codex-review` skill).

Session token hygiene: per-task cost is roughly context size times wakeup count. During big multi-stage efforts the main session writes specs, credit-guard-adjacent edits, targeted diff reviews and merges; delegates author the code (composer/grok/Terra for well-specced chunks, a fresh-context fable subagent when a chunk needs frontier judgment). Recon goes to composer or an Explore subagent. Batch verification into ONE delegated round with the complete checklist. Ordinary small tasks: write the code directly.

Context and follow-ups: in a multi-turn main session that passes about 250k tokens, name a good compact point once; subagents and delegates never comment on context hygiene. Follow-up work discovered mid-task goes to the backlog, not the current session: file a GitHub issue (or an `ideas-backlog.md` line for an idea) with enough context to start cold, so the owner can kick it off in another worktree in parallel. Never "compact, then I'll start on B".

Delegate mechanics:

- Parallel code-writing agents use worktree isolation, split by file ownership so merges are trivial (docs/reference/worktree-parallel-flow.md).
- Every delegated prompt says: no live Gemini/ElevenLabs calls unless the task is about synthesis; cursor worktrees don't inherit `.env`. UI-building prompts state the shared-component requirement explicitly.
- Gate for code tasks: `pnpm exec tsc --noEmit` clean in `tts-server/` and `panel/` (when touched), `bash -n` on changed shell scripts.
- Check `command -v agent` / `command -v codex` first; probe cursor-agent with `agent -p -f "Reply with exactly: OK"` before a big round.
- Backgrounded `codex exec` needs `< /dev/null` (an open stdin pipe waits forever) and `-s workspace-write`; long runs exceed Bash's 10-minute timeout, so background them.
- cursor-agent `-p` runs can hang at 0% CPU after committing; check the worktree's git log (`~/.cursor/worktrees/<repo>/<branch>`) before assuming failure. `--output-format stream-json > run.jsonl` shows progress.
