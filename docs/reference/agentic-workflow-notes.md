# Agentic workflow notes — determinism, review gates, and where the room fits

Distilled 2026-07-27 from a framework exchange with a friend (his "Ptheory"
system) plus the full-stack audit it produced
(`docs/archive/reviews/ptheory-audit-2026-07-26.md`). The raw conversation is
private and stays out of the repo. These are durable principles, not a spec —
work items derived from them live in GitHub issues.

## The core principle: deterministic enforcement beats prompt rules

Prompt-level rules (CLAUDE.md prose) degrade under long context, compaction,
and delegated agents that never read them. A PreToolUse hook that hard-blocks
the tool call is immune to all of that. His system runs ~50 gate scripts
(contract gates, scope gates, test-evidence freshness, wave ordering); we only
need the handful of rules that have actually bitten us:

- Block Write/Edit into `~/.cursor/tts/` (the two-location gotcha).
- Block edits touching `gemini_model` / `elevenlabs_model_id` /
  `truncateForTTS` caps without an explicit override marker.
- Block repeated `enqueue_manual.sh` in one command (synthesis-loop guard).
- Guard delegated worktrees from `.env` / live API calls unless flagged.

Promotion ladder for any rule: prose → CLAUDE.md → deterministic hook. Each
promotion is earned by the rule actually mattering, not applied speculatively.

## The review bar: evidence that reproduces

The strongest idea in his review layer: recorded test evidence must reproduce
at its own commit, re-run by the reviewer — never trusted from the builder's
paste. (His example blocker: "recorded test evidence does not reproduce.")
Adopt as one line in every delegated-verify prompt.

## The Operator lens

His Architect/Operator split: the builder produces a contract (interfaces,
failure paths, evidence); a separate role with veto power reviews it *as the
person who must run the thing at 3am* — failure paths first, diff second —
and a BLOCKER actually blocks. We don't need the role hierarchy; we need the
posture. For big rounds: brief the reviewer with the spec's failure paths and
give blockers real stopping power.

## Ceremony mode is a gear, not a lifestyle

The full contract/wave ceremony (written contracts, operator sign-off,
runbooks, wikis) is built for handing work to strangers. Family-of-one work
stays fast and loose. But the room is a tool that builds *other* things, and
for client-grade work (potential contract gigs) the ceremony's outputs —
contracts, reproducible evidence, runbooks, decision logs — are deliverables
the client pays for. Treat ceremony as an optional gear the room can run in,
selected per project, not a repo-wide process change.

## Pinned roles beat ad-hoc prompts (for recurring jobs)

His 20-agent roster is checked-in agent definitions — the mechanism is just
`.claude/agents/*.md`. The benefit isn't the count; it's that every wave gets
the same reviewer with the same standards. Worth pinning only our recurring
roles (the verify-round reviewer first). Everything else stays dynamic.

## Issue-writing discipline (tracker = GitHub Issues)

Decided 2026-07-27: GH Issues over Linear for this repo — delegated agents
(codex, cursor-agent, babysitters) can all run `gh` from any worktree or
headless run, while Linear is MCP-only (interactive Claude sessions). Linear
stays in use on other projects for fluency. Milestones group rounds; Projects
(boards) deferred until wanted; the repo wiki stays unused (docs live
in-tree so agents in worktrees can read them).

Every issue carries: audit finding IDs (stable, citable), validation criteria
(the evidence-reproduces bar), and an authoritative reference where one
applies — WCAG for front-end findings, CISA/vendor advisories for security,
RFC 1918 / bind semantics for network exposure. Validate before filing:
reproduce the finding at the current commit.

## Where the voice layer sits (the room's own future)

The dialogue/voice agent belongs *above* the build loop, not inside it:
intake (PTT/interpreter routing — Stage 1 already live) plus surfacing.
Operator-style outputs (structured findings with severities, blockers,
decisions needing ratification) are exactly the payload the room should
narrate as spoken interrupts and collect signoffs on. Logged in
`ideas-backlog.md` ("Operator gates spoken by the room").

## Overclaim flags (for future exchanges)

"No hallucinations" / "100% certainty" from any framework means
*hallucinations get caught before deploy* — the achievable claim. The
"RAG pulls averages" theory is hand-wavy, but the instinct behind it —
verify against authoritative sources instead of trusting sampled output —
is sound and is what the doc-lookup enforcement actually does.
