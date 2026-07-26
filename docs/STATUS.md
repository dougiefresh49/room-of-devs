# Room of Devs — STATUS

The single "where are we" page. Update at the end of every shipped
round; publish to the phone with `pnpm docs:publish`.

_Last updated: 2026-07-25_

## Inbox

Owner drop zone — bugs, findings, ideas, "next I want…". One bullet each,
no format rules. Sessions triage these: bugs → fixes/known issues, ideas →
the backlog, work → `active/` specs or Next up. Empty is the goal state.

- _(empty)_

## Now

- **UI consolidation round 2 — spec ready, awaiting owner OK**:
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
  Ghost state files cleaned. NOTE: **GitHub remote main is stale** (no
  push since before the refactor) — push pending owner go-ahead.

## Awaiting owner

- **Live mode v2 retest** — the Sesame-style call/chat redesign shipped
  2026-07-21; owner hasn't re-tested the full phone flow since the fixes.
- **Arcade button bring-up (#16)** — hardware-in-hand step (plug in the
  Fosiya encoder, run learn mode). Design:
  [active/design-arcade-button-controller.md](active/design-arcade-button-controller.md).
- **Mic TCC approval** for the panel (one-time macOS prompt).

## Next up (likely order)

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
This file is the only tracking surface — no external tools.
