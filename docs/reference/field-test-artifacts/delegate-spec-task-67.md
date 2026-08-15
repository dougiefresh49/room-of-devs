<!-- Artifact 1: representative delegate spec (issue #67), verbatim from the orchestrator scratchpad. Cited by retro §1 (issue-as-spec discipline, worktree file-ownership splits). -->
# Task: Issue #67 — Auto-generate magic button for empty/long-form text fields

Read AGENTS.md at the repo root first — it is the rulebook (stack, gates, style).
Then read the full issue: `gh issue view 67` — the issue body is the spec.

## Existing machinery to reuse (do not rebuild)
- `components/writing-assist/`: `useWritingAssist` (state machine incl. free-plan gate +
  history), `AssistToolbar` (wand + undo/redo buttons), `AssistBadge` (gradient glyph),
  `AssistOverlay` (proposal diff + accept/dismiss), `assist-prompt-panel.tsx`,
  `presets.ts`. The caption fields in `components/platform-input/platform-input.tsx`
  show the full wiring pattern; `controls/plain-text-input.tsx` and
  `controls/textarea-field.tsx` already accept `assist` fieldProps for the selection
  tooltip path.
- `lib/rewrite/`: contract in types.ts; providers mock.ts / gemini.ts; entry index.ts;
  server action action.ts. Follow the existing code style exactly.
- Field schemas: `lib/types.ts` FieldSpec (characterLimit etc.), fixtures in
  `lib/fixtures/platforms.ts`.

## Key design decisions (already made — implement as stated)
1. `RewriteRequest` gains optional `context?: string` (additive). When `text` is empty
   and `context` is present, providers GENERATE from context instead of rewriting.
   Mock: deterministic generate (e.g. first sentence of context, clipped to
   characterLimit). Gemini: prompt for generation honoring platform + characterLimit.
2. Text-driven schema fields (plain-text-input, textarea-field) render a small magic
   button (AssistBadge glyph, similar footprint to existing field adornments):
   - empty field → one-click generate from context (platform caption, falling back to
     shared post text) → result appears in the existing AssistOverlay proposal →
     accept/dismiss.
   - non-empty field → opens the same prompt panel (presets + freeform) targeting the
     whole field.
3. Context plumbing: the platform section knows its caption — pass it down to the field
   controls (a prop or the existing assist-platform-context).
4. Free plan → button opens UpgradeDialog (useWritingAssist already handles `locked`).
5. Generated text lands on the field's existing undo/redo history.

## Files you own
- lib/rewrite/types.ts, mock.ts, gemini.ts, index.ts, action.ts (+ tests) — additive
  `context` support only
- components/writing-assist/** (new generate affordance; extend presets/prompt panel as
  needed + tests)
- components/platform-input/controls/plain-text-input.tsx, textarea-field.tsx
- components/platform-input/platform-input.tsx (context plumbing only)

## Do NOT touch
- components/upgrade/**, lib/state/**, components/previews/**, app/**

## Gates (all must pass; run in the worktree)
1. `pnpm exec biome check --write .` then `pnpm exec biome check .`
2. `pnpm exec tsc --noEmit`
3. `pnpm test`
4. `pnpm build`

## Done
Work in a git worktree (your CLI creates one). Commit all work on your branch with message:
`Auto-generate magic button for text fields (#67)`
Do NOT push or open a PR — the orchestrator handles that.
Final report: files changed, how context/generation flows, gate results (one line each).
