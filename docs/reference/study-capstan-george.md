# Study: BytesNation/capstan (George's framework, v2.12.0) — what to pull into Room of Devs

_2026-08-22. Source: https://github.com/BytesNation/capstan at `e020…`
("merge verify-discipline/architect", 2026-08-22). 53 files, ~2.9k lines,
MIT. Read in full: README, DESIGN, `.capstan/` (glossary, 197-line
decision log, 3 records), all 4 agents, all 15 skills + credits. Compared
against: the July Ptheory exchange
([agentic-workflow-notes](agentic-workflow-notes.md)), the settled #73
architecture ([architecture-concepts/02–08](../active/architecture-concepts/)),
the fleet corefiles/skills (`~/projects/fleet`), and this repo's live hooks
(`.claude/settings.json`). Companion to the Jarvis study. Postplan:
https://sqlmcqwzzopr.postplan.dev (draft `sqlmcqwzzopr`; re-upload with
`postplan upload <html> --draft sqlmcqwzzopr`)._

## TL;DR

**What it is.** Capstan is a Claude Code *plugin* — plain markdown, no
runtime — that runs one piece of work from concept to delivery: five roles
(Architect = your session; Scout / Builder / Reviewer / Courier =
subagents), fifteen "disciplines" (skills), and **three gates where the
run ends** and you decide. The only things that persist are a one-line
glossary (`.capstan/CONTEXT.md`) and a one-line-per-decision log
(`.capstan/decisions.md`, with `accepted / assumed / open / unformed /
superseded` statuses); specs and plans are gitignored scratch, deleted at
delivery. Seven of the fifteen skills are vendored from Matt Pocock (one
from Lauren Tan) with `CREDIT.md`s; the process skills — `effort`,
`interview`, `slicing`, `two-axis-review`, `verify`, `decision-record`,
`brief`, `spike`, `walkthrough` prose — are his.

**What changed since July.** This is not the Ptheory stack we compared
against in #73. That was ~50 deterministic gate scripts, a 20-agent roster,
contract/wave ceremony. Capstan is the *opposite pole*: "No operating
layer: no schemas, no hooks, no scheduler … prose survives a model change
in a way a validator does not" (`DESIGN.md`). He swung from maximal
enforcement to zero. Our promotion ladder (prose → corefile → hook, each
step earned by a rule biting) sits between the two, and I'd keep it there
— see §4.

**How it differs from the room.** Capstan is a *process for one effort at
a time* (three in flight is the ceiling) with a human at synchronous
gates. The room's framework (#73) is an *ambient runtime for N concurrent
threads*: one cheap always-on voice above an interpreter, GitHub issues as
the durable spine, mortal orchestration threads, silent workers, and three
dials (ceremony / voice / brain tier). They are not competitors — Capstan
is what a *single thread* runs when its ceremony dial is turned up, and
the room is the thing that lets you run more than three because the
voice/status surface replaces the briefs. Full comparison in §3.

**Pull-in verdict** (detail in §4): **take as-is** — `decision-record`
(log + glossary + statuses), `two-axis-review` + the Reviewer agent,
`diagnosing-bugs`, `walkthrough`, `resolving-merge-conflicts`, `spike`,
the Scout agent, the `writing-for-agents` AUDIT pass, and four hard-won
gotchas from his log. **Take with tweaks** — `slicing`, `interview`,
`brief`, `verify`, the Builder/Courier prose, the gates. **Don't take** —
the plugin as a user-scope install, the no-hooks dogma, `test-first` as a
mandatory gate, `unslop` as "must always apply", deleting specs at
delivery, and the Obsidian knowledge-base target. Reasons per item below.

---

## 1. What Capstan does, precisely

### The run

```
/capstan:effort "<what you want>"          (only a human can start one)
  Phase 1 Concept  → interview (rounds, each Q carries a recommended answer)
                     + parallel Scouts for facts → spec.md   → GATE 1: right thing?
  Phase 2 Plan     → vertical slices with blocking edges, test seams agreed → GATE 2: right shape?
  Phase 3 Build    → one Builder per slice in its own worktree (Architect creates it)
                     → a Reviewer per slice, two axes, no Builder context
                     → Architect merges in dependency order → `verify` on the integration → GATE 3: ship?
  Phase 4 Deliver  → Courier packages, drafts per-recipient briefs, writes ONE knowledge-base note,
                     commits it; Reviewer reviews the note; scratch deleted.
```

Each phase is its own file (`PHASE-2-PLAN.md`, …) and each run **ends**
at the gate — "the gate is enforced by the run being over." Every later
phase starts by "re-reading the world": `git log <head-in-CLAIM>..HEAD`,
and if HEAD moved, stop and read what landed before dispatching.
`CLAIM.md` (`effort / phase / head / next / last-touched`) is the only
cross-session state and the only thing stopping two Architects running
the same effort.

**Authority** is a two-row table: the crew does everything unattended
*except* secrets, anything a third party sees, anything that costs money,
and anything destructive/production. "Uncertainty is not on that list" —
**stop for consequence, never for ambiguity**: take the most defensible
reading, log it as `assumed` with the condition that would reopen it,
surface it at the next gate.

### What persists

| Tier | File | Rule |
| --- | --- | --- |
| Glossary | `.capstan/CONTEXT.md` | one line per term; the only file edited in place; a name contradicting it is a review finding |
| Log | `.capstan/decisions.md` | one line per decision, newest first, statuses `accepted / assumed / open / unformed / superseded by N`; cannot bloat |
| Record | `.capstan/decisions/NNNN-slug.md` | only when hard-to-reverse AND surprising AND a real trade-off — most efforts produce none |
| Brief | never stored | generated per recipient at send time |
| Scratch | `.capstan/effort/` (gitignored) | spec, plan, scout returns, reviews — deleted at delivery: "a stale spec is worse than none; the next agent reads it as current" |

`open` and `assumed` lines are read back by the *next* interview's first
round, so a question nobody could answer in March is re-asked in June
instead of dying with the spec. `unformed` names an area nobody can even
phrase a question about yet (his adaptation of Pocock's "fog of war").

### The roles

| Role | Model | Tools | Owns | Never |
| --- | --- | --- | --- | --- |
| Architect | your session | — | interview, spec, slice graph, log, worktrees, merges | builds or reviews |
| Scout | sonnet/medium, 25 turns | Read, WebSearch, WebFetch | primary-source findings with citations + confidence | decides; has no write tools at all |
| Builder | sonnet/high, `acceptEdits` | R/W/E/Bash/Skill/Web | exactly one slice, test-first, own worktree | reviews itself; stash; checkout; merge; remove worktrees |
| Reviewer | opus/xhigh | Read, Bash, Skill | two-axis review vs a supplied fixed point | sees Builder reasoning; fixes; delegates |
| Courier | sonnet/medium | R/W/E/Bash/Skill | package, per-recipient briefs, the KB note + its commit | sends anything |

### The disciplines worth knowing cold

- **`interview`** — the *frontier*: ask every question whose prerequisites
  are settled, in one round; hold dependents for the next. Facts are the
  agent's job (read the code / send a Scout); decisions are the human's.
  A question that stalls twice gets three exits: build a `spike`, send a
  `to-questionnaire`, or pick the cheapest reversible default.
- **`slicing`** — "what can be demonstrated when this is done?" must be
  behaviour, or it's a layer; sizes to one fresh context window; blocking
  edges are the artifact; expand-migrate-contract for wide refactors;
  acceptance criteria must be **red at the base commit**; single-artifact
  work (a doc, one config) is one slice and that's correct.
- **`two-axis-review`** — Standards (built right?) and Spec (right
  thing?) never blended; worst finding *per axis*; a supplied fixed point,
  never guessed; repository conventions override; a preloaded standard
  (`codebase-design`) can be declined by one line in the repo's decision
  log; skip what a typechecker would catch; "a finding with no citation is
  an opinion"; a clean axis is one line.
- **`verify`** — find the checks the repo *declares* (CI workflow →
  package.json scripts → hooks), run them on the merged integration, log
  to a file and read the tail, report **observations not exit codes**,
  and re-run red checks at the claim's `head` in a throwaway worktree so
  pre-existing failures aren't pinned on a slice. Reports, never fixes.
- **`decision-record`** — the three tiers above, plus: write the line
  the moment it resolves; never edit an accepted record, supersede it.
- **`brief`** — BLUF; an *assumptions* section and an *open questions*
  section that prints "none" rather than being absent; one page; partner
  briefs regenerated per recipient, never maintained.
- **`spike`** — "does it behave right" vs "does it feel right" (three
  variants side by side); throwaway from line one; branch `spike/<slug>`,
  pushed, never merged, never deleted; the answer flips the `open` line
  to `accepted` naming the branch.
- **`walkthrough`** — a generated one-time bash wizard (Pocock's 204-line
  `template.sh`) for steps only a human can do; `ask_secret`, `.env`
  upserts, `gh secret` writes gated by `if confirm …; then …; fi`; the
  agent never runs it (no tty → every prompt returns empty and the script
  still exits 0).
- **`diagnosing-bugs`** (Pocock) — no hypothesis until one command goes
  red on the exact symptom; minimise; 3–5 falsifiable hypotheses shown to
  the user; tagged debug logs; regression test only at a correct seam.
- **`writing-for-agents`** (Pocock) + **`AUDIT.md`** (his) — context
  pointers, the two loads, the information ladder, leading words vs
  negation, no-op hunting; the audit pass = prune → dedupe → sharpen
  bounds → rank the ladder → report per section.

### Signals from the decision log (197 entries, one day)

He dogfoods the process on the repo itself, and the log is honest about
cost: ~40 of the lines are version bumps, README counts drifting (four in
a day → "counts that only restate a list are deleted"), and one migration
that took seven review rounds before he cut it ("simplify rather than keep
it alive", decision 58 → 188). Two lines are still `open` and both are
*rule conflicts inside his own vault* (`AGENTS.md` forbids auto-commits vs
the Courier must commit; a routing file that "wins over an agent prompt"
but contradicts a decision). That's the failure mode of prose-only
enforcement showing up on day one, recorded rather than hidden — which
is to his credit, and is the evidence for §4's hooks verdict.

Also relevant to the earlier Obsidian question: his knowledge base *is*
an Obsidian vault, and it is not hand-maintained — it carries a
`schemas.md`, a `vault-health.py` validator that errors on wrong
frontmatter (decisions 142–143), and per-project `effort/*` tags. The
Courier writes there; a Reviewer grades the note. So his vault is a
schema'd, machine-checked store, which is a stronger position than the
Jarvis one.

---

## 2. The room's underlying framework, for contrast

Settled in #73 and docs 04–08, independent of the RIG skin:

- **One always-on concierge voice** (Mikey — stateless, immortal) above
  an **interpreter line** (local whisper PTT → rule router → flash-lite
  router → command service). Cheap to talk to; never wakes a coding model
  for a question the transcript can answer.
- **The spine is the task manager** (GitHub issues): the durable mind.
  Issues carry finding IDs, validation criteria (evidence reproduces),
  labels (`free-rein` / `blocked`).
- **Mortal orchestration threads** (build / one-off / watcher) pulled from
  the spine; **silent ephemeral workers** beneath them (composer / grok /
  codex / sonnet in worktrees, file ownership split at spec time).
- **Three dials per thread**: ceremony (how much gate/contract ritual),
  voice attachment (1:1 checkout, call mode), brain tier (a routing table
  + cost log, never model-self-assessed).
- **Salience** — one daemon-computed number per thread answering "how far
  is this room from needing me?"
- **Enforcement by promotion ladder**: prose → corefile → deterministic
  hook, each promotion earned by a rule biting. Four hooks are live today
  (block install-dir edits, credit caps, enqueue loops, `.env` reads) and
  have already denied a session's own tool calls.
- **Rules are evidence-backed** (fleet `AGENTS-base.md`): every behavioural
  rule cites a counted failure and carries a BAD/GOOD pair.
- **Verification at the layer the owner experiences** (fleet `verify-ui`,
  `codex-computer-use`): OS-level input, screenshots, "needs your eyes"
  as an honest label.

## 3. Capstan vs the room — the underlying framework

| Axis | Capstan | Room of Devs |
| --- | --- | --- |
| Unit of work | one *effort*, ≤3 in flight, human at three synchronous gates | N concurrent *threads* pulled from the spine; owner steers by voice/phone; ceremony is a per-thread dial |
| Where the mind lives | `decisions.md` + `CONTEXT.md` per repo, plus one KB note per effort in an Obsidian vault | GitHub issues (spine) + `docs/` + STATUS + Claude memory + fleet corefiles |
| Who orchestrates | your session, synchronously | a daemon + hooks + tmux/SDK threads; the main session specs and reviews, delegates build |
| Human attention model | three briefs per effort; gates end the run | salience number + voice interrupts; "good `/clear` point" ends a round |
| Enforcement | prose only, deliberately; Bash is an acknowledged escape hatch | promotion ladder; four PreToolUse hooks live |
| Review | independent Reviewer, two axes, fixed point, no builder context | codex-review + opus/fable review rounds; "evidence that reproduces" bar; verify-ui |
| Verification | declared checks on the integration, observations not exit codes; **no UI / device verification** | typecheck + fixtures + format + container-smoke in CI; computer-use UI rounds; audio side-effect checks |
| Parallelism | vertical slices with blocking edges, one Builder each, Architect-made worktrees | issues with `Files you own / Do NOT touch`, one worktree per issue (zero conflicts across 36 PRs in the field test) |
| Specs | gitignored scratch, deleted at delivery | `docs/active` → `docs/shipped` (shipped spec = the architecture record) |
| Cost routing | Scout/Builder/Courier = sonnet, Reviewer = opus | brain-tier dial + roster: composer/grok/codex for bulk, opus/sonnet subagents, fable reserved |
| Voice / ambient surface | none (text-only, by design) | the whole product |
| Non-code work | first-class (docs, video, infra run through the same crew) | code-centric; docs rounds exist but aren't formalised |

**The sentence version:** Capstan is *how one thread should behave when
you care* — interview, slice, build in isolation, review independently,
verify the integration, record only decisions, stop at gates. The room
is *the runtime that holds many such threads, routes them by cost, and
lets you steer them by voice without reading briefs*. The room's "ceremony
dial" was always going to need a concrete high setting; Capstan is a very
good candidate for what that setting *is*.

Where they genuinely disagree: (1) hooks — he now rejects them, we earn
them; (2) spec lifecycle — he deletes, we archive as architecture; (3)
who verifies UI — he doesn't, we must (audio + two UIs).

---

## 4. Pull-in verdicts

Layer key: **fleet** = `~/projects/fleet/skills/universal` or corefiles
(so every repo gets it); **repo** = this repo only; **docs** = process
docs. All Capstan-authored files are MIT; vendor with `CREDIT.md` exactly
as he does — it's his own convention.

### Take as-is

| Piece | Where | Why it fits |
| --- | --- | --- |
| **`decision-record`** (log + glossary + statuses + 3-gate record rule) | fleet skill + `docs/decisions.md` here | Solves a problem we have *right now*: owner calls are scattered across CLAUDE.md, STATUS, memory, and `decisions-overnight.md`; STATUS is a "giant dump" (owner, 2026-08-12). A one-line log with `assumed`/`open`/`unformed` is the thin durable layer STATUS should have been, and the "supersede, never edit" rule is the rule-provenance habit the Jarvis study already recommended. `CONTEXT.md` gives PILOT/CRAFT/CONDUIT/DOCK, spine, thread, watcher, dial, salience one canonical line each instead of five design docs. |
| **`two-axis-review`** + `agents/reviewer.md` | fleet skill + `.claude/agents/reviewer.md` | Strictly better than our ad-hoc review prompts: the fixed point rule, worst-finding-per-axis, "no citation = opinion", skip-what-CI-catches, and the decline-a-standard-by-log-line mechanism. Opus at xhigh is "free game" per the budget posture. Pairs with `codex-review` as the second perspective; the July "Operator lens" (failure paths first, blockers block) becomes the Standards axis brief. |
| **`diagnosing-bugs`** (Pocock, 3 lines repointed) | fleet skill | We have no test runner; this skill doesn't need one — its loop list (curl, CLI with fixture, replay a captured trace, throwaway harness) is exactly how this repo is debugged today (`index.ts once`, `mock-live.ts`, `signal.ts replay`). Formalises "no hypothesis before a red command." |
| **`walkthrough`** (Pocock's `template.sh` + his prose) | fleet skill | We have real human-hands steps: mic TCC, HID button bring-up (#16), Tailscale/serve, ElevenLabs voice audition. Today those are prose paragraphs; a generated wizard with `ask_secret` and `if confirm` gates is better and costs nothing to keep. |
| **`resolving-merge-conflicts`** | fleet skill | Small, correct, and his one exception ("a conflict resolvable only by inventing behaviour is a slicing defect — abort") is the right rule for our worktree rounds. |
| **`spike`** | fleet skill | Codifies our silo rule: "feel right → three variants side by side" is literally what rounds C/D did; `spike/<slug>` pushed-never-merged-never-deleted plus "the answer flips the `open` line" tightens what we already do informally. |
| **`agents/scout.md`** | `.claude/agents/scout.md` | Our Explore agent with citation discipline: primary sources, per-claim URL, confidence with reason, "what I could not establish", never delegates, dates claims that go stale. No write tools — the read-only guarantee is structural. |
| **`writing-for-agents/AUDIT.md`** | fleet skill (SKILL.md + MECHANICS are Pocock's — fleet already has Theo's version of the same ideas; take the audit pass) | Run it against this repo's CLAUDE.md (~250 lines, mixed durable/volatile, several drifted counts) and against `AGENTS-base.md`. The counts rule alone ("a count that only restates the list beneath it is deleted") would have caught our own drift. |
| **Four gotchas from his log** | `worktree-parallel-flow.md` + `AGENTS-base.md` | (a) **`git stash` is shared across all worktrees** — a Builder stashing silently destroys another's work; ban it in delegate specs. (b) `isolation: worktree` frontmatter resolves against the *session's* cwd, so cross-repo sessions (fleet) fail with "not in a git repository" — create worktrees with `git -C <repo> worktree add -q` and hand over absolute paths. (c) `-q` on `worktree add`, or a big repo dumps thousands of progress lines into context. (d) Never `--amend` in a repo the owner owns and may have pushed — fix with a second commit. |

### Take with tweaks

| Piece | Tweak | Why |
| --- | --- | --- |
| **`slicing`** | Merge into `delegate-issue`'s spec shape rather than replace it. Keep our "Files you own / Do NOT touch" (proven: zero conflicts across 36 PRs); add his three tests — *what can be demonstrated*, *blocking edges are the artifact*, *acceptance criteria red at the base commit* — and the seam-agreed-up-front rule. | Ours slices by file ownership (avoids collisions); his slices by demonstrable behaviour (avoids un-verifiable layers). Both are needed; neither alone. |
| **`interview`** | Take the frontier, recommended-answer-per-question, and the three stall exits. Drop the strict "one round, wait" when running autonomously: park as `assumed` with a revisit condition and keep moving — which is his own "stop for consequence, never for ambiguity" rule applied to our overnight posture. | The room's owner is often asleep or on the phone; the value is the *statuses*, not the synchronous rounds. |
| **`brief`** | Use its checkpoint-brief shape for round-end reports (BLUF, assumptions, open questions printed "none"); ignore partner briefs (family-of-one). Keep our extra "needs your eyes" label. | Directly fixes the STATUS/Postplan problem from the other direction: **stop maintaining rendered summaries; generate them from the decision log per reader.** |
| **`verify`** | Adopt the declared-checks discipline + baseline-at-head + observations-not-exit-codes. It is *necessary but not sufficient* here: chain it to fleet `verify-ui` / `codex-computer-use` and to this repo's audio side-effect checks (`hook.log`, `replay/`, `played/`). | His `verify` has no concept of a screen or a speaker; ours must. |
| **`agents/builder.md`** | Take the prose (one slice, the worktree rules, gated actions, "stop for consequence", the return shape with assumptions-as-lines) as the delegate brief template; change `model: sonnet` to our roster (composer/grok/codex for bulk, sonnet only when taste ≥ 7 is needed) and drop the `test-first` preload (see below). | The roster and budget posture are owner calls; the discipline text is model-agnostic. |
| **`agents/courier.md`** | Repoint "the knowledge base" to `docs/shipped/` + a STATUS line + `pnpm docs:publish`; keep the **stage-only-the-note** commit rule and the copied-vs-derived frontmatter rule (useful once our docs carry frontmatter, per the Jarvis study). | We have no vault; the Courier is our end-of-round ritual with a name. |
| **The three gates** | Map, don't import: Gate 1 = design brief / issue approved; Gate 2 = spec in `docs/active` approved; Gate 3 = round report before deploy. For the autonomous crank, the owner pre-approves gates 1–2 in the issue and only gate 3 is live. `CLAIM.md` → the `claim-at-start` write-back that #75 is already asking for; its `next` line + "re-read the world (`git log head..HEAD`) before dispatching" is the resume rule our overnight rounds lack. | The room already has owner-gated dispatch; what it lacks is the *named* checkpoints and the resume discipline. |
| **`codebase-design`** | Already installed at `~/.claude/skills/codebase-design` (his copy differs only in punctuation — he de-em-dashed it). Preload it on the Reviewer like he does instead of relying on model invocation. | "A discipline that has to be remembered is a discipline that gets skipped" (his decision 0003). |

### Don't take — and why

| Piece | Reason |
| --- | --- |
| **The plugin as a user-scope install** (`claude plugin install capstan@bytesnation`) | Adds fifteen skill descriptions to *every* session's always-loaded context (his own `writing-for-agents` calls this context load), duplicates `codebase-design` we already have, and the `effort` front door assumes the Capstan role names and `.capstan/` layout. Vendor the pieces above into fleet with `CREDIT.md`s instead; if the owner wants to *try* a full effort, install at `--scope project` in a scratch repo. |
| **"No operating layer / no hooks" as doctrine** | Our four hooks were each earned by an incident (install-dir edits, credit caps, synthesis loops, `.env` reads) and have already caught a session red-handed. His own day-one log shows the prose-only failure mode (two `open` rule conflicts, "Bash is an escape hatch"). And the room's daemon *is* an operating layer — it's the product. His pendulum swing from 50 scripts to 0 is informative: the answer for us stays the ladder, hooks only for rules that bit. |
| **`test-first` as a Builder preload / gate** | No test runner exists here (July audit), and the house rule is "no test-suite theater; changed behaviour gets verified." Adopt only his no-code variant — *name what would show this is wrong before producing it* — and the red-at-base acceptance criterion. Mandating red-green-refactor would produce mock-heavy unit tests around a filesystem-IPC daemon, which is the "testing the mock" failure his own skill warns about. |
| **`unslop` as "must always apply"** | It bans em dashes outright, colons mid-sentence, and bold lead-ins; the owner's docs and this repo's voice use all three. Keep it as an *optional* pass for anything going to a third party; don't put "always apply" in CLAUDE.md. |
| **Deleting specs at delivery** | Our `docs/shipped/` specs are the architecture record (`spec-live-mode-v2.md` *is* the current live-mode design). His point — "the next agent reads a stale spec as current" — is real and is exactly the STATUS problem; the fix is a decision log agents read cold plus status banners on specs, not deletion. |
| **The Obsidian knowledge base target** | Nothing to point the Courier at; see the Jarvis study §5 for the structure-first plan. His schema'd, validator-checked vault is the strongest Obsidian argument seen so far, but it's still downstream of "adopt the structure first." |
| **`to-questionnaire`** | Family-of-one: the operator holds the answers. Marginal use for async exchanges with George; not worth a skill slot. |
| **Three-effort ceiling as a hard rule** | The ceiling is about *human-read briefs*; the room's salience number and voice interrupts exist precisely to raise it. Keep the *idea* — don't run more gated efforts than you'll actually read — as a line in the corefile, not a counter. |

---

## 5. Recommended path

1. **Fleet round (one delegate, one PR):** vendor `decision-record`,
   `two-axis-review`, `diagnosing-bugs`, `walkthrough`, `spike`,
   `resolving-merge-conflicts`, and `writing-for-agents/AUDIT.md` into
   `fleet/skills/universal/` with `CREDIT.md` + `LICENSE` per folder; add
   `reviewer.md` and `scout.md` to a `fleet/agents/` folder; append the
   four gotchas to `worktree-parallel-flow.md` and `AGENTS-base.md`.
   Composer-2.5 can do this — it's file copying plus path repointing.
2. **This repo:** create `docs/decisions.md` (his format) seeded from
   the dated owner calls in CLAUDE.md, STATUS, and
   `decisions-overnight.md`; create `docs/CONTEXT.md` from the #73
   vocabulary. Then run the `AUDIT.md` pass on CLAUDE.md (opus). This is
   the STATUS rework the inbox has been asking for, done his way: STATUS
   becomes an index, decisions become the log.
3. **Next build round:** run it as a Capstan-shaped thread — interview
   with statuses, slices with demonstrations + red-at-base criteria +
   file ownership, a `reviewer` agent per slice, `verify` + `verify-ui`
   on the integration, a Courier-style close-out. Judge the ceremony dial
   from that one run before making any of it default.
4. **Tell George** the stash-across-worktrees line and the
   `isolation: worktree` cwd finding are going into the fleet with credit
   — and ask what his `vault-health.py` schema looks like; it's the piece
   of his vault we didn't get to see.

_Scratch clone: `/tmp/capstan` (re-clone if gone). Capstan version
2.12.0; his log says no release tags yet, so pin by commit if vendoring._

---

## 6. Reconciliation with the pstack wave (2026-08-24)

_Added after the fleet wave-2 issues (#25–#30, pstack ports from Theo's
2026-08-20 audit) were filed. The study above was written without them.
Spot-checked against the clone at `3b5c8f4`: the decision-record
statuses, two-axis-review, verify, interview, spike, the DESIGN.md
quotes, the 197-line log, and the vendored `unslop` (byte-identical to
pstack's) all read as described. The analysis stands; what changes is
how the pull-ins land, because several now overlap a pstack port._

**Where the two waves overlap, and which wins.**

| Capstan piece | pstack port | Resolution |
|---|---|---|
| `two-axis-review` + Reviewer agent | `interrogate` (#28) | Not duplicates. Two-axis is one reviewer with a fixed method; interrogate is a multi-model panel with a lead verdict. Two-axis becomes the per-reviewer rubric inside #28; the single-reviewer agent file is #34. |
| `decision-record` | `show-me-your-work` (#27) | Different layers. The TSV trail is per-run scratch; the decision log is per-repo and durable with statuses. Trail rows that are real decisions get promoted to one log line at run end. Both ship (#31, #27). |
| `spike` | `arena` (#29) | Different ends. Arena grafts N candidates into a shipped artifact; spike builds a throwaway to react to and settles one stalled question. Both ship (#33, #29), cross-referenced. |
| `unslop` "must always apply" | `unslop` (#25) | §4 said don't take it as always-apply. George's own DESIGN.md has the better answer: split by *reader*. unslop for prose a person reads, `writing-for-agents` for documents an agent consumes, one routing line in CLAUDE.md. #25 adopts the split; the em-dash policy stays the owner's call. |
| `walkthrough`, `diagnosing-bugs`, `writing-for-agents` (Pocock via George) | flagged as "Matt's, say the word" in the pstack round | Three sources now converge (Theo adopted all three on the video; George vendored them; this study says take as-is). Filed: #35, #36, #37. |
| Scout agent | fleet's Explore-subagent convention | Scout's citation contract is the upgrade; filed with the reviewer agent as #34, deploy path owned by #20. |

**Where I'd amend §4/§5.**

- *"One delegate, one PR, composer-2.5 can do this."* No. Under fleet's
  rules skills are taste work with an evidence citation each, one PR per
  skill with file ownership, specs as issues. Seven skills plus two agents
  in one composer PR is the shape the field test's zero-conflict record
  argues against. Filed as seven issues instead.
- *Four gotchas into AGENTS-base.* They're George's counted failures, not
  ours. They go to `worktree-parallel-flow.md` and the delegate-spec
  template (via #21), not the corefile, until one bites here.
- *`docs/CONTEXT.md` here.* Don't create a second glossary; the fleet
  corefile already puts the glossary in AGENTS.md. Take his two rules for
  it (edit in place; the change is a log line) and stop there.
- *`resolving-merge-conflicts` as a skill.* Sixteen lines with one rule
  worth keeping ("a conflict resolvable only by inventing behaviour is a
  slicing defect; abort"). That's a sentence in #21, not a skill slot —
  every always-loaded description is context load, his own
  `writing-for-agents` point.
- *`brief`.* Right shape (BLUF, assumptions, open questions printed
  "none"), wrong container. It's a rule for round-end reports, not a
  skill; goes with the reports-as-pages corefile note (#24).

**Unchanged:** the framework comparison in §3, the don't-takes in §4
(plugin install, no-hooks doctrine, test-first, spec deletion, Obsidian),
and the repo-side step of seeding `docs/decisions.md` from the dated owner
calls — that last one is still the STATUS rework and still not started.

**Fleet tracking:** issues #31–#37 (wave 3) plus fold comments on #21,
#25, #27, #28, #29; summary on tracking issue #11.
