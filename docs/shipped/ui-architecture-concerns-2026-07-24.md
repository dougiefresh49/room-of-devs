# UI architecture concerns — owner review session (2026-07-24)

Logged 2026-07-24 ~1am at the owner's request, for a working session later
today. Owner wants to set up skills from
https://github.com/mattpocock/skills — especially `codebase-design`
(skills/engineering/codebase-design/SKILL.md) — and use them to go over
how the UI and modules should be architected.

## Owner's concerns, verbatim spirit

- Mobile looks so different from desktop because "we still have those
  GIANT ui files 3k lines long and there is no shared components".
- "i dont see shadcn anywhere"
- "we wrote our own markdown parser????? why?????"
- "the whole point of the ui refactor was to REFACTOR THE GIANT FILES AND
  MAKE THE APP MODULAR SO UI COULD BE SHARED AND NOT BUILT TWICE."
- "example: tts-server/src/mobile-http.ts - why.... just why... youre
  allowed to make .tsx files...."
- "the room panel code seems to be somewhat broken apart but nothing is
  reusable between the two, no shadcn, no consistency, no shared ui
  piece"

## RESOLVED: where the 3k-line files came from (2026-07-24, owner confirmed)

The owner was reading **GitHub remote main from the GH mobile app** —
which is STALE (nothing has been pushed since before the July refactor),
so it still shows the deleted `panel/src/main.ts` monolith. Local main is
the refactored tree. Action for the session: push main (owner go-ahead
needed) so remote matches reality; consider making "push after big
refactors" standard practice since the owner reviews from the phone.
Agenda item 1 below is resolved; the audit table stands as ground truth.

## Ground-truth audit (run 2026-07-24, post round-1 merge)

Some specifics don't match the current tree — worth reconciling first
thing, because the *underlying* complaint is still substantially right.

| Claim | Current state |
| --- | --- |
| 3k-line UI files | Largest UI file is 392 lines (PickerSheet.tsx). mobile-http.ts is 755 lines and contains ZERO markup — it's the HTTP/SSE/auth server; the phone UI it serves is the React SPA in packages/mobile. The 3k-line monoliths (mobile.html etc.) were deleted in Phase 6. Possible the owner was looking at the installed copy, git history, or the t3code clone. |
| No shadcn | packages/ui/src/primitives/ has vendored shadcn/Radix: button, dialog, dropdown-menu, popover, sheet, toast, toggle-group, tooltip. Mobile uses them heavily. |
| Hand-written markdown parser | The shared Markdown component is react-markdown + rehype-sanitize (packages/ui), not hand-rolled. |
| Nothing reusable between the two UIs | **Largely TRUE — this is the real finding.** See below. |

## The legitimate gap: sharing stops at the primitive layer

What's actually shared: design tokens (tokens.css), shadcn primitives, a
few leaf components (StateBadge, AgentChips, TransportBar, SummaryText,
Markdown), and room-client (state layer). What is NOT shared — built
twice, and why the two UIs look and feel different:

1. **Duplicated domain components.** `panel/src/app/AgentCard.tsx` (164
   lines) AND `packages/mobile/src/components/AgentCard.tsx` (178 lines)
   are two independent implementations of the same concept. Same story
   for the picker (PickerView vs PickerSheet — round 1 just implemented
   select-then-confirm TWICE in parallel lanes), action clusters, player
   controls.
2. **Two styling systems.** Mobile is Tailwind v4 + shadcn conventions;
   the panel is bespoke legacy CSS (`panel/src/style.css`, ~800 lines of
   hand-written classes: .card, .icon-btn, .hover-btn…). Tokens are
   shared but everything built on top of them diverged. This is the
   single biggest reason desktop reads "janky" next to mobile.
3. **The panel barely imports @room/ui** (a handful of files) while
   mobile is built on it. The refactor stood up the shared package but
   the panel was migrated structurally (React components, stores),
   not visually (still its own CSS + own domain components).

Round-1 evidence that the pain is real: the sheet-overflow bug lived in
how mobile *used* the shared sheet primitive; the fix had to be done in
mobile-only code because the panel lane owned packages/ui that hour. And
both lanes independently designed "select persona → confirm bar" UIs
that will now drift.

## Candidate direction (to pressure-test with codebase-design skill)

NOT decided — strawman for the session:

- Promote the duplicated domain components into packages/ui as the
  single implementation: AgentCard, PickerFlow (one select-then-confirm
  component with layout slots), PlayerControls, ActionCluster. Platform
  apps supply data + callbacks only (already the house rule).
- Kill panel/src/style.css incrementally: move the panel onto Tailwind
  v4 + tokens like mobile (the refactor already mapped tokens into the
  Tailwind theme; preflight caution in CLAUDE.md was about coexisting
  with legacy CSS — the point is to delete the legacy CSS).
- Define the boundary explicitly: primitives (shadcn) → domain leaf →
  domain composite (shared) → app shell/wiring (per-app). Write it into
  CLAUDE.md so lanes and future sessions can't drift.
- mobile-http.ts: no markup in it today, but 755 lines of routing +
  auth + SSE + static serving could still split (routes/, auth, sse) —
  a server-side tidy, separate concern from UI sharing.

## Agenda for the session

1. Reconcile the audit table (what was the owner actually looking at?
   If it's the installed copy or another repo, note it and move on).
2. Install mattpocock/skills (at minimum codebase-design) into
   ~/.claude/skills or project .claude/skills; run codebase-design over
   the repo.
3. Decide the shared-component boundary + styling unification plan;
   turn it into a spec in docs/active/ (this likely becomes "UI
   consolidation round 2" and should precede more parallel UI lanes —
   round 1 showed parallel lanes amplify divergence when the shared
   layer is thin).
4. Revisit CLAUDE.md's UI rules with the outcome.
