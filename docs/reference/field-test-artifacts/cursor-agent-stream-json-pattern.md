<!-- Artifact 2: exact launch + poll commands for background cursor-agent
delegation, as actually run this project. Cited by retro §2.6 (stream-json
monitoring) and §1 (worktree-per-issue delegation). -->

# Background cursor-agent delegation — launch + poll pattern

Why: plain `agent -p` buffers ALL output until the end, so a background run
looks dead while working — and a run that hangs composing its final report
produces nothing at all. stream-json emits per-tool events in real time.

## Launch (as run for issues #16 and #67, PRs #65/#68)

```bash
# From the orchestrator session, repo root. Spec file written first
# (see delegate-spec-task-67.md). --force is required for writes;
# --worktree isolates at ~/.cursor/worktrees/<repo>/main-*.
agent --workspace "$PWD" --worktree -p --force \
  --model cursor-grok-4.5-high \
  --output-format stream-json \
  "Read <scratchpad>/task-67.md and do exactly what it says." \
  > <scratchpad>/run-67.jsonl 2>&1 &
```

Model flag: omit for composer-2.5 (default), `cursor-grok-4.5-high` for
trickier multi-file work. Never the `-fast` variants (same model, extra
quota).

## Poll (cheap, any time — no tailing session context away)

```bash
# Is it alive / what phase? Last few event types:
tail -5 <scratchpad>/run-67.jsonl | jq -r '.type + " " + (.subtype // "")'

# Activity volume so far:
grep -c '"tool_call"' <scratchpad>/run-67.jsonl

# What files has it touched? (writes only)
grep '"writeToolCall"' <scratchpad>/run-67.jsonl \
  | jq -r '.tool_call.writeToolCall.args.path' | sort -u

# Done? Non-empty means finished; prints the final report:
grep '"result"' <scratchpad>/run-67.jsonl | jq -r '.result'
```

## Known hang mode

If events stop but the process is alive, check the worktree's `git log`
directly — the work is often already committed (post-commit report hang):

```bash
ls -t ~/.cursor/worktrees/<repo>/ | head -3
git -C ~/.cursor/worktrees/<repo>/main-XXXX log --oneline -3
```

## Harvest (worktree → PR without disturbing the delegate's tree)

```bash
cd ~/.cursor/worktrees/<repo>/main-XXXX
git push origin HEAD:refs/heads/issue-67-magic-button
# then gh pr create from the main checkout, body "Closes #67"
```

## Watchdog rule learned from PR #69 (retro E3)

Arm two deadlines on anything external: ~5 min for an ack, ~15 min for
completion; on either expiry fall back (for reviews: local
`agent -p --trust --mode=ask --model composer-2.5` over the PR diff, post
the verdict, proceed). Never watch only the success signal.
