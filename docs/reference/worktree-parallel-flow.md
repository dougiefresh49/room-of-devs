# Worktree parallel flow

How to run multiple workstreams on this repo at once without them
trampling each other or the live install. Written 2026-07-23.

## The constraint that shapes everything

This is not a web app where each worktree runs its own dev server on its
own port. There is exactly **one deploy target**: one daemon
(`~/.cursor/tts/`), one installed Room.app, one phone. Worktrees
parallelize *development*; anything that requires a deploy
(`tts-server.sh restart`, `setup.sh`, panel install, phone testing) is
**serialized through main**. Corollary: a worktree agent must NEVER
restart the daemon, run setup.sh, or write into `~/.cursor/tts/` — only
the integrator (the main session, on main) deploys.

## Roles

- **Integrator** — the main Claude session, on the main checkout. Writes
  specs, defines lane boundaries, merges, runs the one deploy + verify
  round. Does not author lane code during a parallel round (session
  token hygiene).
- **Lane** — one worktree + one delegated agent + one written spec.
  Develops and self-verifies with free checks only, leaves work
  committed on its branch (or as a clean diff), reports once.

## Mechanics

Three ways a lane gets its worktree — all equivalent underneath:

1. `agent --worktree -p --force "<prompt>"` — cursor-agent (composer/
   grok) manages its own worktree. Gotcha: it does NOT inherit `.env`
   (rarely needed; lanes shouldn't make live API calls anyway).
2. Agent tool with `isolation: "worktree"` — Claude subagents
   (sonnet/opus/fable) get an auto-managed worktree, auto-cleaned if
   untouched.
3. Manual: `git worktree add ../cra-<lane> -b lane/<name>` — for work
   the owner or integrator drives by hand. `git worktree remove` when
   merged. Keep them OUTSIDE the repo (sibling dirs, `cra-` prefix) so
   watchers/globs never see them.

Per-worktree setup: `pnpm install` (fast — pnpm's shared store means
mostly hardlinks). Everything runs via tsx/vite, so there's no build
artifact to fight over except the two below.

## The two artifact rules

1. **`packages/mobile/dist/` is committed on main but BANNED in lane
   branches.** Lanes edit `packages/mobile/src` only and never run the
   build; the integrator rebuilds dist ONCE on main after merging all
   mobile-touching lanes. (Parallel dist rebuilds = guaranteed binary
   conflicts and hash-named bundle churn.)
2. **Panel bundles are never built in lanes for install.** `pnpm tauri
   dev` from a worktree is fine for HMR-driven UI work (it's a local
   dev window, not the installed Room.app — but note it shares the real
   daemon's WebSocket, so it sees live room state; look, don't mutate).
   `panel-dev-install.sh` / `tauri build` + install happen only from
   main.

## Lane boundaries (avoiding merge pain)

Split lanes by **file ownership**, not by feature slice. Good lane
shapes: daemon-only feature; panel-only UI round; mobile-only UI round;
scripts/docs. Before launching, the integrator names which top-level
areas each lane owns; two lanes never own the same file.

**Hot files** — small shared surfaces that many features want to touch:
`packages/protocol/src/*` (wire contract), `services/commands.ts`
(command registry), `packages/ui/src/tokens.css` (color authority),
`config.ts` (Config interface), `index.ts` (daemon wiring), `state.ts`.
Rules: (a) at most ONE lane per round may touch a given hot file; (b) if
two lanes genuinely need the same hot-file change, the integrator lands
that change on main FIRST and both lanes branch from it; (c) protocol
changes stay additive (the refactor's envelope rules).

## Verification tiers

- **Tier 1 — in-lane, free, required**: `pnpm exec tsc --noEmit`
  (tts-server/ and panel/ when touched), `bash -n` on shell scripts,
  `pnpm check-fixtures` if protocol touched, `vite build` dry-compile
  for mobile/panel TS, CLI dry-runs (`voice.ts route --dry-run`,
  `live-tail.ts once`, mock-live harness), component work eyeballed via
  `tauri dev` / `vite dev`. No Gemini/ElevenLabs calls, ever, in a lane.
- **Tier 2 — integration, serialized, once per round**: integrator
  merges lanes into main one at a time (typecheck between merges),
  rebuilds mobile dist if needed, deploys (`tts-server.sh restart`,
  setup.sh / panel install only if those layers changed), then ONE
  batched verify round per the CLAUDE.md "Verifying this app" section —
  ideally delegated to codex with the complete checklist covering all
  merged lanes.

## Round shape (the whole loop)

1. Integrator: write/collect specs, define lanes + file ownership, note
   hot-file conflicts, land any shared prerequisite on main.
2. Launch lanes in parallel (cursor-agent worktrees and/or Agent-tool
   worktree subagents; model per the CLAUDE.md rubric — taste ≥ 7 for
   user-facing UI).
3. Lanes report; integrator reviews diffs (targeted review, not
   re-authoring), merges sequentially, resolves the trivial conflicts
   that file-ownership discipline should have made rare.
4. One deploy + one fat Tier 2 verify round. Fix-ups are small surgical
   edits on main or one follow-up lane.
5. Update STATUS.md, offer the owner a /clear point.

Round size guidance: 2-4 lanes. Beyond that, integration review — not
development — becomes the bottleneck, and the verify checklist stops
fitting in one round.

## Owner-driven parallel work

The owner can hold a personal worktree (`git worktree add ../cra-mine`)
for hand-edits while agent rounds run — same rules apply: free checks
in the worktree, deploy only from main. If a Claude session is open in
a worktree, tell it so — its edits land on the lane branch, and
`~/.cursor/tts` paths still refer to the ONE live install.
