# Testing live mode

## Lane 1: free mock harness

Use this lane first. It never synthesizes audio: transcript decisions use `live-tail.ts once`, and streaming copies the smallest existing cached replay clip.

From `tts-server/`:

```bash
pnpm exec tsx scripts/mock-live.ts up "Mock Live"
pnpm exec tsx scripts/mock-live.ts activity <mock-id> "reading files"
pnpm exec tsx scripts/mock-live.ts tools <mock-id> 2
pnpm exec tsx scripts/mock-live.ts final <mock-id> "A held final message."
pnpm exec tsx scripts/mock-live.ts stream <mock-id> --output phone --rate 16000
pnpm exec tsx scripts/mock-live.ts down --all
```

`stream` refuses to mutate now-playing while the stream lock exists or a fresh, active non-mock frame exists. It never starts a player. Run fixture regression checks with `pnpm run check-live-fixtures` at the repository root. Always finish manual testing with `down --all`.

## Lane 2: owner-approved bounded paid smoke

CLAUDE.md’s policy says:

> “To test live/call features end-to-end, spawn or reuse a dedicated team session on a cheap model (`sonnet`/`haiku` — e.g. in the agent-usage-bar project), keep its prompts short ("reply in one sentence"), cap a run at a handful of clips, and prefer delegating the whole interact→listen→verify→fix loop to codex computer use so the owner isn't the test rig.”

This lane is only for synthesis behavior that the free lane cannot prove; it does not permit repeated or unbounded synthesis. Obtain owner approval before entering it.
