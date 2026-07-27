# Round B kickoff prompt

Paste the block below as the first message of a fresh session to run Round B.
(Saved here so it survives a `/clear`. Round A's equivalent was pasted, not
committed — this one lives in the repo for durability.)

---

Round B of the audit fixes — "foundation" milestone: GitHub issues #62, #63,
#64, #65, #66, #67 (milestone "Round B — foundation"). Each issue is
self-contained with finding IDs and a validation checklist; the audit they cite
is docs/archive/reviews/ptheory-audit-2026-07-26.md, and the review bar is in
docs/reference/agentic-workflow-notes.md (evidence must reproduce — re-run it
yourself, never trust a delegate's pasted output). Round A shipped 2026-07-27
(#58-#61 closed with verification notes; one C-6 regression was caught in
verification and fixed — that's the standard to hold).

You are the ORCHESTRATOR AND REVIEWER. Per session token hygiene, do not author
code beyond small surgical edits — delegates write, you spec, review diffs
against the issue checklists, merge, and deploy. Start by reading all six issues
(gh issue view 62 63 64 65 66 67) and docs/reference/worktree-parallel-flow.md.

## Why Round B is NOT a 6-way parallel fan

Unlike Round A's clean file-ownership lanes, several Round B issues have broad,
overlapping surfaces that WILL collide if run together:

- **#63 Biome** reformats every .ts/.tsx/.json in the tree — conflicts with
  every other code lane by definition.
- **#66 instance isolation** sweeps TTS_DIR across ~26 scripts AND edits
  config.ts — collides with #62 (config.ts schema) and #67 (hook scripts).
- **#64 panel error-handling** and **#65 a11y** both touch panel/ and
  packages/ui.

So SEQUENCE into sub-rounds. Recommended plan (finalize after reading the
issues; deviate if a better split is obvious, but don't fan all six at once):

### Phase 0 — land Biome first, solo, on main (#63)
A format-only sweep is cheapest to absorb BEFORE other lanes write code (they
then write already-formatted code; format-on-save keeps diffs clean). Doing it
last means re-formatting every lane's output + one giant final conflict.
- Delegate the `biome.json` + `pnpm lint`/`format` wiring + the initial format
  run to composer-2.5 (mechanical). Land the format as ONE dedicated commit
  containing nothing else; review with `git diff -w --stat` to prove it's
  whitespace-only. Keep non-format lint-rule fixes as a separate follow-up so
  the sweep stays pure. The CI lint step wires in via #62 (Phase 1).

### Phase 1 — backend/infra sub-round (parallel: #62, #66+#67)
Branch all lanes from post-Biome main.
- **Lane #62 (CI floor + contract single-sourcing)** — cursor-grok-4.5-high (or
  a claude subagent; the 189-line validator → parseCommand swap is delicate,
  keep protocol changes additive). OWNS: `.github/`, `check-fixtures.ts`,
  the `services/commands.ts` validator block, protocol schemas. Does NOT own
  config.ts (see hot-file note).
- **Lane #66+#67 (instance isolation + PreToolUse hooks)** — one lane, grok
  (both are scripts/.claude/config work in the same file domain; #66's sweep
  must see #67's new hook scripts). OWNS: `scripts/*` TTS_DIR sweep, `config.ts`
  (TTS_DIR resolution, .env precedence M-19, AND #62's M-13 config-schema
  validation — folded here so config.ts has ONE owner), `Dockerfile`,
  `fake-agent`, `.claude/` PreToolUse hooks.
- HOT-FILE RULES: config.ts → #66 owns it entirely (M-13 config schema lands
  here, not in #62 — hand #62's schema wording to this lane). scripts/* → #66
  owns the sweep; #67's new scripts are created inside the SAME lane so they get
  the resolver. If #62 genuinely needs a config.ts line, it leaves a handoff
  note, not an edit.

### Phase 2 — UI sub-round (parallel: #64, #65) — taste ≥ 7, so opus/fable
This is also Round C prep (restyling shared primitives beats restyling five
hand-rolled modals). Split by file ownership so they don't collide:
- **Lane #65 (a11y + shared primitives)** — opus or fable. OWNS:
  `packages/ui/*` (including making AgentCard a real button — the shared
  component both surfaces use), `packages/ui/src/tokens.css` (--room-faint
  contrast), `packages/mobile/*` (adopt Radix primitives, reduced-motion, PTT
  keyboard).
- **Lane #64 (panel error-handling parity)** — opus/fable or sonnet. OWNS:
  `panel/src/*` ONLY (the 17 fire-and-forget call sites, disconnected-state
  disabling, HID emitNotice, timeout/backoff). Consumes the AgentCard button
  from #65 rather than editing packages/ui.
- If #65's tokens.css or primitive changes are a prerequisite for #64, land #65
  first and branch #64 from it (serialize within Phase 2) rather than both
  editing packages/ui.

## Every delegate prompt
Cite the issue number(s), restate NO live Gemini/ElevenLabs calls (AGENTS.md
also covers this), and require the verification gate (tsc --noEmit in
tts-server/ and panel/ when touched, mobile typecheck, `pnpm check-fixtures` if
protocol touched, `bash -n` on changed scripts, `biome lint` clean once Biome
lands). Mobile source changes need `pnpm --filter @room/mobile build` by the
INTEGRATOR after merge (dist is committed; lanes never build it).

## Sequence & closeout
Phase 0 (Biome) → merge → Phase 1 lanes in parallel → review each diff against
its checklist, re-run its validation locally, merge (typecheck between merges) →
Phase 2 lanes → review + merge. THEN one deploy where it applies:
- Most of Round B is verifiable WITHOUT the daemon or synthesis (CI runs on
  push; Biome/lint is static; a11y + error-handling verify with the daemon
  STOPPED — that's the point of #64; instance isolation verifies via
  `TTS_DIR=/tmp/... ` runs writing zero files under ~/.cursor/tts). Credit
  efficiency is a smaller factor this round — but session token hygiene (delegate
  heavily, don't author) matters MORE because these diffs are large.
- Deploy (`tts-server.sh restart` + `setup.sh` + panel rebuild/relaunch) only
  for the layers that changed at runtime (scripts, daemon, panel, mobile).
- CI (#62): verify by pushing a branch that intentionally breaks typecheck and
  confirming the workflow goes red, then fixing it — don't just eyeball the YAML.
- One batched codex round for the runtime/UI items that need it (panel + mobile
  a11y: focus trap, Escape, keyboard PTT, contrast via Lighthouse/axe;
  disconnected-state feedback with the daemon stopped; the container smoke test).
- Close each issue with a verification note citing what was re-run. Update
  STATUS.md, `pnpm docs:publish`, commit/push, tell me it's a /clear point.

## Also on the table
- **#72 (mobile token rotation kills bookmarked phone URLs)** — a Round A
  follow-up, not in the Round B milestone. Leaning "generate-if-absent, rotate
  only on explicit revoke." It's ~a dozen lines in mobile-http.ts + a
  mobile_url.sh --rotate + a panel button. Fold it into the Phase 1 backend
  sub-round if there's headroom, or leave it for a standalone quick fix — your
  call, tell me which.

## Constraints
No unbounded synthesis (one enqueue_manual.sh poke max per verify if you
synthesize at all — most of this round doesn't), ask before touching
~/.cursor/tts/config.json, and if a lane's scope creeps beyond its issue(s),
stop that lane and tell me instead of absorbing the extra work. Round B is
bigger per-lane than Round A — if the two-phase plan feels like too much for one
session, split it across two sessions (Phase 0+1, then Phase 2) and tell me at
the natural /clear point.
