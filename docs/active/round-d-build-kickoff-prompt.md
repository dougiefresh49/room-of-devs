# Round D build — overnight kickoff prompt

_Paste the block below into a fresh session (after `/clear`). Owner is
asleep — run hands-off._

---

Build Round D into the prototype, all four phases, hands-off overnight.
The authority is `docs/active/spec-round-d-synthesis.md` (read it fully
first, including the TL;DR and §0 graft list); the visual reference is
`docs/active/concepts-round-d/final.html`; design rules are
`docs/active/design-ui-target.md` §2 (incl. §2.6 — nothing animates from
invented data) and the corner grammar in `prototype/src/styles/shape.css`.
This is `prototype/` ONLY — siloed mock-data app, port 5180. No daemon,
panel, or mobile changes; no live Gemini/ElevenLabs calls anywhere,
including in delegated prompts.

**Keep cranking: when a phase passes its gate, immediately start the
next. Do not stop to ask me anything — make the judgment call, note it
in the phase report, and continue.** Only halt for something truly
unrecoverable (repo in a broken state you cannot fix).

Phases per the spec, with its file-ownership split:
1. Fleet seam + hangar floor (touches shared files — runs alone)
2. Commissioning bay + FIELD variants
3. Tool crib (`/crib`) — runs in PARALLEL with Phase 2 (disjoint files;
   also wire up `components.json` here per the spec)
4. Service schematic (`/map`) + part-number deep links — runs last

Delegation (this is a multi-stage effort — the main session writes
specs/prompts, reviews diffs, merges, and verifies; delegates author the
code):
- **Budget note (owner, 2026-08-01): GPT-5.6 is at 100% availability
  with 2 resets that expire Aug 11 — go HAM on gpt-5.6 Sol via codex.**
  Use Sol as the primary implementation model for the hard phases (1, 2,
  4) and for deep review passes. codex notes (verified against CLI
  0.145.0): `gpt-5.6-sol` is already the config default but at
  reasoning effort LOW — add `-c model_reasoning_effort="high"` for
  implementation/review runs; `-s workspace-write`; background long
  runs with `< /dev/null` (open stdin = infinite hang); they exceed
  Bash's 10-min default timeout. `codex review` now accepts a custom
  prompt (`-` reads stdin).
- composer-2.5 / grok-4.5 via cursor-agent for mechanical/well-specced
  chunks (Phase 3 is a good composer fit). cursor-agent is
  composer/grok ONLY (other models bill the small Cursor API pool —
  78% used).
- Claude subagents (opus for judgment/taste, Explore for recon) via the
  Agent tool where they beat the CLIs. Split work within a phase across
  parallel subagents/delegates wherever files are disjoint; batch each
  phase's verification into ONE round.
- Never Haiku; never agy.

Per-phase gate before moving on:
- `pnpm exec tsc --noEmit` clean in `prototype/` (and any touched pkg);
  `pnpm typecheck` at the root stays clean.
- App boots: `pnpm --filter @room/prototype dev` (port 5180) with no
  console errors on the new surfaces.
- Visual/interaction check via codex computer-use (`codex-computer-use`
  skill): screenshot each new surface (hangar rung, commissioning bay,
  `/crib`, `/map`), compare against final.html, fix what's off. One
  batched verify round per phase.
- Commit + push to main after each phase passes (docs-style commit
  messages, per-phase).

When all four phases are done:
- Update `docs/STATUS.md` (Round D built; move
  `spec-round-d-synthesis.md` to `docs/shipped/`; log judgment calls),
  run `pnpm docs:publish`, commit + push.
- Leave a final summary: what shipped per phase, gate results,
  screenshots, judgment calls made, and anything punted — plus the note
  that the panel/mobile shadcn audit items (tabs/collapsible/select/
  slider + orphan-dep removal) are the follow-up round.
- Do NOT restart the daemon, touch `~/.cursor/tts/`, or send
  notifications — I'm asleep; I'll read STATUS in the morning.
