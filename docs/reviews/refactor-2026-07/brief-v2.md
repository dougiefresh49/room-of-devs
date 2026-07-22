# Task brief v2: Follow-up questions on the refactor consensus

You are one of two reviewers (gpt-5.6 via codex, grok-4.5 via cursor-agent)
who completed round 1. Work alone; a cross-review round follows.

## Required reading, in order

1. `CLAUDE.md` (repo root) — project overview + constraints.
2. `docs/reviews/refactor-2026-07/brief.md` — the round-1 task.
3. Your own round-1 report and cross-review, and the other model's
   (`review-*.md`, `crossreview-*.md` in the same dir).
4. `docs/spec-ui-refactor.md` — the merged consensus both of you endorsed.

The owner has read the consensus and now asks four follow-up question sets.
Answer ALL of them with positions grounded in the actual code, not vibes.
Where your answer changes the v1 consensus plan, say exactly which phase or
decision it amends.

## Q1 — Desktop wrapper: is Tauri still right?

Now that always-on-top / join-all-Spaces is wanted for DOCK MODE ONLY and
floating mode becomes a normal activating Mac window: is Tauri 2 still the
best shell, or is there a better alternative — Electron, a native
SwiftUI/WKWebView wrapper, or even no wrapper at all (panel served as a
browser page/PWA like mobile is)? Evaluate concretely for THIS app:

- Dock mode needs NSPanel-ish behavior (non-activating float, all Spaces) —
  compare how each option delivers that (Tauri second window per the
  consensus, Electron `setAlwaysOnTop`/panel type, native NSPanel, etc.).
- Build/toolchain pain: the rust toolchain + `pnpm tauri build` +
  setup.sh install + manual Room.app relaunch loop vs Electron's tooling vs
  nothing at all. Family-of-one software — maintenance weight matters.
- Bundle size / memory (menu-bar-adjacent app that runs all day).
- Reuse: whichever shell wins must host the same shared React packages.
- Migration cost from where the code is TODAY (panel is already Vite+Tauri).

Give a clear keep/switch recommendation with reasoning.

## Q2 — Server-side architecture and storage

- Beyond your round-1 findings: any GLARING flaws in the daemon design
  (process model, watchers, two servers, SSE/WS fan-out, sync scans,
  locking, crash recovery, log/replay growth) that the v1 consensus does
  not already address?
- Would fixing server architecture change the UI-refactor feedback — i.e.
  does anything in the v1 phase plan deserve reordering if server work is
  on the table earlier?
- Storage: would a local DB (SQLite via better-sqlite3 etc.) or a hosted
  one (Supabase) actually resolve issues or measurably improve performance
  here — e.g. replay/played history scans, session catalog, thread history,
  snapshot building — or is the filesystem layer fine at this scale?
  Remember the constraint: JSON/lock/pid files under `~/.cursor/tts/` are
  the IPC contract with hook processes and STAY regardless; a DB could only
  complement (derived/history data), not replace the contract. CLAUDE.md
  stance: a DB is neither forbidden nor sought — it must clearly earn its
  place. Be honest if the answer is "no DB".

## Q3 — React dependency posture: shadcn and friends

The owner is explicitly happy to take on dependencies where sensible; no
reinventing wheels, especially networking. Reassess the v1 "plain CSS, no
component framework, no state library" stance:

- **shadcn/ui with customization on top** vs hand-rolling all primitives
  (buttons, sheets, popovers, toasts, segmented controls…). Note shadcn
  implies Tailwind + Radix: how does that interact with the semantic
  design-token plan, the existing dark visual identity (both UIs), mobile
  bundle size, and the fact shadcn vendors source INTO the repo (which
  suits a personal monorepo)? Would you take all of it, parts (Radix
  primitives + tokens without Tailwind?), or none?
- Recommend specific battle-tested packages (or explicitly none) for:
  WS/SSE reconnection + backoff, client state (zustand/jotai vs the v1
  `useSyncExternalStore` store), server data fetching/caching (TanStack
  Query — does it even fit a push-based snapshot model?), markdown
  rendering + sanitization (marked/remark + DOMPurify vs the hand-rolled
  renderers), schema validation for the protocol package (zod/valibot),
  virtualized lists if needed, dates/times, class merging (clsx/cva).
  For each: what it replaces, why it earns its place, and any that you'd
  REJECT as overkill for a two-client personal app.

## Q4 — Amended plan

End with a short "what changes in the v1 consensus" section: amended
target structure / phase list / owner-decision list. If nothing changes in
an area, say so explicitly.

## Output

ONE markdown file at the output path given in your prompt. Sections match
Q1–Q4. Rank recommendations; be decisive — the owner wants positions, not
option surveys.

## Hard constraints (unchanged from round 1)

- READ-ONLY except your single output file. No daemon starts/restarts, no
  touching `~/.cursor/tts/`.
- NO live Gemini or ElevenLabs API calls.
- pnpm, never npm. No CI/test-suite proposals.
- The filesystem IPC contract stays; credit-safety guards stay verbatim.
- Web research is allowed if your tooling supports it (package versions,
  Tauri/Electron capabilities), but code claims must come from this repo.
