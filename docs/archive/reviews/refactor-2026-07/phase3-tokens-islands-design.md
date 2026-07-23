# Phase 3 design — tokens + leaf React islands (panel only)

Status: implemented 2026-07-22 after Sol adversarial critique (16 findings;
resolutions appended at the end of this doc — read them WITH the design,
several sections below were amended by them).
Scope per spec: `docs/shipped/spec-ui-refactor.md` Phase 3. Mobile.html frozen until
Phase 5. Daemon untouched.

## Ground truth (from recon)

- `panel/src/main.ts` (2772 lines) re-renders whole regions via
  `app.innerHTML = ...` on every store change, then re-binds listeners.
  `client.subscribe(...)` at the bottom is the single render driver.
- Lipsync/blink mutate `[data-avatar-session]` `<img src>` directly on
  timers — must stay outside React.
- `RoomClient` is already `useSyncExternalStore`-compatible
  (`subscribe`/`getState` stable-reference), has `getCachedQuery`,
  per-session `pendingGrants`.
- style.css palette: `--amber #f3b247`, `--blue #66a9ff`,
  `--green #49d99a`, `--grey #7b8492`, `--red #f06464`. State rules
  (`.state-working` etc. at 532-544, dock at 1070-1073) already implement
  the owner-chosen mapping: **working=amber, hand_raised=blue,
  speaking=green, idle=grey**. So the panel's only intended visible change
  is the accent: green `#49d99a` → mobile's `#3ecf8e`.
- Panel does NOT render `queuedPreview` today (spec called this out).
  Phase 3 adds it — a deliberate, documented addition, not a parity break.

## 1. packages/ui

```
packages/ui/
  package.json          # @room/ui
  tsconfig.json
  src/
    tokens.css          # semantic CSS variables — THE authority
    tailwind.css        # @import "tailwindcss/theme" + "utilities" (+ @source), @theme inline maps tokens
    index.ts
    lib/cn.ts           # clsx + tailwind-merge
    lib/initials.ts     # avatar-fallback initials helper (shared)
    primitives/         # vendored shadcn-style wrappers over Radix
      button.tsx dialog.tsx sheet.tsx popover.tsx dropdown-menu.tsx
      toggle-group.tsx tooltip.tsx toast.tsx (sonner wrapper)
    components/         # domain leaf components — props + callbacks ONLY
      StateBadge.tsx    # state → dot + label, colors via tokens
      AgentChips.tsx    # raised/queue/superseded/on-phone chips
      QueuedPreview.tsx # truncated waiting text for hand_raised
      TransportBar.tsx  # pause/stop/replay/hold (icon buttons + callbacks)
      ActionCluster.tsx # per-agent action strip (see ownership table)
      SummaryText.tsx   # markdown body of now-playing summary
    markdown/
      Markdown.tsx      # react-markdown + rehype-sanitize
      strip.ts          # stripMarkdown (moved from panel, shared later)
```

Dependencies: `react`/`react-dom` are **peer deps** (panel owns the copy);
runtime deps: `@radix-ui/react-{dialog,popover,dropdown-menu,toggle-group,
tooltip}`, `sonner`, `clsx`, `class-variance-authority`, `tailwind-merge`,
`lucide-react`, `react-markdown`, `rehype-sanitize`. No fetch/WS/Tauri/
audio imports anywhere in the package (enforced by review, later lint).

### Tokens (tokens.css)

```css
:root {
  --state-working: #f3b247;
  --state-hand-raised: #66a9ff;
  --state-speaking: var(--room-accent);
  --state-idle: #7b8492;
  --room-accent: #3ecf8e;      /* owner decision: mobile green wins */
  --room-danger: #f06464;
  /* surfaces/text (from panel palette, shared with mobile in Phase 5) */
  --room-bg: #0d1015; --room-bg-elevated: #121720;
  --room-surface: #171d27; --room-surface-strong: #1d2530;
  --room-surface-hover: #222b38;
  --room-border: rgba(156, 174, 198, 0.16);
  --room-border-strong: rgba(178, 194, 216, 0.28);
  --room-text: #eef3f7; --room-muted: #909ba9; --room-faint: #596474;
}
```

panel/style.css changes (small, targeted — not a mechanical sweep):
- import tokens.css first (via vite `import "@room/ui/tokens.css"`).
- `:root` palette becomes aliases: `--amber: var(--state-working);
  --blue: var(--state-hand-raised); --green: var(--room-accent);
  --grey: var(--state-idle); --red: var(--room-danger);` plus surface/text
  aliased to the `--room-*` tokens. Every existing rule keeps working;
  the accent change flows everywhere green was used (speaking ring, conn
  dot, hold active, etc.) — intended.
- State rules (`.state-*`) switch to semantic vars directly.

Rationale: `--blue` is also used as a generic interactive accent
(borders, links, slider accent). Aliasing keeps byte-identical rendering
except the accent, and Phase 4's React shell will consume semantic tokens
directly as legacy rules die.

### Tailwind

Tailwind v4 via `@tailwindcss/vite` in the panel build. `@room/ui/src/
tailwind.css` does `@import "tailwindcss/theme.css"` + `utilities.css`
(**no preflight** in Phase 3 — the legacy string-template UI depends on
its own reset; preflight's button/img resets would cause silent parity
drift. Revisit in Phase 4 when React owns the shell). `@theme inline`
maps tokens → utilities (`--color-state-working: var(--state-working)`
etc.). Vendored primitives use tailwind classes + cva; domain components
may use existing panel class names where the legacy CSS already styles
them (e.g. `.badge`, `.chip`) to keep parity — new styles (QueuedPreview)
get tailwind utilities.

## 2. Markdown component

`<Markdown text linkPolicy>`:
- react-markdown (raw HTML never rendered — no rehype-raw) +
  rehype-sanitize (defaultSchema).
- `linkPolicy: "inert" | "external"`. inert (desktop): `a` renders as
  `<span class="md-link" title={href}>children</span>`. external (mobile,
  Phase 5): `<a target="_blank" rel="noopener noreferrer">`.
- Component map emits the legacy classes panel CSS already styles:
  headings → `<div class="md-heading md-h{1..3}">`, code/pre/blockquote/
  ul/ol/li as-is. No remark-gfm.
- `stripMarkdown` moves to `@room/ui` (panel re-imports; the dock's
  collapsed caption keeps using it).

Replaces `panel/src/markdown.ts` usage wherever an island renders text;
markdown.ts dies when its last legacy caller does.

## 3. Island architecture (the seam)

**One persistent React root + portals into legacy-rendered placeholders.**

- `index.html` gains `<div id="islands">` as a sibling of `#app` — never
  touched by legacy innerHTML.
- `panel/src/islands/host.tsx`: single `createRoot` mounted once at
  startup. It renders `targets.map(t => createPortal(islandFor(t), t.el))`.
- Legacy templates emit `<div data-island="state-badge" data-session="…">`
  placeholders. After every legacy `render()`, `syncIslands(app)` scans
  placeholders, diffs against the current target list (element identity),
  and bumps a version in a tiny external store the host subscribes to.
- Island components read domain state themselves via
  `useSyncExternalStore(client.subscribe, client.getState)` + room-client
  selectors; the placeholder dataset carries only identity (sessionId) and
  variant (room|dock|spotlight). Domain components from @room/ui stay
  pure; the island wrapper in `panel/src/islands/` binds store + client
  callbacks.
- Ephemeral UI state that must survive portal re-targeting (legacy
  re-render replaces placeholder nodes) lives in a module-level external
  store `islandUiState` (killArmed map incl. its timers, swapOpen
  sessionId) — NOT React component state.

Why not per-placeholder createRoot: root churn on every legacy render
leaks roots or loses state; portals keep one root, one store
subscription per component instance and O(1) re-targeting.

### Ownership table (HARD RULE: one owner per action)

| Surface | New owner | Legacy code deleted |
| --- | --- | --- |
| Footer transport (pause/stop/replay/hold) | `TransportBar` island | footer template buttons + `bindControls` |
| Card + dock + spotlight action clusters (focus, status, kill+arm, replay_session, swap toggle, live pause/stop/restart, summary replay/replay_slower) | `ActionCluster` island (variant prop) | `actionButtonsHtml`, `dockActionButtons`, `bindHoverActions`, kill-arm module map |
| Swap character popover | Radix `Popover` inside ActionCluster | `renderSwapPopover`, `positionSwapPopover`, `bindSwapPopover`, `swapOpenSessionId` module var |
| State badge (room card) | `StateBadge` island | badge template block |
| Chips row + queued preview | `AgentChips`+`QueuedPreview` island | chip template blocks + the module-level 15s phone-chip interval (moves into the island) |
| Summary/now-playing text body (room pane + dock caption) | `SummaryText` island (Markdown) | `renderMarkdown` call sites in `renderRoomSummaryPane` / `renderDockSpotlight` |
| Grant (card/avatar click + PTT hold) | **stays legacy** (`bindGrantTargets`) | — |
| Summary pane/bubble chrome (expand/collapse/dismiss, dock sizing) | **stays legacy** | — |
| Picker, settings, rename, drag, window actions, toasts | **stays legacy** (Phase 4) | — |

Grant stays legacy deliberately: it's a card-wide gesture entangled with
PTT hold-detection on the same element; moving it means the card
container itself becomes an island (not a leaf). Single ownership is
preserved (legacy only); the codex pass still verifies single-fire.

Kill-arm moves INTO ActionCluster (islandUiState) because the armed
visual + confirm click live entirely on the button the island owns.

### Interactions with legacy mechanisms

- Legacy `render()` keeps firing on store changes; islands also
  re-render via their own subscription. Both read the same store state →
  no divergence. Portal re-targeting after legacy render remounts island
  DOM; state lives in the store / islandUiState so nothing is lost.
- Lipsync/blink untouched: avatars remain legacy `<img>`s; islands never
  render avatar frames. rAF/interval timers unchanged.
- Dock window sizing (`enterDockMode` measuring `dockWidth/dockHeight`)
  unchanged — island content mounts into fixed-size slots (action strips,
  badge, chips) that don't drive dock geometry. Spotlight/caption
  geometry stays legacy-owned.
- `client.send` remains the command path; islands call the same
  `client.send`/`client.grant` APIs (via callbacks passed by the island
  wrapper — @room/ui components never import the client).

## 4. Button-patch null bug

NOT fixed this phase: the Buttons settings tab stays legacy (Phase 4
componentizes settings), so per the kickoff's conditional, the bug stays
documented (CLAUDE.md Known issues + Phase 2 decisions entry).

## 5. Verification

1. `pnpm typecheck` (new ui package included), `pnpm check-fixtures`,
   panel `vite build`.
2. `packages/room-client/scripts/verify-live.ts` against running daemon.
3. Sol deep review of full diff pre-deploy.
4. Deploy: `pnpm tauri build --debug` → `./scripts/setup.sh` → relaunch
   Room.app. Daemon untouched.
5. codex computer-use: island actions single-fire (transport, swap,
   kill-arm, grant), queued-preview visible on a hand-raised card, accent
   is #3ecf8e, dock + spotlight + captions unchanged, lipsync smooth
   during `signal.ts replay "" 1` (free).
6. Baseline deltas documented vs `baseline/checklist.md`: accent color,
   queued preview (new), swap popover now Radix-positioned.

## Open questions for critique

1. Portal re-targeting on every legacy render: acceptable churn, or
   should legacy render() skip innerHTML when only island-owned state
   changed? (Current view: acceptable — legacy already rebuilds
   everything; islands are leaves.)
2. Radix Popover inside a portal whose host node is replaced mid-open:
   controlled `open` from islandUiState re-opens after remount —
   positioning re-computes. Flicker acceptable?
3. Tailwind no-preflight: agree, or take preflight now and eat the
   parity diff deliberately?
4. Anything in the ownership table that risks double-dispatch?

## Sol critique resolutions (gpt-5.6-sol, high effort — 2 blockers, 14 majors)

Full report: scratchpad phase3/sol-critique.md (session-local); the
substance is captured here.

| # | Finding | Resolution |
|---|---|---|
| 1 | Portals under innerHTML-replaced DOM = unsupported external mutation | Reframed + hardened: cleanup of a replaced portal container happens while the container is detached WITH its subtree intact — React's removeChild is DOM-safe. Operationally, syncIslands() runs right after each legacy render and `flushSync`-commits in the same task, so there is no async window and no half-rendered paint. |
| 2 | Cluster events can bubble into grant/PTT | Two firewalls: ClusterBtn stops native propagation at the portal container (React delegates per-portal-container, below `.card`), AND `isNonGrantTarget()` in bindGrantTargets ignores mousedown/click from any non-target button or `.card-actions/.dock-actions/.spotlight-actions`. Side effect (deliberate improvement): clicks in cluster GAPS no longer fire a billable grant — legacy did. |
| 3 | Mid-gesture snapshot cancels clicks | Pre-existing legacy behavior (innerHTML rebuild had the identical effect); islands are no worse (same-task flushSync). Documented, not fixed. |
| 4 | Radix popover remount mid-open loses focus/interaction | `onOpenAutoFocus`/`onCloseAutoFocus` preventDefault (no focus churn on remount); open state controlled from ui-state store; content re-position on remount ≈ legacy re-render behavior. |
| 5 | O(1) re-target claim false; missing portal keys | Stable keys `kind:variant:sessionId`; ONE store subscription at the host (leaves get plain props, no per-leaf subscriptions); remounts acknowledged as the cost model. |
| 6 | Wrapper divs break grid layouts | Portal targets ARE the semantic containers (`.card-actions`, `.dock-actions`, `.spotlight-actions`, `.chips`, `footer.controls`, `.room-summary-body`, `.dock-caption-summary`) — children mount as direct grid/flex children; `actions-N`/state classes stay legacy-owned on the container. |
| 7 | Dock sizing vs async island commits | flushSync (no async commit) + islands mount only into fixed-size slots; dock geometry inputs unchanged. Verified visually post-deploy. |
| 8 | Grant in island plumbing; no command gating | Islands never call `client.grant` (grant/PTT stays 100% legacy). All island commands go through one dispatcher in host.tsx. No pending-dedup added — parity with legacy (no dedup there either); server locks stay final authority. |
| 9 | Timer/lifecycle sprawl | One host-level 15s clock for the phone-chip belt (replaces the legacy module interval); kill timers live in ui-state with `pruneUiState()` called from applySnapshot. |
| 10 | ActionCluster wrongly in @room/ui | Moved to `panel/src/islands/ActionCluster.tsx` (desktop-only semantics); shared icons stay in @room/ui. |
| 11 | `--blue` double-owned by hand-raised state | New `--room-interactive` token; `--blue` aliases it; `--state-hand-raised` is independent (same value today). |
| 12 | Two greens: hard-coded old-green alphas | All `rgba(73,217,154,α)` and dock-live `rgba(88,214,141,α)` literals replaced with `color-mix(in srgb, var(--room-accent) α%, transparent)`; `#9aebc6` phone-chip text and the `#4ade80` checkbox fallback re-derived from the accent. |
| 13 | Cascade layers unspecified | Kept: legacy stylesheet is unlayered and beats layered utilities by design (parity). Preflight stays off. Formal layer policy + primitive reset deferred to Phase 4 when primitives get real usage (only Popover is live in Phase 3, and its visual styling is legacy `.swap-popover`). |
| 14 | Markdown parity gaps | remark-breaks added (legacy `<br>` soft-break behavior); h1–h6 all mapped (capped at md-h3); rehype-sanitize + no raw HTML confirmed; protocol allowlist noted for Phase 5's external links. |
| 15 | Lipsync wording vs spec | Grandfathered explicitly: the existing 70ms setInterval direct-DOM scheduler stays as-is; islands never render `[data-avatar-session]` imgs. rAF migration is future work, not Phase 3. |
| 16 | Verification could burn credits | Bounded to the kickoff budget: ONE short enqueue + one grant click (Phase 2 precedent), test queue item deleted afterward; everything else keyless/cached/free. |
