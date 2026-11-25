# Room of Devs (cursor-read-aloud)

@AGENTS.md

# Claude main-session guidance

Everything above (AGENTS.md) is the shared rulebook. It applies to every agent, including subagents. What follows is for the orchestrating Claude session only.

## Model roster overrides

These win over the default roster in `~/.claude/rules/fleet-model-roster.md`.

Session token hygiene: per-task cost is roughly context size times wakeup count. During big multi-stage efforts the main session writes specs, credit-guard-adjacent edits, targeted diff reviews and merges; delegates author the code. Recon goes to composer-2.5 or an Explore subagent, sonnet-5.5 when it takes judgment. Batch verification into ONE delegated round with the complete checklist. Ordinary small tasks: write the code directly.

Context and follow-ups: in a multi-turn main session that passes about 250k tokens, name a good compact point once; subagents and delegates never comment on context hygiene. Follow-up work discovered mid-task goes to the backlog, not the current session: file a GitHub issue (or an `ideas-backlog.md` line for an idea) with enough context to start cold, so the owner can kick it off in another worktree in parallel. Never "compact, then I'll start on B".

Delegate mechanics:

- Parallel code-writing agents use worktree isolation, split by file ownership so merges are trivial (docs/reference/worktree-parallel-flow.md).
- Every delegated prompt says: no live Gemini/ElevenLabs calls unless the task is about synthesis; cursor worktrees don't inherit `.env`. UI-building prompts state the shared-component requirement explicitly.
- Gate for code tasks: `pnpm exec tsc --noEmit` clean in `tts-server/` and `panel/` (when touched), `bash -n` on changed shell scripts.
- Check `command -v agent` / `command -v codex` first; probe cursor-agent with `agent -p -f "Reply with exactly: OK"` before a big round.
- Backgrounded `codex exec` needs `< /dev/null` (an open stdin pipe waits forever) and `-s workspace-write`; long runs exceed Bash's 10-minute timeout, so background them.
- cursor-agent `-p` runs can hang at 0% CPU after committing; check the worktree's git log (`~/.cursor/worktrees/<repo>/<branch>`) before assuming failure. `--output-format stream-json > run.jsonl` shows progress.
