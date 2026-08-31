# Decisions

One line per decision, newest first, written the moment it resolves (fleet `decision-record` skill). Statuses: `accepted` | `assumed (reopens when: ...)` | `open` | `unformed` | `superseded by N`. This file is a parking lot, not a history: standing rules live in CLAUDE.md as prose, and calls that predate the log were not backfilled (row 12).

| # | date | decision | status |
|---|------|----------|--------|
| 34 | 2026-08-31 | The Obsidian trial is dropped; Postplan is the good-enough reading layer, and vault-style doc structure being adopted is what reopens it | accepted |
| 33 | 2026-08-31 | TITAN replaces "craft"; the star map becomes the frontier map (phases as hardpoints on one surface; drop = claim-at-start, eject = needs-owner, evac = settle), recorded in design-ui-target.md | accepted |
| 32 | 2026-08-31 | The P2 console stays deployed as-is, no pre-RIG revert; the framework build replaces the panel wholesale | accepted |
| 31 | 2026-08-31 | Mobile Talk absorbs live mode: live becomes a property of what you're talking to, not a separate mode; per-session tap-in may return in the RIG build if Mikey can't surface a specific in-flight session, and no 1-1 port is expected | accepted |
| 30 | 2026-08-30 | The tape stays killed; ReplayHistory as "recently spoken" is its honest version, and catch-up is the concierge's job | accepted |
| 29 | 2026-08-30 | Claim-at-start approved (#75): threads set `state/working` plus a claim comment at start, clear at settle; watcher threads un-gate when tap-in names an in-flight thread and its ticket | accepted |
| 28 | 2026-08-30 | Client prefs (hidden devs, launch flags) stay in localStorage; the output toggle is per-client by design (billing safety) | accepted |
| 27 | 2026-08-30 | Queue items age out at 3 days as dismissed (moved to `played/`), never failed; mobile gets a dismiss on raised-hand cards and a clear for the failed badge (#77) | accepted |
| 26 | 2026-08-30 | The mobile call/chat views never port to desktop; desktop live stays indicator-only until the concierge layer replaces per-session narration | accepted |
| 25 | 2026-08-30 | The Terminal → tmux migration is retired: T3 Code is the reply surface for the owner's own sessions, tmux stays as the persona spawn lane, terminal-tab sessions stay speak-only | accepted |
| 24 | 2026-08-29 | The STATUS "Now" section was deleted rather than ported (git keeps it); the decisions it held without a row were recovered as rows 17-23, dated from the source; row 12's no-backfill stance otherwise stands | accepted |
| 23 | 2026-08-01 | Round D: the fable board is the base with 14 opus grafts; the hangar is the boot rung; stock lamps report the generated manifest over the spec's prediction | accepted |
| 22 | 2026-07-30 | The design target locks in a siloed mock-data prototype (`prototype/`) before the live UI is refactored into shared components; incremental reskins of the live app are retired as the approach (the P2 console reskin stays deployed, row 8) | accepted |
| 21 | 2026-07-29 | THE RIG (industrial, Titanfall 2) is the design target; BLACK // GLASS and the other Round C boards are kept as resurrection material for a future theme system | accepted |
| 20 | 2026-07-28 | Interpreter roll-ups: tracker-derived ones (what shipped, what's waiting, what's blocked, which ticket, is anyone working) are safe at flash tier; STATUS-prose roll-ups stay gated (a code-shaped gap); `recommend`/`prioritize` escalate to a frontier tier | accepted |
| 19 | 2026-07-28 | tap-in dumps the whole spine into context (zero retrieval failures in validation); ContextDB stays parked | assumed (reopens when: tap-in retrieval fails on a spine question) |
| 18 | 2026-07-28 | Tracker vocabulary is `state/*` (one per issue) plus `gear/*`; `type/*` labels deliberately not created | accepted |
| 17 | 2026-07-28 | Architecture target (#73): Option B generalized (architecture-concepts 04-05): one always-on concierge voice above the interpreter, GitHub issues as the spine, mortal orchestration threads (build, one-off, watcher), silent workers, three dials with brain tier as a routing table plus cost log (never model-self-assessed); rejected Mikey-as-orchestrator, three-voice huddles, and the voice+KB chatbot shape | accepted |
| 16 | 2026-08-29 | Character voice extraction and casting live in the private `~/projects/voice-lab` repo (audio stays in `~/Movies/library/voice-lab`); the room consumes approved clone sources and ElevenLabs ids from there, comic-reader keeps the EL slot manager for now (voice-lab decisions 2 and 3) | accepted |
| 15 | 2026-08-27 | Follow-up work found mid-task is filed to the backlog with cold-start context so the owner can run it in another worktree, never queued behind a compact; the main session names a compact point once past ~250k tokens and delegates never comment on context | accepted |
| 14 | 2026-08-27 | Fable through cursor-agent is the overflow route when the Anthropic Fable budget is nearly out and the Cursor `api` pool is under 80% (`ai-usage`); otherwise cursor-agent runs composer/grok | accepted |
| 13 | 2026-08-27 | opus-5 was auditioned and lost; use it only when neither Fable nor Sol has budget left (reviews, visual work and frontier subagents go to fable) | accepted |
| 12 | 2026-08-27 | This log holds parked questions and new calls only; owner calls that predate it were folded into CLAUDE.md or dropped, not backfilled as rows, so the fleet "nothing is deleted" convention applies from this date forward | accepted |
| 11 | 2026-08-27 | Claude Code auto-memory is off for this repo: CLAUDE.md is the one durable layer for the dev workflow, memory files were archived and deleted (Theo's memory audit replicated here: 27 of 32 files never read in the surviving month) | accepted |
| 10 | 2026-08-27 | Product-side recall (Mikey remembering past conversations) is a room feature, separate from dev-workflow memory; leaning is an append-only log queried over the room's own transcripts and replay sidecars, not a vault | unformed |
| 9 | 2026-08-24 | Trial Obsidian as a viewer over `~/projects` docs (structure only; nothing at runtime) | superseded by 34 |
| 8 | 2026-07-30 | Whether to revert the RIG P2 panel visuals to pre-RIG (`git revert 97ab295 6e0e13e`) while keeping desktop typed chat, attachments and the reply-inject fix; also still wanted, a better word than "craft" | superseded by 32, 33 |
| 7 | 2026-07-28 | Whether mobile Talk absorbs live mode (the one pending call that deletes shipped behavior; one Round C board assumed yes) | superseded by 31 |
| 6 | 2026-07-28 | Whether the tape (scrubbing) killed in candidate A comes back; no board resurrected it | superseded by 30 |
| 5 | 2026-07-28 | Watcher threads stay hard-gated until #75 (file-at-start + claim-at-start write-back) lands; un-gate when `tap-in.ts "is anyone working right now?"` names the thread and its ticket | superseded by 29 |
| 4 | 2026-07-23 | Hidden devs, output target and launch flags stay in localStorage rather than daemon-side prefs | superseded by 28 |
| 3 | 2026-07-22 | Queue files from long-dead sessions (no state file) are left in `queue/` rather than auto-aged into `failed/`; queue admission is credit-sensitive and wants an awake owner | superseded by 27 |
| 2 | 2026-07-21 | Desktop live is indicator-only (LiveBadge); thread/composer components stay portable for a later port | superseded by 26 |
| 1 | 2026-07-19 | Hold the full Terminal → tmux migration of the owner's sessions until spawn/reply and grant-supersede are proven in practice | superseded by 25 |
