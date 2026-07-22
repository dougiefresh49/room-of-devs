# Follow-up review v2 (grok-4.5)

Answers to the four owner question sets after round-1 consensus
(`docs/spec-ui-refactor.md`). Grounded in current code under `panel/`,
`tts-server/`, and runtime scale under `~/.cursor/tts/` (read-only inspect).
No daemon/API calls.

---

## Q1 — Desktop wrapper: keep Tauri 2

**Recommendation: KEEP Tauri 2.** Do not switch to Electron, SwiftUI/WKWebView,
or a browser/PWA shell for the desktop room.

### Why Tauri still wins for *this* app

1. **Dock mode needs a real NSPanel.** macOS will not reliably float a normal
   `NSWindow` over other apps’ fullscreen Spaces even with always-on-top /
   “visible on all workspaces.” The working path is NSPanel + collection
   behaviors (`CanJoinAllSpaces` | `FullScreenAuxiliary`) + float level. This
   repo already does exactly that via `tauri-nspanel` in
   `panel/src-tauri/src/lib.rs:29-59` (and `alwaysOnTop` in
   `tauri.conf.json:22`). Electron still lacks first-class NSPanel (upstream
   request open for years; public APIs are approximations that fight Dock
   activation and focus). A native Swift wrapper would nail NSPanel, but then
   the shared React packages from the consensus become “hosted in two
   different webviews with two different packaging stories.”

2. **Floating mode no longer fights the shell — it fights *our* setup.** Today
   the *sole* window is unconditionally converted to a non-activating panel at
   startup (`lib.rs:37-39`, comment: “call to_panel only once”), and
   `ActivationPolicy::Accessory` is global. That was correct for “menu-bar
   companion forever”; it is wrong now that floating should be a normal
   activating Mac window. The fix is architectural inside Tauri (two windows:
   float = regular `NSWindow`, dock = separate `NSPanel`), which the v1
   consensus already prefers — not a shell migration.

3. **Bundle / memory for an all-day companion.** Installed debug `Room.app` is
   ~51MB on disk; running RSS observed ~78MB for the panel binary alongside
   ~54MB for the daemon. Electron would trade rust/toolchain pain for a much
   larger Chromium payload and higher steady-state memory for no feature the
   product needs. Family-of-one maintenance weight favors the smaller shell
   already paid for.

4. **Reuse of shared React packages.** Tauri’s Vite frontend is the same kind
   of SPA host mobile will be. Electron is also fine at hosting React; a
   pure browser page is *not* — it cannot do Accessory policy, NSPanel dock,
   `tauri-plugin-dialog` folder pick for spawn (`main.ts` +
   `Cargo.toml` dialog plugin), or login-item install the way `setup.sh`
   already wires Room.app.

5. **Migration cost from TODAY.** Panel is already Vite + Tauri 2 +
   `@tauri-apps/api` window sizing for dock enter/exit
   (`main.ts:1018-1061`). Mid-refactor shell swap would reopen Phase 4 while
   React islands are landing. Sunk cost + working dock APIs argue keep.

### Alternatives, ranked and rejected

| Option | Verdict | Why |
|--------|---------|-----|
| **Tauri 2 (keep)** | **Win** | NSPanel plugin already in-tree; Vite hosts shared React; ~50MB app |
| Electron | Reject | No real NSPanel; larger always-on footprint; rewrite of window/dialog glue |
| SwiftUI + WKWebView | Reject for now | Best native NSPanel, worst shared-UI packaging; second language forever |
| Browser/PWA only | Reject | Cannot meet dock NSPanel / Spaces / Accessory; mobile already covers LAN web |

### Concrete Tauri shape (amends owner decision #1 toward a closed pick)

- **Floating window:** normal activating `NSWindow`, decorations/shadow per
  chrome decision, *not* converted with `to_panel`, *not* join-all-Spaces,
  `alwaysOnTop: false`. Prefer `ActivationPolicy::Regular` while float is the
  primary UI (or toggle policy when showing float vs dock-only).
- **Dock window:** second Tauri window label, `to_panel()` once on *that*
  window only, float level, non-activating mask, join-all-Spaces +
  FullScreenAuxiliary — i.e. move today’s `lib.rs` setup onto the dock
  window.
- Shared React app + one `RoomClient` store; show/hide or create the dock
  webview on mode switch (Phase 4).

**Does not amend phase order** — still Phase 4. Amends only the “is Tauri
still right?” cloud hanging over owner decision #1: **yes, keep it; implement
two windows.**

---

## Q2 — Server-side architecture and storage

### Glaring flaws beyond v1 consensus

Nothing that should stop or reorder the UI refactor. A few real gaps the
consensus under-weights:

1. **`hook.log` grows without bound.** `logger.ts` is pure
   `appendFileSync` — no rotate/truncate. Observed ~2.2MB `hook.log` (+ a
   stale 3.4MB `hammerspoon-media-debug.log`). Not a correctness bug; it is
   the one long-lived process artifact with no retention story while
   `replay/` already has `MAX_REPLAY_FILES = 20` (`audio.ts:207,469-487`) and
   `played/` has `cleanup_played.sh` + `played_retention_count: 50`.

2. **`played/` retention is configured but not healthy in practice.** Config
   and cleanup script target 50 files; a live inspect showed **442** entries
   in `played/`. `countSuperseded` in `state-watch.ts:153-174` does a full
   `readdir` + `stat` of `PLAYED_DIR` **per agent** on every
   `buildPanelSnapshot()`. Consensus Phase 1 memoizes one snap per notify
   (good — stops SSE N× rebuild), but does not fix the O(agents × played)
   work *inside* one build, nor why retention drifted. Medium severity;
   filesystem scale is still tiny (1.7MB played, 35MB replay capped).

3. **Two listeners in one process is fine — not a flaw.** `panel-ws.ts`
   binds `127.0.0.1`; `mobile-http.ts` binds `0.0.0.0` (`index.ts:471-475`).
   Different exposure/security is intentional. Do not merge ports.

4. **Process model / crash recovery is actually a strength.** Single
   `tsx` daemon; chokidar on queue + sessions; pid-file stream lock with
   dead-pid reclaim (`audio.ts`); `reconcileSessionLineage` before
   `seedStateOnStartup`; 60s card reaper with two-miss + 2min grace
   (`index.ts:483-520`); player self-heal when pause flag vanishes
   (`audio.ts:216-225`). No glaring redesign needed here.

5. **Sync transcript/replay list reads** (`mobile-http.ts` thread parse +
   `listReplays`) remain acceptable at current caps; bound/paginate only if
   product wants unbounded history.

### Would server work reorder the UI phase plan?

**No meaningful reorder.** Keep:

- Phase 1: command/picker extract + **memoized snapshot** (already planned).
- Fold into Phase 1 hygiene (small): fail-loud deploy (already planned),
  **log rotate for `hook.log`**, and **make `cleanup_played` actually enforce
  retention** (or call it from daemon startup, not only ingest backgrounds).
- Phase 7 optional: `audio.ts` / `hid.ts` facade splits — still after UI
  stability; credit guards stay verbatim.
- Do **not** pull synthesis-path refactors earlier to “help” React.

UI-refactor feedback stands: protocol → services → client under old UIs →
islands → shells. Server hygiene above is parallel and cheap.

### Storage: DB or not?

**No database.** Neither SQLite nor Supabase earns a place at this scale.

| Concern | Today | DB help? |
|---------|-------|----------|
| Hook ↔ daemon IPC | JSON/lock/pid under `~/.cursor/tts/` | Must stay; DB cannot replace |
| Room snapshot | ~6 state files + queue/played scans | Memoize + retention fix ≫ SQLite |
| Replay history | Cap 20 MP3+JSON | Already bounded |
| Thread history | On-demand transcript read | Rare; caching in memory enough |
| Multi-device sync | LAN SSE | Hosted DB adds latency/auth for one user |

A local SQLite for “derived history” would be a second source of truth beside
files hooks already write, plus install/migration surface for a personal
daemon that correctly uses atomic tmp+rename today. Supabase is the wrong
shape entirely (network dependency for a localhost/LAN tool).

**Amends consensus:** close the implicit “maybe later DB” door for this
refactor. Explicit stance: filesystem + retention/memoize only.

---

## Q3 — React dependency posture

Reassessing v1: “plain CSS / CSS modules, no component framework, no global
state library.” Owner is happy to take dependencies where they earn their
place. Positions:

### shadcn/ui + Tailwind + Radix — **take selectively**

**Recommendation: YES to shadcn for interactive primitives; NO to rebuilding
domain UI out of shadcn cards.**

- **Take:** `Button`, `Dialog` / sheet, `Popover`, `DropdownMenu`,
  `ToggleGroup` (segmented controls), `Toast`/sonner-style, maybe `Tooltip`.
  These are exactly the primitives both UIs hand-roll badly inside monoliths.
- **Do not take / do not force:** data-table, calendar, sidebar kit, “dashboard
  card” aesthetics. `AgentCard`, `RoomGrid`, `KaraokeLine`, lipsync avatar,
  call/chat chrome stay custom in `packages/ui`.
- **Tokens:** Tailwind does **not** kill semantic tokens. Define
  `--state-working`, `--state-hand-raised`, `--accent`, surfaces as CSS
  variables (as consensus requires), map them into `@theme` / Tailwind config.
  Fix the amber/blue reversal at the variable layer; components consume
  `bg-[var(--state-working)]` or theme keys — one mapping wins.
- **Why vendor-in-repo fits:** shadcn copies source into the monorepo — good
  for a personal long-lived app (own the diffs; no black-box upgrade tax).
- **Mobile bundle:** tree-shake + only import used primitives; call/chat stay
  custom. Accept a modest CSS/JS bump vs another 4.5k-line hand-rolled sheet.
- **Radix-without-Tailwind:** reject as the middle path — you keep a11y
  primitives but lose the copy-paste kit and restyle everything anyway. If
  Radix, take shadcn’s layer.
- **Amends v1:** replace “plain CSS, no component framework” with
  **“Tailwind + shadcn primitives + semantic CSS variables; domain components
  stay hand-built.”**

### Package-by-package

| Need | Pick | Replaces | Earns place? |
|------|------|----------|--------------|
| WS/SSE reconnect + backoff | **None** (enhance `room-client` transports) | Panel’s fixed `RECONNECT_MS = 2000` (`main.ts:111`); mobile `EventSource` | Hand-roll exponential backoff + jitter (~30 lines). Reject `partysocket` / heavy realtime SDKs for two endpoints. |
| Client state | **Keep `useSyncExternalStore` + external `RoomClient`** | Ad-hoc module vars in both UIs | Push-snapshot model is not a Zustand app. Reject zustand/jotai/redux. |
| Server data fetch/cache | **Reject TanStack Query for snapshots**; optional later for `/picker` `/thread` `/replay-list` | Mobile one-shot `fetch`s | Snapshot path is push (WS/SSE). Query cache fights revisioned snapshots. Keep fetch in `HttpSseTransport`; revisit Query only if picker/thread caching becomes painful. |
| Markdown + sanitize | **One shared hand-rolled renderer (escape-first) + platform link policy** — *or* `marked` + `isomorphic-dompurify` if the unified renderer grows | `panel/src/markdown.ts` vs mobile `mdToHtml` | Prefer **no new dep first**: panel already escapes then formats; mobile differs mainly on links. Unifying with an explicit `linkMode: "inert" \| "external"` prop is enough. Take marked+DOMPurify only if GFM creep appears. |
| Protocol runtime validation | **`zod` in `packages/protocol`** | Ad-hoc guards / “trust TS” | Earns place: network JSON is untyped today; command envelopes + `PanelSnapshot` guards stay readable. Daemon can depend on zod without React. Valibot OK; zod is the default pick. |
| Virtualized lists | **Reject** | — | Room agent count is tiny; replay capped at 20. Add `@tanstack/react-virtual` only if a future unbounded history UI appears. |
| Dates/times | **Reject date-fns/dayjs** | Ad-hoc elapsed strings | `Intl.RelativeTimeFormat` or a 15-line helper. |
| Class merging | **`clsx` + `cva`** (via shadcn) | String concatenation in templates | Earns place *if* Tailwind/shadcn adopted; otherwise skip. |

### Rejected as overkill for a two-client personal app

- Zustand / Jotai / Redux / MobX
- TanStack Query on the snapshot pipeline
- Next.js / Remix
- Full shadcn “app shell” / sidebar kits
- Electron (see Q1)
- Any DB client (see Q2)
- Heavy markdown stacks (MDX, remark ecosystem) unless content grows far past agent summaries

---

## Q4 — What changes in the v1 consensus

### Unchanged (explicit)

- Target package split: `protocol` / `room-client` / `ui` / assets; keep
  `panel/` + `tts-server/` paths until client is green.
- Phase order 0→7; filesystem IPC; credit guards; WS vs SSE adapters;
  server-authoritative mobile allowlist; memoized snapshot; atomic mobile
  dist deploy; no big-bang protocol rewrite.
- `audio.ts` / live-tail / HID **off** the React critical path.
- No CI/test-suite apparatus.

### Amended

| Area | v1 consensus | Amendment |
|------|--------------|-----------|
| Desktop shell choice | Implicit “stay Tauri,” owner still deciding window mechanics | **Hard keep Tauri 2**; close Electron/PWA/Swift as alternatives. Implement **two windows** (float NSWindow + dock NSPanel) in Phase 4. |
| CSS / component framework | Plain CSS/CSS modules; no component framework | **Tailwind + selective shadcn/Radix primitives**; semantic CSS variables for state/accent; domain components remain custom. |
| State library | `useSyncExternalStore` only | **Unchanged** — still no Zustand/etc. |
| Protocol guards | Hand-written runtime guards | Prefer **`zod` schemas** in `packages/protocol` (still dependency-free of React). |
| Storage | Silent “no DB” via invariants | **Explicit: no SQLite, no Supabase** for this refactor. |
| Phase 1 hygiene | Services + memoize + fail-loud sync + voice refresh split | **Also:** rotate/truncate `hook.log`; enforce `played/` retention so snapshot scans stay bounded. |
| Owner decision #1 | Two windows vs one still open | Recommend **closing to two windows** given dock must stay NSPanel-ish. Chrome (titlebar vs custom) remains open. |

### Amended phase list (delta only)

- **0–3, 5–7:** as consensus.
- **1:** + log retention + played cleanup reliability (behavior-preserving).
- **3:** stand up Tailwind/shadcn baseline alongside tokens; leaf islands may
  use shadcn `Button`/`Toast` where it removes template glue.
- **4:** Tauri two-window policy (not “maybe one window with flags”).

### Amended owner-decision list

1. **Dock mechanics** — recommend close: two Tauri windows; dock keeps
   non-activating + join-all-Spaces + always-on-top. Confirm or weaken dock
   requirements.
2. **Floating chrome** — still open: standard titlebar vs custom web chrome.
3. **State colors + accent** — still open (semantic names either way).
4. **Desktop live depth** — still open; rename stage vocabulary regardless.
5. **SwiftBar / Raycast** — still open.
6. **Mobile artifact policy** — still open.
7. **Multi-phone** — still open.
8. **Preference scope** — still open.
9. **React 19 vs Preact** — still recommend React 19 (shadcn assumes React).
10. **setup.sh API split** — still strongly yes.
11. **NEW: shadcn + Tailwind** — recommend yes (selective), confirm.
12. **NEW: zod in protocol** — recommend yes, confirm.
13. **CLOSED by this review: shell migration** — keep Tauri; no Electron/PWA.
14. **CLOSED by this review: database** — none.

---

*Reviewer: grok-4.5 · Output only: this file · 2026-07-21*
