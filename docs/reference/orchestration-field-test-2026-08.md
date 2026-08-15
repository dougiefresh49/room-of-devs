# Orchestration field test — external prototype run, 2026-08

Lessons from running the portable orchestration kit on an external prototype
repo (a design-driven Next.js prototype built with a collaborator, 2026-08-06
→ 08; 36 merged PRs, 35 closed issues, 170 tests). The project itself stays
out of this repo; what's captured here is what the run taught us about the
room-of-devs underlying framework — contracts, flows, monitoring, hooks.
Companion to [agentic-workflow-notes.md](agentic-workflow-notes.md) (the
Ptheory principles); this is what actually happened when we ran a full
plan→issues→async-agents cycle in the wild.

Sources: the owner's own observations plus the run's orchestrator
retrospective (`docs/retro-orchestration.md` in the prototype repo — full
root-cause per escape, cited to issue/PR numbers) and its token/time
companion (`docs/retro-token-time-spend.md`; measurement method preserved
here as [measuring-agent-spend.md](measuring-agent-spend.md)).

## The portable kit (what we set up, and that it worked)

Bootstrapping a fresh repo took one session and the shape held up:

1. **AGENTS.md is the shared rulebook, CLAUDE.md is `@AGENTS.md` + an
   orchestrator layer.** Everything every agent needs (stack rules, sources
   of truth, code style, issue labels, the PR workflow) lives in AGENTS.md —
   which codex and cursor-agent read by convention, so delegated prompts
   shrink to "read AGENTS.md, then do issue #N." CLAUDE.md adds only
   main-session concerns: model roster, token hygiene, delegation mechanics.
   Confirmed in the run: cold agents (grok via cursor-agent, an opus
   subagent) produced right-stack right-style work without restated rules.
   The retro's sharpest observation: the single best property is that the
   rules were *checked in*, so every worktree got them for free.
2. **Context capture before planning is the whole ballgame.** The kickoff
   meeting was screen-recorded and converted (video-analyzer) into
   timestamped transcripts with per-segment visual descriptions, plus an
   index mapping on-screen design-frame names → real Figma node ids. Every
   issue could cite its design nodes + transcript timestamps, and at least
   one design dispute was settled deterministically by quoting the
   stakeholder's own recorded words instead of re-asking. Reusable pattern:
   requirements-as-artifact (transcript + node index) > requirements
   re-explained per prompt.
3. **Issues are specs.** Bodies carried design node ids, transcript
   pointers, mock-data contracts, acceptance criteria; "point an agent at
   #N and say go" worked cold repeatedly (6-minute and 3-minute delegated
   builds). `free-rein`/`blocked` labels + the re-label-on-close duty kept
   the backlog self-serve — no per-task dispatcher decision.
4. **Vendor the sources of truth into the repo.** When Figma MCP got
   quota-blocked mid-run, a committed REST snapshot (spec JSON + PNGs keyed
   by node id) kept delegates unblocked. Agent access to a source of truth
   must never be a live-service dependency. Corollary learned via a blown
   delegate context: shard vendored artifacts by lookup key from the start
   (one giant spec.json → per-node files).
5. **Worktree-per-issue + file-ownership splits in the delegate spec**
   ("Files you own / Do NOT touch") → zero merge conflicts across 36 PRs.
   Ownership decided at spec time, not merge time.
6. **Every gate needs a human-free fallback.** When the hosted PR reviewer
   went unresponsive, a local cursor-agent composer review of the diff
   posted via `gh pr comment` kept the review gate real. Bake in from day
   one: trigger hosted → arm a timeout → fall back to local CLI review.

## The escapes, root-caused (from the orchestrator retro)

Five escapes reached the owner. Full detail with issue/PR citations lives
in the prototype repo's retro; the classes and their mechanical fixes:

### E1/E4 — design-contract misses (2 of 5 owner-QA findings)

A control group shipped horizontal where the design showed vertical; a
picker shipped visibly unlike its frame. The workflow *said* side-by-side
verification, but the check was self-attested by the builder — who compared
against its own reading of the schema, never the design — and the reviewer
reviewed the *diff*, not the *design*. The ban on "looks roughly right"
existed in AGENTS.md and changed nothing, because it had no artifact
requirement enforcing it.

**Fix (highest-leverage in the whole retro):** a separate design-verifier
agent that receives *only* the two images (implementation screenshot +
design PNG) and the node id — never the builder's summary — and whose
pass/fail verdict is a required PR check. Deterministic trigger: PR touches
UI paths.

### E2 — behavior verified at the wrong layer

A plan toggle worked at the state layer (store, localStorage, `data-plan`
asserted in tests) but its label was hardcoded, so clicking produced no
visible change. Declared feature-complete; the owner found it dead. Precise
inverse of E1: E1 verified pixels without behavior, E2 verified behavior
without pixels. Worse: the orchestrator then *documented* the imagined UI
("shows FREE") — attestation compounding into false instructions.

**Fix:** for every interactive control, capture before/after screenshots of
the interaction and diff them; a pixel-identical pair on a state-changing
control is an automatic fail. Near-zero ceremony — the screenshots are
already being taken.

### E3 — the 20-minute monitor stall

A hosted review was triggered; the monitor watched only for the success
signal (a review comment). Silence was indistinguishable from "still
thinking" — no ack check, no deadline — until the *owner* noticed. An
unacknowledged external dependency has no terminal state at all.

**Fix:** two-stage timeout on any external-agent wait: ack timeout (~5 min
— has the service visibly started?) and completion timeout (~15 min — fire
the fallback automatically). The fallback existed; it just wasn't armed.
Monitors are dumb sensors; the orchestrator owns the clock. This belongs in
the daemon/hook layer as deterministic behavior, not prompt prose.

### E5 — no gate on external-config mutation

The orchestrator disabled production deployment protection on an inference,
without checking for alternatives or asking. Code changes had five gates;
infrastructure changes had none. **Fix:** infra/prod-config mutations
require recorded owner sign-off or a read-only investigation first — the
evidence bar for "change prod" is *higher* than for "change code."

### Also learned twice: synthetic input lies in both directions

JS `element.click()`/RTL passed on a UI that was unclickable with a real
pointer (0px-tall header); CDP `fill()` bypassed React onChange and made a
working feature look broken (~30 min lost on a false alarm). **Rule: UI
verification uses real pointer/keyboard events, never synthetic
click()/fill().** The verification log names the input method.

## The through-line

All the escapes are one disease: **the contract existed but nothing
deterministically enforced it.** Prose rules degrade exactly when it
matters. The retro's most transferable finding is the asymmetry: *builders
over-deliver when the spec is tight; verifiers under-verify unless forced
to produce artifacts.* Delegated implementation was consistently
trustworthy; delegated or self-performed verification was the weak layer —
and the review layer caught real bugs when it ran, so the gates are worth
having; they just have to be armed.

The orchestrator's own closing rule, adopt verbatim: **treat every "done"
as a claim requiring one artifact the claimant didn't author.** Attestation
happens exactly where an artifact isn't mandatory. And instructions to the
user are claims about the UI — they deserve the same evidence bar as
"done."

Target state the owner named: human gates shrink to two — plan approval and
final review. Everything between is machine-verified: deadline-bearing
monitors, evidence-bearing done reports, verification agents distinct from
builders. Each run should remove stop gaps, not add ceremony.

## Budget finding: pools, not tokens

Codex burned ~8× Fable's output tokens in the run, yet Fable was the
binding constraint throughout — subscription shape (weekly caps, pool
boundaries) matters more than raw token count. Budget posture should be
expressed per-pool, not per-token. The fable cache-read volume (360M reads
across 2,330 orchestrator turns) is the long-main-session cost driver the
token-hygiene rules exist for. Measurement method:
[measuring-agent-spend.md](measuring-agent-spend.md).

## The artifact bundle

The run's reusable artifacts are vendored verbatim in
[field-test-artifacts/](field-test-artifacts/) (see its README for
per-file provenance, including which files are verbatim vs reconstructed
and which asked-for items never existed):

- `delegate-spec-task-67.md` — the delegate-spec exemplar: "read AGENTS.md
  → issue is the spec → existing machinery to reuse → decisions already
  made → Files you own / Do NOT touch → gates → commit-but-don't-push."
  This shape produced zero merge conflicts across 36 PRs.
- `cursor-agent-stream-json-pattern.md` — background delegation launch +
  poll one-liners, the post-commit-hang check, worktree→PR harvest, and
  the two-deadline watchdog rule from E3.
- `overnight-watchdog.sh` — working sketch of a session-level stall
  watchdog (watches the quota-window clock, fires an idempotent headless
  `claude --continue`, max 3 fires). Armed once, never fired in anger.
- `design-mirror-vendoring.md` + `figma-snapshot.py` — the vendor-the-
  source-of-truth template: two Figma REST endpoints, SCREENS/MASTERS/
  VARIANTS curation, sharded per-node layout, manifest with `lastModified`
  for staleness checks, and the consumption contract for agents.
- `browser-verification-checklist.md` — the QA method (real inputs only,
  per-frame side-by-side vs the mirror PNG, before/after interaction
  diffs) plus the `verification-artifacts` orphan-branch layout and the
  canonical `report.md` format — whose honest 6/12-FAIL verdict is what
  spawned a fix round; reports that can say FAIL are the point.
- `quota-calibrations.md` — every recorded tokens-per-percent calibration
  (Sol ~55.7k/1%, fable ~35k/1% ±30% on the $100 plan), the Cursor
  two-pool trap, ai-usage routing thresholds (≥90% exhausted, 75–90% no
  fan-out; the long window governs sustained use), and the uncalibrated
  gaps (Cursor first-party, Gemini).

## Feed into the framework (when that work starts)

- Monitor semantics: ack + completion timeouts, escalation-on-silence
  watchdog, "silence is not success" — daemon + hook layer.
- Issue/contract schema: enumerable acceptance criteria an agent can
  execute and attach evidence to; design-node refs first-class; a required
  "controls and their behaviors" interaction-contract section (the one
  escape class no verifier catches is a spec ambiguity — force it to be
  decided at spec time or flagged to the owner).
- Verification roles as standing flow stages: design-diff agent (image
  pair + node id only), behavior-exercise agent (real inputs, before/after
  diffs), each producing required artifacts to an evidence branch.
- Config-mutation gate for anything outside the repo.
- The AGENTS.md/CLAUDE.md split + kickoff prompt as the repo-bootstrap
  template; vendored+sharded sources of truth; per-issue evidence dirs.
- Ops patterns worth importing wholesale: stream-json monitoring for
  cursor-agent background runs (plain `-p` buffers and looks dead),
  hosted-gate fallbacks, public-alias-only URL sharing for Vercel.
