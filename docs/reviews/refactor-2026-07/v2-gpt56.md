# Follow-up review: shell, server, storage, and React dependencies

## Q1 — Desktop wrapper: keep Tauri 2

### Recommendation, ranked

1. **Keep Tauri 2 and use two windows:** a normal activating `NSWindow` for floating room mode and a separately created dock `NSPanel`. This is the best fit from the code as it exists.
2. **Native SwiftUI/WKWebView is the only credible switch**, but not yet worth its migration and bridge cost. Reconsider only if macOS-native window behavior becomes a recurring source of Tauri/plugin defects.
3. **Do not switch to Electron.** It makes the ordinary window easy but does not improve the hard part enough to justify shipping Chromium and Node all day.
4. **Do not make desktop browser/PWA-only.** Keep that option for mobile. It cannot deliver the required dock behavior and would weaken local token/config and HID/window integration.

### Why Tauri still wins here

The current problem is not Tauri itself; it is that `panel/src-tauri/src/lib.rs:25-58` applies one dock-oriented policy to the only window. It sets the entire app to `Accessory`, converts `main` once with `to_panel()`, replaces its style mask with non-activating-panel behavior, raises it to floating level, and joins all Spaces/full-screen. `panel/src-tauri/tauri.conf.json:9-31` reinforces that with one undecorated, transparent, shadowless, always-on-top window. The owner’s new rule makes this simpler: stop asking one native object to change class and application personality at runtime.

Make `main` the normal room window. It should use regular activation, normal Space membership, normal focus/key behavior, and either a standard titlebar or explicitly chosen custom chrome. Create a second `dock` webview window only when dock mode is enabled, then convert that window once to `NSPanel` and apply non-activating, floating, `canJoinAllSpaces`, and full-screen-auxiliary behavior. Hide rather than destroy the inactive role if switching should be instant. Both load the same React bundle and connect to the same daemon snapshot; they need not share an in-process JS store. If only one may be visible, enforce that in the Tauri window adapter.

Tauri already exposes ordinary window controls such as `setAlwaysOnTop`, while the existing `tauri-nspanel` integration supplies the Mac-only behavior that ordinary webview APIs do not ([Tauri window API](https://tauri.app/reference/javascript/api/namespacewebviewwindow/)). This keeps the native surface tiny and isolated in Rust. It also avoids relying on a brittle `NSPanel` → `NSWindow` class reversal; the existing comment correctly says `to_panel` is a one-time conversion.

### Concrete alternatives

| Shell | Dock-mode fidelity | Tooling and maintenance | Resident cost | Migration/reuse verdict |
|---|---|---|---|---|
| **Tauri 2, two windows** | Existing plugin already produces a real `NSPanel`; current AppKit flags are almost exactly the desired dock policy. Apple defines `canJoinAllSpaces` for appearing in every Space ([AppKit docs](https://developer.apple.com/documentation/AppKit/NSWindow/CollectionBehavior-swift.struct?changes=_1)). | Rust/Cargo and the unsigned debug build/install/relaunch loop are real friction, but native code is currently about one small file. Improve scripts and dev flow rather than replace the shell. | Uses system WKWebView; no bundled Chromium/Node runtime. Appropriate for an always-running companion. | Lowest migration cost. Vite app and future workspace React packages remain unchanged. **Winner.** |
| **Native SwiftUI + WKWebView** | Best possible: instantiate `NSPanel` directly, own activation policy and Space behavior without a third-party plugin. | Xcode/Swift/AppKit replaces Rust rather than eliminating native tooling. Must build and maintain a JS↔native bridge for token/config, windows, dialogs, and future commands, plus packaging/install logic. SwiftUI adds little because React remains the UI. | Also system WebKit and potentially the leanest shell. | Feasible, but rewrites a working wrapper for modest gain. Keep as fallback if the panel plugin becomes unreliable. |
| **Electron** | `BrowserWindow` exposes `setAlwaysOnTop`, `setVisibleOnAllWorkspaces`, `focusable`, and Mac window types, but always-on-top remains a normal focusable window unless more native behavior is layered in; Electron itself notes process-type transformations around all-workspace visibility ([Electron BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window)). A genuinely non-activating NSPanel may still require native code or compromises. | JS-only packaging and hot reload are familiar, but Electron updates, signing/package configuration, and Chromium security/runtime maintenance replace Cargo pain. | Highest: bundles and runs Chromium plus Electron/Node for a tiny panel. | React reuse is perfect, but so is Tauri’s. Migration buys convenience on the easy window and little on the hard window. Reject. |
| **Browser/PWA only** | Cannot supply non-activating NSPanel behavior, reliable all-Spaces floating, native z-level, or dock geometry. | Almost no desktop build/install tooling. | Browser-tab/service-worker cost only. | Maximum React reuse but deletes the defining desktop affordance. Reject unless dock mode is abandoned entirely. |

The build pain should be addressed directly. Preserve `pnpm tauri build`, but add an explicit developer install command that builds, stages `Room.app`, replaces the installed bundle, and relaunches it only when requested; fail if the expected artifact is stale or absent. For ordinary React work, `pnpm tauri dev` should cover the main window without running `setup.sh`. Dock-native changes will still require a rebuild. This amends **v1 Phase 4’s open window-mechanics decision**: choose two Tauri windows now; only titlebar style remains an owner decision.

## Q2 — Server-side architecture and storage

### Glaring flaws beyond v1

#### 1. Fix restart recovery before broad server refactoring

`tts-server/src/index.ts:525-535` starts the queue watcher with `ignoreInitial: true`, and the in-memory `queue` begins empty (`:411-428`). Therefore queue files created while the daemon is stopped—or left after a crash before processing—are not automatically admitted when it starts. They remain visible/manual-playable, but auto mode does not resume them until some separate mechanism acts. This is the most important omission from v1 because it is a correctness and credit-safety recovery hole, not a scale concern.

On startup, scan existing `queue/*.json`, sort by the filename timestamp convention, and enqueue them through the existing `processQueueFile` path. Do not bypass `claimProcessing`, mute/live checks, post-lock admission checks, or the “already billed goes to played/failed” rules. Attach the watcher before or coordinate a scan watermark so a file arriving during startup cannot be missed or enqueued twice. This belongs in a new **Phase 1 recovery slice**, before command-service cleanup.

#### 2. Isolate control-plane latency; do not split into daemons yet

One Node process currently owns serial queue synthesis/playback, live transcript tailing, HID, DND, the panel WS server, and mobile HTTP/SSE (`tts-server/src/index.ts:470-489`). A thrown callback is often locally contained, and child audio processes are supervised, so this is not reckless. But synchronous work on the event loop is widespread: `buildPanelSnapshot()` scans state, queue, and played files; `/thread` reads and parses the entire transcript; `/replay-list` scans sidecars; session-picker/catalog functions scan Claude project directories. A large transcript request or catalog refresh can delay control messages, SSE heartbeats, and playback bookkeeping in the same process.

Do **not** create multiple services/processes for a family-of-one app. First establish one cached `SnapshotService` (already in v1), bound thread reads, and cache session-catalog/picker results by directory mtime or a short TTL. Move unusually heavy transcript parsing to async streaming or a worker only if measurement shows pauses. Keep synthesis serialization and filesystem locks in one authority. The two network servers are sensible security/transport boundaries—localhost tokened WS versus token-gated LAN HTTP—and should remain two listeners over shared services, not be merged for aesthetic purity.

#### 3. Make crash state and disk growth explicit

Processing markers and stream locks already reclaim dead PIDs (`audio.ts:235-319`), progressive replay `.part` files are pruned after an hour, and replay is capped at 20 complete MP3s (`audio.ts:469-488`). Those are good recovery choices. The remaining gaps are:

- `logs/hook.log` is synchronously appended forever by `logger.ts:7-18`, while `server.log` also grows by shell redirection. Add size-based rotation at daemon start (and perhaps daily), retaining a few files. This is operational hygiene, not a DB use case.
- `failed/` has no visible retention policy. Add a conservative count/age cleanup command, never silent deletion in a request path.
- `played/` pruning is hook-triggered through `cleanup_played.sh`, not daemon-owned. Keep the IPC files, but run the same bounded retention on startup so missed hook cleanup cannot cause indefinite growth.
- `acquireLock()` does check a prior PID and uses same-process serialization, but its stale-check then plain `writeFileSync` is not an atomic interprocess acquisition (`audio.ts:287-299`). `claimProcessing` correctly uses `wx`; the stream lock should use the same exclusive-create/recheck pattern without changing its file contract. This is a narrow credit-safety hardening, not a lock-library rewrite.

### Does server work reorder the UI plan?

Slightly. The protocol-first premise stands. Amend the old Phase 1 as follows:

1. Phase 0 remains baseline + protocol.
2. **Phase 1A:** startup queue reconciliation, atomic stream-lock acquisition, bounded log/failed/played retention.
3. **Phase 1B:** command/picker services, snapshot memoization, fail-loud deploy artifact path.
4. Continue shared client and React migration.

The recovery slice is small and should land before UI work starts exercising reconnects and daemon restarts. Do not pull `audio.ts`/`hid.ts` facade splits forward; they remain optional after the UI cutover. Do not block React on worker threads, async filesystem conversion, or process decomposition.

### Storage verdict: no database now; explicitly reject Supabase

The filesystem is adequate at this scale and is already bounded where it matters most: replay has 20 audio items and played defaults to 50. A database cannot replace the queue/state/lock/pid files, so adding SQLite today would create dual-write or indexing/reconciliation work without removing the scans that hooks depend on. Snapshot performance improves more directly by computing once per revision and maintaining small in-memory indexes. Thread history is sourced from Claude’s JSONL transcript; copying it into SQLite would introduce invalidation and lineage complexity merely to render the last ~40 messages. Session catalog data also comes from external registries/directories whose liveness still must be checked.

Supabase is worse: it adds network availability, credentials, privacy exposure, migrations, and hosted lifecycle to a local Mac companion, while it cannot improve the authoritative local IPC path. There is no multi-user or cross-device durable dataset here that earns it.

Reconsider **local SQLite only** when a concrete feature crosses a threshold: unbounded searchable history across many sessions, analytics over months of playback, replay retention in the thousands, or repeated measured transcript/catalog scans that in-memory caching cannot solve. If that happens, use it as a rebuildable derived index with filesystem/JSONL as source of truth; never put locks, queue admission, billing markers, or hook-visible state in it. This leaves v1’s “no database” target unchanged, but changes it from a blanket posture to a measured trigger.

## Q3 — React dependency posture: adopt primitives and focused libraries

### 1. Use selected shadcn/ui source, Tailwind, and Radix—do not install a whole visual system

This **amends v1’s “plain CSS, no component framework” decision**. Initialize Tailwind for the two React apps/shared UI package and vendor a deliberately small set of shadcn components into `packages/ui`: `Button`, `ToggleGroup`/segmented control, `Dialog`, `Sheet`, `Popover`, `Tooltip`, and `DropdownMenu`; use a proven toast implementation such as shadcn’s current recommended toast component rather than inventing a queue and live-region. These are exactly the focus management, escape handling, portals, keyboard navigation, and ARIA behaviors least worth hand-rolling.

Do not bulk-import shadcn blocks, layouts, default palette, typography, cards, or form architecture. `RoomGrid`, `AgentCard`, `NowPlaying`, karaoke, picker rows, and live activity remain bespoke domain components. shadcn is source-owned rather than an opaque runtime library, which suits this personal monorepo; its own model is copied, customizable component source ([shadcn introduction](https://ui-private.shadcn.com/docs)). Radix is accessible, unstyled, incrementally adoptable, and tree-shakeable ([Radix introduction](https://www.radix-ui.com/primitives/docs/overview/introduction)); it accepts ordinary classes and exposes state through data attributes, so it does not require abandoning CSS variables ([Radix styling](https://www.radix-ui.com/primitives/docs/guides/styling)).

Semantic tokens remain the authority:

```css
:root {
  --room-bg: ...;
  --room-surface: ...;
  --room-accent: ...;
  --state-working: ...;
  --state-hand-raised: ...;
}
```

Map Tailwind utilities to those variables and keep platform layout variables beside them. Never encode `working` as `amber-*` or `hand-raised` as `blue-*`; semantic names preserve the v1 color-resolution requirement. Tailwind’s generated CSS is build-pruned, and used Radix primitives are tree-shaken, so mobile pays for selected behavior rather than an entire widget runtime. The cost is a more involved styling toolchain and some generated-source upkeep; the saved accessibility/interaction work earns it here.

### 2. Package decisions, ranked

| Area | Decision | What it replaces / why it earns its place |
|---|---|---|
| **Protocol validation** | **Adopt Valibot in `packages/protocol`.** | Replaces hand-maintained runtime guards and keeps inferred TS types adjacent to schemas. Its modular imports start very small and are designed for tree-shaking ([Valibot introduction](https://valibot.dev/guides/introduction/)). Prefer it over Zod for the mobile/shared wire boundary; Zod would also be correct, but its larger, more fluent API brings no benefit to these few closed message unions. Validate inbound snapshots/events/results at transport boundaries; commands server-side too. |
| **WebSocket reconnect** | **Adopt `reconnecting-websocket` (or an equivalently transport-neutral maintained client), behind `WsTransport`.** | Replaces panel’s fixed reconnect timer (`panel/src/main.ts:262-267,2852+`) with exponential backoff, jitter, intentional-close semantics, connection timeout, and queued sends. Do not use a React hook package: the socket belongs below React in `room-client`, and two window roots must not own accidental duplicate sockets. |
| **SSE reconnect** | **Keep native `EventSource`, but make the protocol resumable.** | Native SSE already reconnects. Add `retry:` guidance, event IDs/revisions, and ignore snapshots at or below the latest revision. A fetch-SSE library is unnecessary unless header-based auth, POST streams, or abortable custom requests become required; cookie/query-token EventSource already fits this server. |
| **Client state** | **Keep the v1 external store + `useSyncExternalStore`; reject Zustand/Jotai.** | `RoomClient` already needs a framework-neutral snapshot, connection, notices, and pending-command store. Zustand would mostly wrap the same subscription mechanics; Jotai would fragment a single atomic server snapshot into atoms and complicate revision ordering. Reassess only if substantial local cross-feature workflows appear after migration. |
| **Server queries/cache** | **Reject TanStack Query for the room snapshot; initially reject it altogether.** | The canonical state is pushed as whole snapshots, not fetched/staled/refetched resources. TanStack Query is built around query keys, invalidation, and background refetch ([query invalidation](https://tanstack.com/query/latest/docs/react/guides/query-invalidation?from=reactQueryV3)); layering it over SSE would create two authorities. Picker/thread/replay are few imperative queries and can use a small typed cache in `RoomClient`. Reconsider Query only if those read models multiply and need dedupe, cancellation, pagination, and stale policies independently. |
| **Markdown** | **Adopt `react-markdown` + `remark-gfm` + `rehype-sanitize`; reject `marked` + `DOMPurify` as the default path.** | Replaces both `panel/src/markdown.ts` and mobile’s `mdToHtml`/`innerHTML` (`mobile.html:2073-2151`). Render to React elements with an explicit schema and platform link component; do not generate an HTML string merely to sanitize it. Disable raw HTML. This gives one auditable policy and avoids `dangerouslySetInnerHTML`. |
| **Class composition/variants** | **Adopt `clsx` and `class-variance-authority`; add `tailwind-merge` only inside vendored shadcn primitives that need consumer override merging.** | `clsx` removes conditional string noise; CVA makes button/badge/state variants typed and consistent. Do not run every domain class through `tailwind-merge`; semantic component APIs are clearer. shadcn’s manual setup itself uses this small class/variant stack ([manual installation](https://ui.shadcn.com/docs/installation/manual?trk=public_post_comment-text)). |
| **Virtualization** | **None now.** | Room cards, replay (20), and thread tail (~40 displayed) are bounded. `react-window`/TanStack Virtual would complicate dynamic chat heights, focus, and scroll anchoring for no measurable gain. Add only after profiling an intentionally unbounded history feature. |
| **Dates/times** | **No date library.** | Use `Intl.DateTimeFormat`, `Intl.RelativeTimeFormat`, and tiny elapsed-duration helpers. The app mainly formats ISO timestamps and live elapsed seconds; date-fns/Day.js does not earn its bundle/API surface yet. |
| **Icons** | **Adopt one tree-shakeable icon set (Lucide React, already conventional with shadcn).** | Replaces copied inline SVG/string icons and improves naming/consistency. Wrap icons in shared `IconButton` so accessible labels remain mandatory. |

The networking distinction matters: “do not reinvent wheels” does not mean “put React Query around a stream.” Use a proven reconnecting socket where failure/backoff logic is genuinely tricky; retain native EventSource where the browser already provides the wheel.

## Q4 — What changes in the v1 consensus

### Amended target structure

```text
packages/
  protocol/       # Valibot schemas + inferred wire types
  room-client/    # external store; reconnecting WS + native SSE/HTTP adapters
  ui/             # semantic tokens, Tailwind config/preset, selected vendored
                  # shadcn/Radix primitives, domain React components, Markdown
panel/            # stays in place; normal main window + separate dock NSPanel
packages/mobile/  # Vite React SPA
tts-server/
  src/services/   # snapshot, recovery, command, picker/catalog services
```

No initial directory move, no database, no Electron, no Next.js, no Zustand/Jotai, and no TanStack Query. Filesystem IPC and every credit-safety guard remain unchanged.

### Amended phases

1. **Baseline + protocol:** unchanged in intent; use Valibot schemas as the runtime contract.
2. **Recovery + bounded storage:** new early slice—reconcile existing queue files safely at startup, make stream-lock acquisition exclusive, rotate logs, and bound failed/played cleanup.
3. **Server services + deploy hygiene:** v1 Phase 1 otherwise remains; snapshot memoization, command/picker seams, and built-mobile staging. Add short-lived picker/catalog caching and bounded thread work, not a process split.
4. **Shared client under old UIs:** retain `useSyncExternalStore`; add a transport-neutral reconnecting WS client and native revision-aware EventSource. No global state/query library.
5. **Tokens + leaf islands:** amend to Tailwind mapped onto semantic CSS variables and a curated shadcn/Radix primitive layer; migrate one shared sanitized React markdown renderer here.
6. **Desktop React shell:** keep Tauri and decide now on two windows—normal activating main plus dock-only NSPanel. Floating titlebar/chrome is still an owner choice.
7. **Mobile React shell/cutover:** unchanged; consume the same primitives/domain components, with phone audio last.
8. **Delete + legacy audit:** unchanged.
9. **Optional server splits:** unchanged; no premature worker/process/DB architecture.

### Owner decisions after this review

1. **Floating chrome only:** standard macOS titlebar (recommended) or custom web chrome. The shell and two-window mechanics are no longer open recommendations.
2. **Canonical state colors/accent:** unchanged from v1; semantic variables prevent the choice from leaking into component names.
3. **Desktop live-mode depth, SwiftBar/Raycast fate, mobile artifact policy, multi-phone policy, preference scope, and setup asset-refresh split:** unchanged from v1.
4. **Dependency posture:** approve the recommended curated shadcn/Radix + Tailwind layer and Valibot/reconnecting socket/React-markdown stack. This is the material reversal from v1’s hand-rolled primitive stance.
5. **Database:** no owner choice is needed now. Reopen only for an explicit searchable long-term history feature or measured scan bottleneck.
