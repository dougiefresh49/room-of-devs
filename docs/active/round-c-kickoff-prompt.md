# Round C kickoff prompt

Paste into a fresh session (or tell it: "read docs/active/round-c-kickoff-prompt.md
and execute"). Written 2026-07-27 at the Round B closeout.

---

Round C — UI redesign round 2: GitHub issue #68 (milestone "Round C — UI
redesign round 2"). The spec is docs/active/spec-ui-consolidation-round2.md —
READ IT FULLY first (findings, promote-and-replace strategy, shadcn-first
rule, build order steps 0–3, invariants, definition of done). Also read
docs/reference/worktree-parallel-flow.md and hold the review bar from
docs/reference/agentic-workflow-notes.md: evidence must reproduce — re-run a
delegate's verification yourself, never trust pasted output. Rounds A and B
shipped 2026-07-27 (#58–#67 closed with verification notes; Round B caught an
inert-hook wiring bug and an off-screen-sheet regression in verification —
that's the standard).

You are the ORCHESTRATOR AND REVIEWER. Per session token hygiene, you do not
author code beyond small surgical edits — delegates write against the spec,
you review diffs, merge, deploy, run the verification rounds.

## ⛔ NOTHING UI-DESIGN IS LOCKED (as of 2026-07-29)

**There is no `design-ui-target.md`, and there deliberately isn't one
yet.** Do not create one, do not treat any concept as chosen, and do not
launch build steps 2–3.

History, so nobody re-derives it: a design target *was* drafted and
briefly locked on 2026-07-28. The owner correctly killed that — locking an
exact target before a concept round makes every board the same board. The
former target now competes as one entry
(`docs/active/concepts-round-c/candidate-a-work-item.md`).

Two concept rounds have run:

- **Round v1 (rejected)** — `docs/active/design-brief-round-c.md` and
  `docs/active/concepts-round-c/`. Owner's verdict: *"text heavy, nothing
  incorporates the avatars, pure 2014, those designs say task manager."*
  The brief caused it (it said work board / status surface / ledger, and
  rewarded designs needing no new backend). Kept only for its decision
  rows and its pick matrix.
- **Round v2 (futurist, current)** — `docs/active/design-brief-round-c-v2.md`
  and `docs/active/concepts-round-c-v2/`: FACEPLATE, THE DEEP, APPROACH,
  THE BRIDGE. Owner likes concepts from these but **has not picked any**.

**Next is a THIRD round**, seeded with visual references the owner will
supply from other media. Do not skip to a mock or a target. If you are
picking this file up cold, read `docs/STATUS.md` first — it is current.

Architecture is settled and is NOT what's open: #73 closed (one concierge
voice above the orchestration line, tracker as the spine, mortal threads,
three dials); docs `architecture-concepts/04`–`09` bind. What is open is
purely *what it looks like and how it behaves on screen*.

Consequences for the build steps below: **step 0 is architecture-agnostic
and may still proceed.** Steps 1–3 as written assume the session-card
model and will need re-specifying against whatever design wins, so treat
their component names as provisional.

## Steps are SEQUENTIAL — packages/ui is a hot file every step reshapes

One delegated worktree lane per step; review + merge + deploy + verify
between steps. No parallel UI lanes (round-1 lesson: parallel lanes amplify
divergence while the shared layer is thin).

- **Step 0 — shadcn CLI wiring + housekeeping** (components.json, registry
  token from .env via the registries block, re-adopt existing primitives
  under CLI management; delete dead/duplicate style.css rules; Toast →
  sonner in both apps). Mechanical → composer-2.5 or grok-4.5-high.
  Verify the preflight-less caveat per the spec.
- **Step 1 — PlayerControls** (one component, size variants strip/mini/full;
  mobile players take callbacks, stop importing audioController; delete
  TransportBar + orphaned CSS). sonnet minimum; opus preferred.
- **Step 2 — AgentCard + Avatar** (the flagship; two slots for real
  variance: interaction layer + name; avatar interface must admit the panel
  stage engine's ref-mutation — img frames NEVER go through React renders;
  `usePttGrant` stays the single grant/PTT owner; the shared GrantButton
  from Round B is the base). opus or fable — taste bar is highest here.
- **Step 3 — PickerFlow** (single Selection model + MODELS list + path
  helpers; layout slots window-view vs sheet; storage callback per app;
  delete the ~434-line picker CSS bucket). opus or fable.
- **Riding along per step**: command seam (touched panel components go
  through the Round-B `commands.ts`/`cluster-actions.ts` dispatcher, stop
  importing `client`) and icons (own sizing via props, merge the 3 icon
  files as consumers migrate).

## Round B substrate — rules now in force

- **CI runs on every push**: typecheck, check-fixtures, format:check, AND
  `pnpm check-overrides` — a guard born from a Round B regression: a
  position class (`relative`/`fixed`/...) in a `className` override on a
  primitive `*Content` component silently beats the primitive's positioning
  via tailwind-merge (the off-screen PlayerSheet bug). If a lane genuinely
  needs positioning, grow an explicit prop on the primitive instead. Tell
  every UI lane this rule.
- **Biome is live**: lanes run `pnpm format` on touched files;
  `format:check` must stay clean. The 494-error lint debt
  (BIOME-LINT-REPORT.md) is NOT Round C scope — if it gets tackled, it's a
  solo dedicated pass landed between steps (like the Phase-0 Biome sweep),
  never mixed into a lane.
- **PreToolUse hooks are LIVE** and will deny: edits under ~/.cursor/tts,
  credit-cap edits (override marker `CREDIT_OVERRIDE=1`), multiple
  enqueue_manual.sh in one command, worktree .env reads (marker
  `LIVE_API_OK`). A denial is the guard working — don't fight it, use the
  marker only when the action is genuinely intended.
- `packages/mobile/dist` is committed; lanes NEVER build it — integrator
  rebuilds once per step after merge.
- TTS_DIR is honored everywhere now — lanes needing a scratch daemon
  environment can use `TTS_DIR=/tmp/...` + fake-agent (free, no keys).

## Per-step loop

Lane builds in a worktree (free checks only: root `pnpm typecheck`,
`format:check`, `check-overrides`, vite dry-builds to /tmp — never the
committed dist) → you review the diff against the spec step + invariants
(lipsync ref-driven; usePttGrant single-owner; daemon never imports
room-client/ui; delete-on-adopt: the per-app copy AND its style.css bucket
die in the same merge — never port CSS in place) → merge → deploy the
touched layers (panel: build + panel-dev-install + relaunch; mobile: dist
rebuild + tts-server restart) → ONE codex computer-use visual round per
step, both UIs, batched checklist → surgical fix-ups on main.

Credit rules unchanged: delegates make NO live Gemini/ElevenLabs calls;
visual verification only; free replay (`signal.ts replay "" 1`) for any
audio check; at most one enqueue_manual.sh poke per verify if synthesis is
ever genuinely the thing under test (this round it isn't).

## Closeout

Per session: STATUS.md update, `pnpm docs:publish`, push, tell me the /clear
point. Close #68 only when the spec's definition of done holds (zero
duplicated transport/card/avatar/picker components; style.css ≤ ~1,200
lines with zero duplicate/dead selectors; zero zero-consumer @room/ui
exports; CLAUDE.md documents the layer boundary). Then move the spec to
docs/shipped/ and log the AI-Elements follow-on idea in the backlog if not
already there.

Realistic session split (steps are big; don't cram): Session 1 = mock +
lock target + step 0. Session 2 = steps 1–2. Session 3 = step 3 +
definition-of-done audit + closeout. Adjust if a step lands faster.

## Round B residuals on the table (fold in or defer — your call, tell me)

- **#72 panel "rotate phone link" button** — needs a tiny daemon command +
  a settings-view button; natural rider on the command-seam work in any
  step that touches SettingsView, else leave open.
- **Port-fallback hardcodes** (panel src-tauri lib.rs `.unwrap_or(4780)`,
  room-client verify-live.ts `?? 4780`) — one small surgical commit
  whenever convenient.
- **Round A owner check still pending**: from a second LAN device,
  `curl http://<lan-ip>:4785/snapshot` must refuse; via the Tailscale IP it
  must succeed. Remind me if I haven't done it.

## Constraints

If a lane's scope creeps beyond its step, stop the lane and tell me. If the
mock review stalls on my picks, park the session at a /clear point instead
of burning context waiting. Ask before touching ~/.cursor/tts/config.json.
