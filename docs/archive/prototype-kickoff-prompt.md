# Prototype kickoff prompt (paste into a fresh session)

> Archived 2026-08-29: prototype work started; the standing spec is [active/spec-rig-prototype.md](../active/spec-rig-prototype.md).

_Written 2026-07-29 at the close of the round C play arc. THE RIG won;
this is the standing prompt to start prototype work._

---

Round C design play is DONE and the winner is picked: **THE RIG**
(industrial / Titanfall 2). Your job now is to take it from concept
board to working prototype, in two stages:

**Stage 1 — write `docs/active/design-ui-target.md`** (this is now
legitimate: a concept HAS been chosen — the old "nothing is locked"
banner in STATUS should be retired as part of this). Distill from:

- The winning board: `docs/archive/concepts-round-c-v6/board-rig-refined.html`
  (live: https://ib8n7y2c05z4.postplan.dev) — visual system of record:
  energy-tower spine with docked/projected plan-cards, the asymmetric
  corner grammar (big radius TL + chamfer BR at 3 scales), hex texture
  layer, amber digital displays with machined chrome SPARINGLY, the
  LONG-RANGE PLOT (confirmed keep), reply deck, held-question keycaps,
  dial homes, pilot/craft legend.
- The mobile board: `docs/archive/concepts-round-c-v5/board-industrial-mobile.html`
  (phone jobs ranked: be-spoken-to → answer-from-pocket → glance →
  start-by-voice; "walk to the Mac" is an honest handoff).
- The briefs: `design-brief-round-c*.md` (v2 = what the product is;
  v4 = required features; v6 = cohesion rules + the owner's closing
  corrections at the bottom — including the harvester TERMINOLOGY FIX
  (rename the hex core; keep its look) and two flows the target must
  spec even though no board showed them: the **tap-in flow** and the
  **"let me see a diagram" artifact flow).
- The settled architecture: `docs/active/architecture-concepts/04–09`
  (#73 — do not re-litigate). Salience-as-one-number in PanelSnapshot
  was every board's shared dependency — spec it as a daemon-computed
  field.
- Each board's "what I'd cut" panel — the target should adopt the cuts
  as the day-1 scope line (e.g. static re-placed plot, no drag
  threshold, keycap+text answers before phone STT).

The target must also carve the build into **prototype phases** with a
cheap-first order (design tokens + corner-grammar components →
spine/plot as React components over the existing room-client store →
reply/keycap flows → mobile parity), noting which pieces are pure
`packages/ui` work vs daemon changes (salience number, tap-in surface).

**Stage 2 — prototype phase 1** per that target, honoring house rules:
componentized React over the existing stores (`packages/ui` tokens are
the color authority — the amber/gunmetal palette lands there), no
fetch/WS in components, avatar frames never through React renders,
Session Token Hygiene (delegate code chunks against the spec; main
session does specs/review/merges), API credit rules (no live synthesis
for UI work), typecheck gate, and `spec-ui-consolidation-round2.md`
steps 1–3 need re-speccing against THE RIG before reuse.

Backlogged, do NOT build: the 10,000-ft starmap view and theme
switching (BLACK // GLASS preserved at `concepts-round-c-v4/5` for
that). Both are in `docs/reference/ideas-backlog.md`.

Start with Stage 1, present the target for owner sign-off before
writing prototype code.
