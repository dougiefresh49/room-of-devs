# Decisions

One line per decision, newest first, written the moment it resolves (fleet `decision-record` skill). Statuses: `accepted` | `assumed (reopens when: ...)` | `open` | `unformed` | `superseded by N`. This file is a parking lot, not a history: standing rules live in CLAUDE.md as prose, and calls that predate the log were not backfilled (row 12).

| # | date | decision | status |
|---|------|----------|--------|
| 12 | 2026-08-27 | This log holds parked questions and new calls only; owner calls that predate it were folded into CLAUDE.md or dropped, not backfilled as rows, so the fleet "nothing is deleted" convention applies from this date forward | accepted |
| 11 | 2026-08-27 | Claude Code auto-memory is off for this repo: CLAUDE.md is the one durable layer for the dev workflow, memory files were archived and deleted (Theo's memory audit replicated here: 27 of 32 files never read in the surviving month) | accepted |
| 10 | 2026-08-27 | Product-side recall (Mikey remembering past conversations) is a room feature, separate from dev-workflow memory; leaning is an append-only log queried over the room's own transcripts and replay sidecars, not a vault | unformed |
| 9 | 2026-08-24 | Trial Obsidian as a viewer over `~/projects` docs (structure only; nothing at runtime) | open |
| 8 | 2026-07-30 | Whether to revert the RIG P2 panel visuals to pre-RIG (`git revert 97ab295 6e0e13e`) while keeping desktop typed chat, attachments and the reply-inject fix; also still wanted, a better word than "craft" | open |
| 7 | 2026-07-28 | Whether mobile Talk absorbs live mode (the one pending call that deletes shipped behavior; one Round C board assumed yes) | open |
| 6 | 2026-07-28 | Whether the tape (scrubbing) killed in candidate A comes back; no board resurrected it | open |
| 5 | 2026-07-28 | Watcher threads stay hard-gated until #75 (file-at-start + claim-at-start write-back) lands; un-gate when `tap-in.ts "is anyone working right now?"` names the thread and its ticket | open |
| 4 | 2026-07-23 | Hidden devs, output target and launch flags stay in localStorage rather than daemon-side prefs | assumed (reopens when: a daemon-side prefs migration is scheduled) |
| 3 | 2026-07-22 | Queue files from long-dead sessions (no state file) are left in `queue/` rather than auto-aged into `failed/`; queue admission is credit-sensitive and wants an awake owner | open |
| 2 | 2026-07-21 | Desktop live is indicator-only (LiveBadge); thread/composer components stay portable for a later port | assumed (reopens when: the desktop call/chat port is scheduled) |
| 1 | 2026-07-19 | Hold the full Terminal → tmux migration of the owner's sessions until spawn/reply and grant-supersede are proven in practice | open |
