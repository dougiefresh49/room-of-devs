# P2 kickoff prompt (paste into a fresh session)

_Written 2026-07-30 at the close of P1. The design target is signed
off and P1 (tokens, RIG primitives, gallery, dock reskin) is shipped
and deployed through `aeb6037`._

---

RIG prototype **P2 — the console** is next. Read
`docs/active/design-ui-target.md` first (§3 surfaces, §8 day-1 cuts,
§9 phase table, §10 house rules) and `docs/active/spec-rig-p1.md`
(what already exists: the `--rig-*` tokens and the 12 primitives in
`packages/ui/src/rig/` — build ON them, prove them, extend them where
the console needs more; the gallery at `pnpm --filter @room/ui dev`
shows them all).

Scope: the **panel main window becomes the RIG console over the
EXISTING snapshot** — no daemon or protocol changes in this phase.
Per target §9/P2:

- Faceplate (Mikey hero, halo, talk lamp + waveform) + the second-voice
  Donnie bay; **this is where the existing token-value flip happens**:
  the `--room-*`/`--state-*` values on desktop become the RIG ramp per
  target §2.1 — re-cut the state colors so working-amber and data-amber
  don't collide, and handle panel/style.css's ~30 `--room-accent`
  color-mix call sites deliberately. Mobile must keep its current look
  (it imports the same tokens.css — scope the flip so mobile is
  unaffected until P6).
- Thread nodes replacing the AgentCard grid (CRT face, callsign, task
  line, state tags incl. needs-you glow / settled dim / spawning), with
  the open-node innards from existing machinery (`/thread` history +
  live tail on the one open node).
- Crew manifest treatment, watch-order chips from existing `live.on`,
  reply composer + PTT bar + grant chip reskinned, dial homes rendered
  static where their data doesn't exist yet (voice home is live).
- Kill each replaced `style.css` bucket on adoption
  (promote-and-replace). This supersedes
  `spec-ui-consolidation-round2.md` steps 1–3; its two input-parity
  requirements ride along: **desktop typed chat** and **attachments
  wherever you can reply**.
- Day-1 cuts (target §8) bind. No plot, no spine rail, no salience
  ring — those are P3/P4.

House rules: write a P2 build spec first (main session), delegate the
implementation chunks per Session Token Hygiene (grok/composer lanes
against the spec; check `ai-usage` before big rounds), hard
constraints: avatar frames never through React renders (stage engine
owns img refs), components never fetch, `usePttGrant`/`grant-guard`
untouched in behavior, no live synthesis for UI work, typecheck +
check-fixtures gates, verify with codex computer use (screenshots of
every load-bearing state from target §3), deploy via
`./scripts/panel-dev-install.sh`.

Present the P2 build spec briefly before launching lanes if anything
in it needs an owner call; otherwise proceed and report shipped.
