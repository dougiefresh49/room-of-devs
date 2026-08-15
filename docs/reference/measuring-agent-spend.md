# Measuring agent token & time spend per project

Method distilled from the 2026-08 external-prototype accounting (see
[orchestration-field-test-2026-08.md](orchestration-field-test-2026-08.md)).
Useful for any project retro, and load-bearing for contract work where
model spend and unattended-vs-attended hours need to be billable facts,
not vibes.

## Claude: exact numbers from local transcripts

Claude Code writes per-message `usage` records into the session transcripts
under `~/.claude/projects/<project-dir>/**/*.jsonl`. Aggregate per model:

```bash
python3 - <<'EOF'
import json, glob, collections, os
d = os.path.expanduser("~/.claude/projects/<project-dir>")
agg = collections.defaultdict(collections.Counter)
for f in glob.glob(d + "/**/*.jsonl", recursive=True):
    for line in open(f, errors="ignore"):
        try: j = json.loads(line)
        except: continue
        m = j.get("message") or {}
        u = m.get("usage")
        if u and m.get("model"):
            c = agg[m["model"]]
            c["out"] += u.get("output_tokens", 0)
            c["cache_read"] += u.get("cache_read_input_tokens", 0)
            c["cache_write"] += u.get("cache_creation_input_tokens", 0)
            c["msgs"] += 1
for model, c in sorted(agg.items()):
    print(model, dict(c))
EOF
```

- `<project-dir>` is the dash-encoded repo path (e.g.
  `-Users-dougiefresh49-projects-<repo>`). Work that happened in a session
  opened from a *different* cwd lands under that other project dir — check
  for satellite sessions before calling a total complete.
- Top-level `*.jsonl` files are main sessions; nested ones are subagent
  transcripts.
- Expect cache reads to dominate raw volume (90%+ on long threads) — that's
  the long-session context tax, cheap per token but the thing token-hygiene
  rules reduce. Report output / cache-write / cache-read separately; a
  single "total tokens" number hides the structure.

## Time: transcript timestamps, never file mtimes

Every transcript event is timestamped. Bucket events hourly for an activity
histogram; split on gaps (>10 min) for active work blocks.

- **File mtimes give wrong answers** — they record writes, so they miss
  reading, discussion, and any block that produced no file. Verified wrong
  in the field test (missed a whole afternoon block). Use them only to
  corroborate a specific write.
- Wall-clock first→last event is session *age*, not work — an idle thread
  inflates it enormously (70× in one measured case). Sum active blocks.
- "Unattended hours" claims need a cross-check against the human's own time
  log — the field test's first estimate (~14.5 h unattended) collapsed to
  ~4.6 h once the Toggl log was overlaid. For contract work, unattended =
  agent active ∧ human logged elsewhere/away, computed, not eyeballed.

## Other providers

- **Codex DOES log exact token counts** — `~/.codex/sessions/**/rollout-*.jsonl`
  (falsified this doc's original claim; found by a fleet skill-probe
  2026-08-13 — the `spend-report` skill in the fleet repo has the
  corrected method). **Cursor leaves no token logs**; its numbers are
  derived from quota-percentage deltas: record the provider's usage %
  before and after the project (the `ai-usage` skill), and keep any known
  tokens-per-percent calibration. All recorded calibrations live in
  [field-test-artifacts/quota-calibrations.md](field-test-artifacts/quota-calibrations.md)
  (Sol ~55.7k tokens/1% weekly; fable ~35k output tokens/1% weekly on the
  $100 plan, ±30%; Cursor first-party and Gemini uncalibrated). Without a
  calibration, report the percentage and don't invent a token figure.
- **Gemini (video-analyzer etc.): capture `response.usage_metadata` at call
  time** — uploads get deleted and nothing is recoverable after the fact.
  One short calibrated clip yields a tokens-per-minute-of-video constant to
  extrapolate from.

## The routing lesson

The field test's headline: one provider can burn 8× the tokens of another
and still not be the binding constraint. Subscription shape (weekly caps,
pool boundaries — e.g. Cursor's first-party vs API pools) beats raw token
count for routing decisions. Express budget posture per-pool, and snapshot
all pool percentages at project start/end so the retro can state quota
impact exactly.
