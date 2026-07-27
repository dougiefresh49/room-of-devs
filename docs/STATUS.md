# Room of Devs — STATUS

The single "where are we" page. Update at the end of every shipped
round; publish to the phone with `pnpm docs:publish`.

_Last updated: 2026-07-27_

## Inbox

Owner drop zone — bugs, findings, ideas, "next I want…". One bullet each,
no format rules. Sessions triage these: bugs → fixes/known issues, ideas →
the backlog, work → `active/` specs or Next up. Empty is the goal state.

- _(empty)_

## Now

- **Ptheory audit triaged → GitHub Issues (2026-07-27)**: a friend's
  framework ran a full-stack audit — 106 findings, saved verbatim at
  [archive/reviews/ptheory-audit-2026-07-26.md](archive/reviews/ptheory-audit-2026-07-26.md)
  (stable finding IDs; issues cite them). Principles distilled to
  [reference/agentic-workflow-notes.md](reference/agentic-workflow-notes.md).
  Plan is three sequential rounds, tracked as **GitHub milestones**
  (issues are the work surface for fix sessions; `gh issue view` has
  everything, no session context needed):
  1. **Round A — criticals & quick wins**: perimeter (LAN bind /
     token handling / skip-permissions default), deploy safety
     (characters.json, repo-root default, lockfile pinning), sub-20-line
     reliability fixes (P-1, P-3, P-4, C-4), hook-layer security batch.
  2. **Round B — foundation**: CI floor (typecheck + fixtures +
     both-validators), Biome, contract single-sourcing (Q-1), panel
     error-handling parity with mobile, a11y batch via @room/ui
     primitives, TTS_DIR instance-isolation sweep (enables containers +
     parallel worktree instances), PreToolUse enforcement hooks.
  3. **Round C — UI redesign round 2** (spec unchanged, executes on the
     Round B substrate). R6/R7 architecture epics filed but sequenced
     after all three.
  Verdicts on your machine: C-3 is a clone-path false positive locally;
  C-2 doesn't bite while your local characters.json exists (still fixing
  both). Firewall check 2026-07-27: node has an "allow incoming" rule,
  so 4785 IS LAN-reachable despite the firewall — C-1 stands.
- **UI consolidation round 2 — spec ready, ON HOLD behind Rounds A/B**
  (was: awaiting owner OK):
  deep-module audit ran 2026-07-24 with the codebase-design skill
  (mattpocock/skills now installed in ~/.claude/skills). Headline: nine
  concepts built twice, transport controls ×4, style.css is 2,465 lines
  and the top churn file. Plan = promote-and-replace (PlayerControls →
  AgentCard → PickerFlow, deleting each style.css bucket on adoption):
  [active/spec-ui-consolidation-round2.md](active/spec-ui-consolidation-round2.md).
  Owner leaning yes ("I think number 1"); confirm before lanes launch.
  Prior concerns doc:
  [active/ui-architecture-concerns-2026-07-24.md](active/ui-architecture-concerns-2026-07-24.md).
- **Design concept boards — 20 total; FINAL synthesis round done,
  awaiting owner review + picks**: 4 blind-detailed + 4 synthesis +
  4 wildcard + 4 wildcard-2 + **4 final-synthesis** (2026-07-25:
  each model fused all prior rounds, anonymized, future goals
  structural). Final boards:
  [fable "The Den"](https://6jox1hvrceaf.postplan.dev) ·
  [opus](https://d7wpykv0js50.postplan.dev) ·
  [sol "Workbench"](https://v059dy7f78r7.postplan.dev) ·
  [grok "Floor & Table"](https://ifjfe2tv0zim.postplan.dev).
  fable + opus converged on the same floor/table/tape skeleton. All
  20 grouped on the Postplan dashboard
  (`room-of-devs-ui-concepts`); URLs + notes in the round-2 spec.
  After picks: real React+shadcn mock → lock `design-ui-target.md`.
- **Parallel round 1 MERGED + DEPLOYED** (overnight 2026-07-23→24):
  interpreter Stage 1 (spec now shipped-in-code; codex visual verify
  round pending report), panel parity fixes (icons, speaking-card clip,
  new-session confirm, transport bar removed), mobile sheet fixes
  (overflow/model picker, spawn confirm), plus the mobile spawn-failure
  fix (ghost cards + toasts). Daemon restarted, panel reinstalled,
  mobile dist rebuilt. Codex visual round: 6/8 pass; the speaking-card
  finding led to a follow-up (card scrolls into view when it starts
  speaking — shipped). Owner confirmed the phone New flow looks good.
  Ghost state files cleaned. Remote main caught up 2026-07-27
  (ui-consolidation-round2 fast-forwarded into main and pushed).

## Awaiting owner

- **Live mode v2 retest** — the Sesame-style call/chat redesign shipped
  2026-07-21; owner hasn't re-tested the full phone flow since the fixes.
- **Arcade button bring-up (#16)** — hardware-in-hand step (plug in the
  Fosiya encoder, run learn mode). Design:
  [active/design-arcade-button-controller.md](active/design-arcade-button-controller.md).
- **Mic TCC approval** for the panel (one-time macOS prompt).

## Next up (likely order)

0. **Audit Rounds A → B → C** — see Now; issues + milestones on GitHub.
1. **Conversational layer** ("dev in the room") — consensus design:
   [active/design-conversational-layer.md](active/design-conversational-layer.md);
   **Stage 1 build spec ready**:
   [active/spec-interpreter-stage1.md](active/spec-interpreter-stage1.md).
2. **Phone image attachments** in live mode.
3. Cross-persona spawn race + subagent-finish announce filtering (small
   daemon fixes — see backlog).

## Someday

See [reference/ideas-backlog.md](reference/ideas-backlog.md) — cmux
evaluation, Android wrapper app, mobile lip-sync, multi-agent conference
mode, Donnie avatar art cleanup, and more.

## Recently shipped

| When       | What                                                                  |
| ---------- | --------------------------------------------------------------------- |
| 2026-07-23 | Refactor Phases 6-7: legacy deletion (mobile.html, SwiftBar), audio/hid splits |
| 2026-07-22 | Mock live harness (free live-mode regression testing)                 |
| 2026-07-21 | Live mode v2 — call + chat views, /thread history, activity feed      |
| 2026-07-19 | Mobile v2.3 — live streaming to phone, speed button, launch flags     |
| 2026-07-08 | Room of Devs Phases 1-4 — panel, personas, replies, team sessions     |

## How docs/ is organized

| Folder       | Meaning                                                        |
| ------------ | -------------------------------------------------------------- |
| `active/`    | Designs/specs for work not yet built — the queue               |
| `shipped/`   | Specs whose feature landed — history, kept for reference       |
| `archive/`   | Superseded specs, old plans, review rounds — read-only past    |
| `reference/` | Evergreen: ideas backlog, testing guides, long-term vision     |
| `mockups/`, `media/` | Assets referenced by docs and README                    |

Rules: a spec moves `active/` → `shipped/` when its feature deploys;
superseded docs get a pointer line at the top and move to `archive/`.
This file is the "where are we" surface; per-task tracking for the
audit rounds lives in GitHub Issues/milestones (agents reach it via
`gh` from any worktree). Repo wiki intentionally unused — docs stay
in-tree so delegated agents can read them.
