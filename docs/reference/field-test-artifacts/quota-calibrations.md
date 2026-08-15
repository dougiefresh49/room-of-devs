<!-- Artifact 6: every quota calibration recorded during this project —
session memory + CLAUDE.md/skill notes + billing-doc measurements, in one
place. Cited by retro §1 (model routing) and the spend/billing docs. -->

# Quota calibrations (all recorded values)

## OpenAI / codex

- **~55.7k gpt-5.6 Sol tokens ≈ 1% of the 7-day quota** (≈5.6M tokens per
  full window). User-measured 2026-08-07: ~390k Sol tokens (252k
  implementation + 135k computer-use verification) moved the window
  85% → 92%. Budgeting rule: est. tokens ÷ 55.7k = % of window;
  cross-check against the live `ai-usage` percentage before a round.
- Project total: 2.82 full weekly windows ≈ 15.7M tokens (on the $20/mo
  plan ≈ $4.62/wk ⇒ ~$13 marginal cost for the whole project).

## Cursor

- **Two separate pools.** Only first-party models (composer, grok) draw
  from the generous "First-party models" quota. Every other model routed
  through cursor-agent (Claude, GPT) bills the much smaller **"API"**
  pool — observed: a single fable design lane moved the API pool ~20
  points. Hence the standing rule: cursor-agent is composer/grok only;
  frontier models go through the Agent tool or codex.
- `-fast` model variants burn extra quota for the same model — never use.
- Project total: ~15–20% of the month on the $20/mo plan (~$3–4).
- No tokens-per-percent calibration exists for the first-party pool —
  cursor-agent logs no token counts. Open item for the framework: measure
  one sized run against the `ai-usage` `models` metric to get one.

## Claude

- Project totals on the $100/mo plan: **~50% of weekly Fable usage, ~30%
  of total 7-day usage** = 1.73M fable output + 263k opus + 23k sonnet
  output tokens (exact, from transcripts), plus ~371M cache reads.
  Implied rough rule: **~35k fable output tokens ≈ 1% of the weekly fable
  pool on the $100 plan** (1.73M ÷ 50) — derived from one project, treat
  as ±30%.
- Cache reads dominate raw volume ~200:1 over output in a long
  orchestrator session; the cost lever is context length, not turn count.
- Main-session context is the scarce resource; subagents (opus/sonnet) are
  comparatively free game.

## Gemini

- Not calibrated. The rewrite action (flash-lite) and the 33-min video
  analysis (flash, high media resolution) never logged
  `usage_metadata` — framework fix: capture it per call, then one short
  clip yields a tokens-per-video-minute constant.

## Routing thresholds (from the ai-usage skill, applied all project)

- ≥90% of a window = exhausted → route to another provider until reset.
- 75–90% = constrained → no heavy fan-out on that provider; light single
  calls OK. (This is what cut codex to zero for Phase 2 at 82%.)
- Short window governs "right now"; long window governs sustained use —
  conserve on the long window even when the short one looks fine.
