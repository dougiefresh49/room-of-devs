# Cross-review: gpt-5.6 on grok-4.5 v2

## 1. Agreement

The two v2 reports agree on the decisions that matter most.

- **Wrapper:** keep Tauri 2. Phase 4 should use two native window roles: a normal activating `NSWindow` for floating room mode and a separate dock-only window converted once to `NSPanel`, with floating level, non-activating behavior, `CanJoinAllSpaces`, and `FullScreenAuxiliary`. Electron adds a permanent Chromium/Node cost without solving the real NSPanel requirement; a browser/PWA cannot meet that requirement; native Swift/AppKit is the fallback only if `tauri-nspanel` becomes a recurring problem. Floating chrome remains an owner choice.
- **Server:** keep one daemon and the two listeners. The localhost WS and LAN HTTP/SSE servers have intentionally different exposure and authentication boundaries; they should share command/snapshot services, not be merged into one port or split into separate daemons. Snapshot fan-out should compute once per revision. `audio.ts`/HID decomposition remains outside the React critical path.
- **Storage:** use no database in this refactor. SQLite would be a derived index beside the mandatory filesystem IPC contract, not a replacement for it, and current bounded data does not repay the reconciliation/migration cost. Supabase is an especially poor fit because it adds network, credentials, privacy, and hosted-lifecycle failure modes to a local single-user tool. Reconsider only a rebuildable local SQLite index for a concrete unbounded search/analytics feature or a measured scan bottleneck.
- **Dependencies:** reverse v1's blanket “plain CSS/no component framework” posture. Use a small, source-vendored shadcn/Radix layer with Tailwind mapped to semantic CSS variables; keep `RoomGrid`, `AgentCard`, karaoke, live/call UI, and other domain components custom. Keep the external `RoomClient` plus `useSyncExternalStore`; reject Zustand/Jotai/Redux and TanStack Query for the pushed snapshot. Use no virtualization or date library at current scale, and use `clsx`/CVA with the selected primitives.

## 2. Disagreements

### Restart recovery: hold against Grok

Grok says there is “nothing that should stop or reorder the UI refactor” and describes crash recovery as a strength. The individual recovery mechanisms it cites are real, but that conclusion misses the most serious v2 finding. `tts-server/src/index.ts:406-428` starts with an empty in-memory queue, while the chokidar queue watcher at `:523-535` uses `ignoreInitial: true`. There is no startup scan of `queue/*.json`. Files written while the daemon is down, or surviving a crash before their add event is consumed, are therefore not admitted to automatic draining after restart.

This is correctness and credit-safety recovery work, not aesthetic server cleanup. It should become a small Phase 1A before command-service extraction and before UI reconnect/restart work. Attach the watcher and reconcile existing files without a scan/watch race; sort deterministically and route every candidate through the existing `processQueueFile`/`claimProcessing` path. Do not invent a bypass around mute/live checks, post-lock checks, or billed-item handling.

### Networking dependency: hold, with a narrower recommendation

Grok recommends hand-writing exponential WS backoff because it is “~30 lines.” That estimate omits intentional close, connect timeout, queued sends, online/offline transitions, jitter, duplicate timers, and listener cleanup. The owner explicitly asked not to reinvent networking wheels. Use a small maintained reconnecting WebSocket implementation behind `WsTransport`; keep native `EventSource` for SSE because it already reconnects. Add snapshot revision/event-ID rejection of stale replays. Do not adopt a realtime SDK or React socket hook.

### Markdown: hold against the hand-rolled default

Grok prefers merging the two regex renderers first. The repo shows why that is weak: `panel/src/markdown.ts` and `tts-server/mobile.html:2073-2151` already differ in headings, ordered-list syntax, paragraph joining, link handling, and output policy, and both ultimately generate HTML strings consumed by `innerHTML`. A shared React migration is the right moment to stop extending a bespoke Markdown parser. Use `react-markdown` + `remark-gfm` + `rehype-sanitize`, disable raw HTML, and provide a platform-specific link component. This is not “heavy MDX”; it directly replaces two divergent security-sensitive renderers.

### Zod versus Valibot: concede the principle, retain Valibot as the merged pick

Grok's Zod recommendation is sound: runtime wire validation belongs in `packages/protocol`, with inferred TypeScript types. This is not an architectural disagreement. For this small browser/server protocol, Valibot remains the decisive merged choice because its modular imports and smaller client footprint fit the shared mobile boundary; Zod would be acceptable if owner familiarity outweighs that difference. In either case, the v1 description “dependency-free” must be amended to “React/browser-framework-free.”

### Phase ordering: partially concede

Grok is right that broad synthesis, worker-thread, process, or DB work must not block React. I disagree only for the bounded recovery slice above. Phase 0 remains protocol-first; Phase 1 is split into recovery/storage hygiene and then services/deploy hygiene. The rest of the UI order remains intact.

## 3. Good catches by Grok I missed

1. **The played scan is worse than a single directory scan.** `countSuperseded()` in `tts-server/src/state-watch.ts:153-174` rereads `PLAYED_DIR` and stats matching files separately for every agent built by `buildSnapshot()`. Snapshot memoization removes per-SSE-client duplication but not this internal O(agents × played-files) pattern. Phase 1 should read/index played metadata once per snapshot revision (or maintain a tiny in-memory index), in addition to enforcing retention.
2. **Retention is only ingest-triggered.** The repo confirms `cleanup_played.sh` is launched from `scripts/ingest.sh` and `scripts/ingest_claude_code.sh`; daemon startup does not enforce it. Grok correctly pushed this from a nominal config setting into an operational reliability task. Startup should run equivalent bounded cleanup through daemon-owned code or a deliberately invoked maintenance path.
3. **Activation policy needs explicit role handling.** Grok called out that `ActivationPolicy::Accessory` is application-global. The two-window implementation cannot merely move `to_panel()` to a second window and leave the current unconditional policy untouched. Floating mode needs `Regular`; dock-only mode may use `Accessory`, with transitions tested alongside show/hide behavior.
4. **The two ports are a deliberate security boundary.** Grok states this crisply: `panel-ws` is loopback while mobile HTTP is LAN-facing. That supports preserving two listeners even while extracting shared services.

## 4. Errors or weak recommendations in Grok's v2

1. **It overlooks stranded startup queue files.** The “crash recovery is actually a strength” section is materially incomplete for the `ignoreInitial: true` watcher and empty in-memory queue described above.
2. **“Shared React app + one `RoomClient` store” is inaccurate across two Tauri webview windows.** Separate webviews have separate JavaScript realms and cannot share one in-memory store. They can load the same bundle and each maintain a `RoomClient` instance subscribed to the same daemon state. A native/inter-window singleton is unnecessary if only one role is visible; visibility must be enforced by the window adapter.
3. **The SwiftUI rejection uses the wrong drawback.** A Swift/AppKit wrapper would not require two different React packaging stories: both native roles could load the same built Vite bundle in WKWebViews, just as Tauri windows do. Its real costs are rewriting working Tauri commands/plugins, maintaining a JS-native bridge and Xcode packaging, and gaining little unless direct AppKit control proves necessary.
4. **Observed app/RSS and runtime directory counts are not repository-grounded evidence.** Grok reports a 51 MB app, process RSS values, log sizes, and 442 played entries from a live inspection. Those may have been true at inspection time, but they are machine-state snapshots, not reproducible code facts and should not carry the recommendation. The repo-grounded conclusions still hold: Tauri uses the system webview, Electron bundles Chromium, logging has no rotation, cleanup defaults to 50, and its trigger is not guaranteed on startup.
5. **The hand-rolled WS recommendation understates lifecycle behavior.** Backoff itself is easy; robust connection semantics are the wheel worth importing. A small transport-level library is consistent with the owner's dependency posture and stays isolated from React.
6. **The hand-rolled Markdown recommendation perpetuates parser/security ownership.** Escape-first reduces injection risk, but it does not supply a correct Markdown grammar or remove `innerHTML`. The two existing implementations already demonstrate drift.
7. **“shadcn assumes React” is too loose as a reason for React 19.** The selected shadcn components are React components, so they support the already recommended React choice; they do not independently establish React 19 over every alternative. React 19 remains the consensus because the target stack is React and both apps will share it.

## 5. Final consensus amendments to the v1 spec

### Decisive answers to the owner's four questions

1. **Keep Tauri 2.** Close the shell question and the dock-mechanics question: Phase 4 implements a normal activating main window plus a separate dock `NSPanel`. Use the same React bundle but separate per-webview client stores. Default the floating window to a standard macOS titlebar unless the owner explicitly chooses custom chrome. Direct Swift/AppKit is the contingency if the NSPanel plugin proves unreliable; reject Electron and desktop PWA.
2. **Keep one daemon, two listeners, and filesystem storage; add an early recovery slice.** No SQLite or Supabase. Before server service extraction, reconcile startup queue files race-safely, make the stream lock use exclusive creation like `claimProcessing`, rotate bounded logs, bound failed/played retention, and compute played metadata once per snapshot revision. Then do the already-planned command/picker extraction, snapshot memoization, bounded thread/catalog caching, and fail-loud staged deploy. Do not split processes or move audio/HID refactors forward.
3. **Adopt focused dependencies.** Use Tailwind + selected vendored shadcn/Radix primitives, with semantic CSS variables as the design authority and bespoke domain components above them. Adopt Valibot for protocol schemas, a small reconnecting WebSocket client, native revision-aware EventSource, `react-markdown` + `remark-gfm` + `rehype-sanitize`, Lucide, `clsx`, CVA, and only the `tailwind-merge` usage needed by vendored primitives. Keep `useSyncExternalStore`. Reject Zustand/Jotai/Redux, TanStack Query for this push model, list virtualization, date libraries, realtime SDKs, MDX, and a full shadcn application shell.
4. **Amend, do not restart, the v1 plan.** The package split and migration sequence remain valid; add dependencies and recovery without broadening the React critical path.

### Amended phases

0. **Baseline + protocol:** unchanged in purpose; `packages/protocol` uses Valibot schemas/inferred types and remains free of React/browser dependencies.
1. **Recovery + bounded storage:** new early slice—race-safe startup queue reconciliation, exclusive stream-lock acquisition, bounded log/failed/played retention, and one played index/read per snapshot revision.
2. **Server services + deploy hygiene:** former Phase 1—command/picker services, one snapshot per revision, short-lived catalog caching/bounded thread reads, fail-loud atomic artifact staging, and opt-in voice/SFX refresh.
3. **Shared client under old UIs:** former Phase 2—external store, maintained reconnecting WS, native revision-aware SSE/HTTP, no global state/query library.
4. **Tokens + leaf React islands:** former Phase 3—semantic variables, Tailwind, curated shadcn/Radix primitives, and the shared sanitized React Markdown renderer.
5. **Desktop React shell:** former Phase 4—two Tauri windows; normal floating activation and dock-only NSPanel policy.
6. **Mobile Vite shell + cutover:** former Phase 5, otherwise unchanged.
7. **Delete + legacy audit:** former Phase 6, unchanged.
8. **Optional server splits:** former Phase 7, unchanged and still outside the UI critical path.

### Owner decisions after amendment

- **Still open:** floating chrome if the owner rejects the recommended standard titlebar; canonical state colors/accent; desktop live-mode depth; SwiftBar/Raycast fate; mobile artifact policy; multi-phone policy; preference scope; setup asset-refresh split.
- **Close by consensus:** Tauri shell; two-window dock mechanics; React 19; selective shadcn/Tailwind posture; Valibot protocol validation; no database for this refactor.
- **Implementation detail to resolve in Phase 5:** whether application activation policy toggles between `Regular` and `Accessory` when only dock mode is visible. This needs a focused native behavior check, not a reopened wrapper decision.
