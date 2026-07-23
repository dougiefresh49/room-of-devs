# Phase 4 design — desktop React shell + two windows (panel only)

Status: implemented 2026-07-22 after Sol adversarial critique (4 blockers,
13 majors; resolutions appended at the end — read them WITH the design,
several sections below are amended by them).
Scope per spec: `docs/shipped/spec-ui-refactor.md` Phase 4. Mobile.html frozen until
Phase 5. Daemon touched ONLY for the button-patch null fix (sanctioned).

## Ship plan: two deploys

- **4a — React shell, single window.** Replace main.ts's string-template
  renderer with a real component tree; the Phase 3 portal seam (host.tsx /
  syncIslands / placeholder contract) dies; islands become ordinary
  children. Lipsync/blink migrate to refs + rAF. Stage-vocab rename + live
  indicator. Settings componentized + button-null fix (the one daemon
  change). Platform adapter lands here. lib.rs UNTOUCHED in 4a — the sole
  window keeps today's NSPanel behavior, so window parity is trivially
  preserved while the whole DOM layer changes underneath it.
- **4b — two windows.** lib.rs rework: `main` becomes a normal ACTIVATING
  NSWindow with the standard macOS titlebar (owner decision #1); `dock` is
  a second webview window converted once via `to_panel()` carrying today's
  policy (float level 4, non-activating mask + resizable, CanJoinAllSpaces,
  FullScreenAuxiliary). Role-aware activation policy. Mode switch = window
  visibility swap.

Each deploy is independently shippable and verified (typecheck, fixtures,
vite build, verify-live, Sol diff review, codex computer-use).

## 4a — component tree

```
panel/src/
  main.tsx            # bootstrap: RoomClient, platform adapter, stage
                      # engine, server-data store, createRoot(<App/>)
  app/
    App.tsx           # window-role switch (4b) + view state: room | picker
                      # | settings | dock; toasts
    RoomView.tsx      # header strip, cards grid, summary pane, transport
    AgentCard.tsx     # card chrome + grant/PTT gesture + rename + leaves
    DockView.tsx      # spotlight + pill + captions (4a: in-window swap,
                      #   exactly like today; 4b: mounted in dock window)
    DockAgent.tsx
    SpotlightCol.tsx
    PickerView.tsx    # tabs, browse row, persona chips, spawn flags (Terra)
    SettingsView.tsx  # general/buttons/help tabs (Terra)
    server-data.ts    # external store fed by client.onEvent: known dirs,
                      # resumable, buttons, settings, voices, shortcuts,
                      # captured, notices/errors → toasts, staleSessions
    view-state.ts     # tiny external store: dockMode, pickerOpen/settings
                      # tab, captions, summary-pane, dismissed keys, toast
  stage/
    frames.ts         # pure frame/mood/alignment logic (moved from main.ts)
    engine.ts         # avatar ref registry + ONE rAF loop (lipsync+blink)
    preload.ts        # frame preloading + expressions manifest
  platform/
    types.ts          # PlatformAdapter interface
    tauri.ts          # the only file importing @tauri-apps/*
  islands/            # DELETED (host.tsx, ui-state.ts move/absorb)
  ui-state.ts         # kill-arm + swap-popover external store (kept)
```

DOM parity strategy: **JSX mirrors the legacy templates' exact class names
and structure**; style.css keeps styling them. The rewrite changes who
renders, not what renders. New UI (live indicator) is additive and
documented. This keeps visual parity reviewable and lets the dead-CSS
sweep be a separate mechanical pass at the end.

### State model

- Domain state: `useSyncExternalStore(client.subscribe, client.getState)`
  — unchanged from Phase 3.
- Server-pushed non-snapshot data (picker lists, buttons, settings,
  voices, shortcuts, captured, notice/error): today a 100-line switch
  mutating module vars. Becomes `server-data.ts`, an external store fed by
  ONE `client.onEvent` subscription at bootstrap; views read slices via
  useSyncExternalStore. Toast side effects (launch/error/timeouts) live
  here too — they are event-driven, not render-driven. `snap` (window
  corner snap) events call the platform adapter directly.
- View state (dockMode, pickerOpen, settingsTab, captions, summary pane
  expanded/dismissed, renamingSessionId, browseDir, learnCapture):
  `view-state.ts` external store — NOT React component state, because (a)
  the window-action handlers and server-event handlers both touch it, and
  (b) 4b's `snap`/mode plumbing needs it outside any component. localStorage
  persistence for captions/summary-pane/spawn-flags stays as is.
- Kill-arm + swap popover: keep the existing `ui-state.ts` external store
  as-is. React state would work now that remounts are gone, but the store
  is proven, pruned on snapshot, and shared logic with pruneUiState — not
  worth churning. (Logged as a deliberate keep.)

### Grant/PTT gesture (single ownership, event firewall)

Ownership transfers WHOLLY from the legacy `bindGrantTargets` to
`AgentCard` / `DockAgent` (React). Same semantics, verbatim: mousedown →
300ms hold timer → ptt start/stop; click (not suppressed by hold, not on a
non-grant target) → `client.grant`. The `isNonGrantTarget` firewall moves
with it: any button other than the card surface itself, or anything inside
`.card-actions/.dock-actions/.spotlight-actions`, is not a grant surface —
including cluster gaps (the Phase 3 improvement stays). React synthetic
mousedown/click on the card element replaces the native listeners;
ActionCluster keeps stopPropagation. No second dispatcher exists anywhere
after the cut — grep gate: `bindGrantTargets` has zero references.

### Lipsync/blink → refs + rAF (spec shape)

- `AvatarImg` component (used by card, dock pill, spotlight): registers
  its `<img>` element in `stage/engine.ts`'s registry
  (`Map<sessionId, Set<HTMLImageElement>>`) via ref callback; deregisters
  on unmount. React renders the INITIAL src only; the engine owns
  subsequent frame flips by direct `img.src` mutation. React never
  re-renders on frame changes; karaoke/word timing stays out of state.
- ONE rAF loop drives both lipsync and blink (replaces the 70ms lipsync
  setInterval + 100ms blink setInterval + querySelector scans). Per tick:
  compute the stage frame for the now-playing session (same
  `currentMouthFrame` logic, moved verbatim to `stage/frames.ts`), apply
  blink windows/schedules for all registered avatars, set `src` only on
  change. rAF auto-pauses when the window is hidden/occluded — a free CPU
  win in 4b's hidden-window mode switch (the old intervals kept ticking).
- The engine subscribes to the client store OUTSIDE React for its inputs
  (nowPlaying, paused, agents, connected) — same data the old module vars
  mirrored. `applySnapshot`'s pause-anchor arithmetic (SIGSTOP wall-clock
  compensation) moves into the engine with the anchor it adjusts.
- Blink cadence: rAF tick guards on elapsed time so blink checks run at
  ~100ms granularity, preserving today's feel; lipsync frame picks run
  every frame (they're a few comparisons; the old 70ms tick was a
  compromise, not a target).

### Stage-vocab rename + live indicator (owner decision #3)

- `isSessionLive`/`isLipsyncActive`/`ActionClusterMode "live"` collide
  with daemon live mode. Renames: `isStageActive(sessionId)` (Mac lipsync
  stage), `isStageWorthy` → `isSpotlightWorthy`, cluster mode `"live"` →
  `"stage"` (`ClusterMode = "stage" | "summary" | "idle"` in
  ActionCluster). CSS class `spotlight-ring.live` → `.on-stage` (style.css
  updated in the same commit — mechanical).
- NEW `LiveBadge` leaf in @room/ui: renders when `agent.live?.on` — small
  pill ("LIVE" dot, `--room-accent`), title shows `toolCount` + last
  activity label. Mounted on the card chips row and dock spotlight.
  Indicator only: no toggle, no set_live sends from desktop.

### Settings componentization + button-patch null fix (sanctioned daemon change)

Panel (Terra): `SettingsView` + `PickerView` per the exact legacy DOM.
Wire fix, both sides, deployed with 4a:

- `packages/protocol` `ButtonPatchSchema`: every field becomes
  `v.optional(v.nullable(v.string()))` — null is now a legal wire value
  meaning "clear this field".
- Server `parseButtonPatch`: accepts string | null | undefined per field
  (undefined = leave alone, null = clear). `applyButtonPatch` in
  panel-ws.ts already treats `""` as clear; null normalizes to the same
  branch (`patch.character === null` → delete). `name: null` stays
  invalid (bad_message) — a button always has a name; panel never sends it.
- Panel: `sendButtonPatch` loses its `as unknown as Command` cast — the
  null-bearing patch is now schema-legal. Assign/unassign/learn flows keep
  emitting exactly today's bytes, which now WORK server-side.
- Verify free: patch a button from settings, inspect
  `~/.cursor/tts/state`-adjacent `arcade_buttons.json` (no synthesis).
- Deploy: `~/.cursor/tts/scripts/tts-server.sh restart` (daemon), panel
  bundle via setup.sh.

### Toasts, rename, picker mechanics

- Toast stays the legacy single-toast model (`view-state.ts` + the same
  .toast markup/classes); sonner stays vendored-but-unused. Not worth a
  behavior change this phase.
- Rename-in-place, dock hover-intent (250ms leave grace), browse row,
  spawn flags/model (localStorage), learn-capture flow: all move into
  their owning components with identical timings/semantics.
- Window actions (close/dock/captions/summary/picker/settings) call
  view-state + platform adapter; drag regions become a small
  `useDragRegion` handler using `platform.startDragging()` with the same
  no-drag guards.

### Platform adapter

```ts
interface PlatformAdapter {
  wsUrl(): Promise<string>;                 // ws_token invoke
  pickFolder(): Promise<string | null>;     // dialog open
  startDragging(): void;
  closeWindow(): void;                      // 4a: close sole window
  snapToCorner(corner: "bl"|"br"|"bc"|"tr"): Promise<void>;
  enterDockLayout(width: number, height: number): Promise<void>; // size+position
  exitDockLayout(): Promise<void>;          // restore saved frame (4a only)
  // 4b additions:
  setRoomMode(mode: "floating" | "dock"): Promise<void>;
}
```

`platform/tauri.ts` is the ONLY importer of `@tauri-apps/*`. The dock
geometry MATH (dockWidth/dockHeight from agent count + spotlight state)
stays in DockView-land (it's layout policy, and it feeds the adapter's
resize call); monitor/scale/position mechanics live behind the adapter.
Components receive the adapter via a module import of a singleton — not
props-drilled, not context; there is exactly one platform per process and
tests aren't a goal (no test suite by policy).

### Tailwind cascade-layer / preflight policy (formalized, Sol's Phase 3 rec)

- **No global preflight, permanently.** The app's CSS is a curated
  stylesheet, not a reset-dependent utility soup; preflight would restyle
  every button/img for zero gain and real parity risk.
- Formal order: `tokens.css` (unlayered variables) → Tailwind
  `theme`/`utilities` (in `@layer`) → `style.css` app rules (unlayered,
  intentionally win over utilities). New components may use utilities for
  NEW styling; existing visuals keep their semantic classes.
- Vendored primitives get a **scoped reset** via their own cva base
  classes (`appearance-none border-0 bg-transparent …` where needed) —
  the Popover already works this way; codify it for any primitive we
  activate later.
- Dead-rule sweep AFTER the shell lands (grok/composer worktree): delete
  style.css rules whose selectors no longer appear in any JSX/TSX, and the
  legacy-only helpers (`.md-link` stays — Markdown emits it).

## 4b — two windows

### Window inventory (tauri.conf.json)

- `main`: the floating room. `decorations: true` (standard titlebar,
  owner decision #1), `alwaysOnTop: false`, transparent: false, normal
  activating window. Keeps 380×300 default, resizable, min 300×240.
- `dock`: `visible: false` at launch, `decorations: false`,
  `transparent: true`, `shadow: false`, sized/positioned by the adapter on
  entry. Converted ONCE to NSPanel in lib.rs setup with today's exact
  policy: float level 4, style mask Resizable|NonActivatingPanel,
  CanJoinAllSpaces|FullScreenAuxiliary. This is the only to_panel() call.

### lib.rs

```rust
setup:
  app.set_activation_policy(Regular);          // floating is primary at launch
  convert "dock" window to NSPanel (hidden);   // policy as above
commands:
  ws_token (unchanged)
  set_room_mode(mode):                         // the mode authority
    floating: dock.hide(); main.show(); policy Regular
    dock:     main.hide(); dock.show_without_activating? (NSPanel orderFront)
              policy Accessory
```

- **Activation policy is role-aware** (spec flag): `Regular` while the
  floating room is primary — it appears in Dock/⌘-Tab and activates
  normally; `Accessory` in dock mode — no Dock icon, panel never steals
  focus. Runtime switching uses `AppHandle::set_activation_policy`
  (Tauri 2 exposes it at runtime on macOS; verify at build — fallback is
  a direct `NSApp setActivationPolicy:` msg_send via the objc crate that
  tauri_nspanel already pulls in). Behavior to verify post-deploy: policy
  flips both directions without window-server weirdness (spec explicitly
  asks for this check).
- **Hide, not destroy, on mode switch** (decision logged): `to_panel()`
  is a one-shot conversion, webview recreate is slow and would re-run the
  whole JS bootstrap per switch; hidden windows cost only memory and rAF
  stops automatically in hidden webviews. Both windows live for the app's
  lifetime.
- Close semantics: the main window's close button (standard titlebar red
  light or in-app ✕) quits the app — parity with today, where closing the
  sole window exits. Implemented via on_window_event CloseRequested →
  app.exit (dock's hidden window would otherwise keep the process alive).
  The dock has no close affordance (unchanged).

### Two realms

Same Vite bundle in both windows; `App.tsx` switches on
`getCurrentWindow().label` (via adapter: `platform.windowRole()`):
`main` → room/picker/settings tree; `dock` → DockView. Each realm mounts
its own RoomClient (own WS connection — the daemon already serves multiple
panel sockets), its own stage engine, its own server-data store.
Coordination happens via daemon snapshots only (spec invariant). View
state is per-realm; the only cross-realm action is the mode switch, which
is a Rust command (window visibility is the shared truth, no JS channel).
The hidden window's WS stays connected (cheap, loopback) — its rAF is
parked, so CPU is negligible.

`dockMode` as in-window state dies in 4b: the main window never renders
DockView, the dock window only renders it. enterDockLayout applies to the
dock window; the main window's frame is simply left alone while hidden
(savedWindowFrame restore logic dies).

### Dock parity requirements (must hold after 4b)

Float over full-screen Spaces exactly like today; never steals focus
(NonActivatingPanel); hover clusters + captions + spotlight + grant/PTT
all work identically; drag works from the pill; captions toggle resizes
correctly. The floating room, conversely, now ACTIVATES on click (typing
in rename/settings inputs no longer needs focus workarounds) and shows a
standard titlebar — deliberate deltas, logged in the baseline doc.

## Verification

Per deploy: `pnpm typecheck` (all packages), `pnpm check-fixtures`, panel
`vite build`, `verify-live.ts` against the running daemon, Sol diff
review (codex exec), then deploy (4a: tts-server.sh restart for the
button fix + panel build/setup/relaunch; 4b: panel only) and codex
computer-use. Computer-use prompts MUST state: accessibility presses do
not work on hover-gated controls — physical mouse hover ≥500ms +
coordinate clicks; timing-gated checks via one awaited devtools console
expression.

Post-deploy checks (4a): every action single-fire (transport, cluster,
swap, kill-arm two-click, ONE budgeted grant max), queued preview,
popover, settings tabs + button assign/unassign persists into
arcade_buttons.json (free — file inspect), picker spawn-flags persist,
rename, toasts, lipsync smooth under rAF during `signal.ts replay "" 1`
(free), live indicator visible when a session has live on (check with a
scripted `live_sessions.json` entry if none live).
Post-deploy checks (4b): both windows + correct chrome/activation
(floating activates, standard titlebar; dock floats, never steals focus,
joins all Spaces incl. over a full-screen app), mode switch both
directions repeatedly, close-quits-app, snap corners, dock geometry at
various agent counts.

## Delegation

- In-session (fable): shell architecture (App/RoomView/AgentCard/DockView,
  stores, gesture), stage engine, lib.rs + tauri.conf, merges.
- Terra (codex exec): SettingsView + PickerView against exact legacy DOM
  spec; platform adapter mechanics; protocol+server button-null fix per
  the spec above.
- grok/composer (cursor-agent worktree): post-shell dead-CSS/dead-code
  sweep; class rename mechanical pass (spotlight `.live` → `.on-stage`).
- Sol: this critique + pre-deploy diff reviews.

## Open questions for critique

1. Two RoomClients (two WS connections) in 4b — any daemon-side gotcha
   (token single-use? per-socket state?) that argues for lazy-connecting
   the hidden window instead?
2. Hide-vs-destroy: any NSPanel/Spaces state that goes stale on a hidden
   panel (e.g. collection behavior after Space changes) arguing for
   re-asserting policy on each show?
3. rAF in a NonActivatingPanel over a full-screen Space — does WebKit
   throttle rAF for non-key windows? (If so, blink/lipsync in dock mode
   needs a visibility-independent fallback timer.)
4. The grant gesture as React synthetic events vs native listeners — any
   ordering hazard with ActionCluster's stopPropagation (React 19
   delegates at the root)?
5. Anything in the 4a bootstrap order (client → stores → engine → root
   render) that races the first snapshot?

## Sol critique resolutions (gpt-5.6-sol, high effort — 4 blockers, 13 majors)

Full report: scratchpad sol-phase4-critique.md (session-local); substance
captured here. Numbers match Sol's findings.

| # | Finding | Resolution |
|---|---|---|
| 1 | BLOCKER: dock webview has zero Tauri permissions | 4b adds a `dock` capability set (ws_token, set_room_mode, size/position/monitor/drag — no dialog, no close) and keeps `main`'s list + set_room_mode. Capability check is part of the 4b build gate. |
| 2 | BLOCKER: null contract would throw in `.trim()`; schema/parser gaps | `name` stays `optional(string)` (never nullable); only character/action/hold_action/color/notes become `optional(nullable(string))`. parseButtonPatch accepts null for clearable fields only; applyButtonPatch normalizes null→"" before trim ("" remains a legal clear alias). Patch with BOTH character and action non-empty → bad_message (no order-dependent resolution). Protocol fixtures gain null/""/{}/name:null cases. Daemon deploys before the panel bundle. |
| 3 | BLOCKER: mode switch was pseudocode; plugin `show()` makes the panel KEY | lib.rs gets a serialized mode state machine (Mutex-held mode, idempotent repeats, no concurrent transitions). Dock entry: capture main's monitor → move dock onto it → reassert panel level/mask/collection behavior → `order_front_regardless()` (NEVER the plugin's key-making `show()`) → hide main → Accessory. Floating entry: Regular → show main → explicit focus (user-initiated) → order out dock. Rollback to previous visible window on failure. |
| 4 | BLOCKER: two RoomClients lose the client-side grant-dedupe boundary | Daemon stays untouched (kickoff scope). Panel-level cross-realm belt: grants write `room_grant_pending:<sessionId>`=timestamp to localStorage (shared across both webviews — verified at 4b test time); dispatch checks client pendingGrants AND fresh (<25s) localStorage entries; spinner renders from either. Server claim markers stay the billing authority (same queue item can't double-synthesize). Residual accepted + documented: a grant on a NEW superseding item from the other realm is a deliberate user click on rendered state, not a double-fire. |
| 5 | Two titlebars in 4b (native decorations + legacy header) | HeaderStrip gets a `native` variant now (4a: parity chrome with title/drag/close; 4b main window: drops in-app close + title + drag handlers, keeps conn dot/picker/settings/summary/dock buttons). Logged as a deliberate 4b delta. |
| 6 | Hidden dock window infers the wrong monitor | Rust captures MAIN's current monitor during set_room_mode("dock") and moves the dock window onto it before ordering front; the dock realm's own resize math then sees the right monitor from currentMonitor(). |
| 7 | HID snap moves both windows | Snap handler no-ops unless its window is visible (document.visibilityState + adapter isVisible). Only one window is ever visible by construction. |
| 8 | Portaled popover content bubbles synthetic events into the card gesture | Two firewalls: PopoverContent stops pointerdown/mousedown/click propagation itself (not just its buttons), AND the gesture's isNonGrantTarget rejects any target inside `[data-no-grant]` (stamped on all overlay content). React-tree bubbling from portals is the attack path — both belts land with the gesture move. |
| 9 | React can orphan an active PTT hold | Gesture state (hold timer, pttActive, suppressClick) lives in refs inside usePttGrant; effect cleanup clears the timer and sends exactly one `ptt stop` if active; pointercancel/window blur/visibility loss end the hold; dock gesture binds only to `.dock-avatar-btn` (legacy parity). |
| 10 | rAF-only lipsync unproven in a non-key NSPanel over fullscreen Spaces | rAF primary + watchdog interval: if no rAF tick for >150ms while the doc is visible, the watchdog runs the same tick fn (70ms cadence). rAF gap instrumentation checked during 4b dock/fullscreen verification. |
| 11 | Engine lifecycle underspecified (pause anchor, blink deadlines, pruning) | stage/engine.ts owns an explicit state: snapshot identity, lipsync anchor, pause-start, per-session blink schedules, ref registry, disposed flag. Wake after hidden: expired blinks restore + reschedule from now (no replay). Per-session state prunes when the agent leaves the snapshot or its last ref unregisters. dispose() cancels rAF + watchdog + store subscription. |
| 12 | Persistent React img can stay hidden after onerror; React src prop fights the engine | AvatarImg is keyed by `sessionId:character` (remount resets error state on character swap); React renders a neutral initial src once; engine applies the live frame immediately on ref registration and owns src thereafter; onLoad un-hides img over fallback. |
| 13 | server-data store must keep per-surface error semantics | The legacy switch's semantics move verbatim: staleSessions cleared on every applied snapshot; unsupported/unknown_command disables only the surface that's open (settings-general vs buttons vs help writable flags); successful replies re-enable; no_device cancels learn capture before its toast. Encoded as an explicit reducer, not "errors → toasts". |
| 14 | React range port would spam set_setting per step | Slider drag is local state (label preview only); ONE commit on pointerup/keyup/blur with last-committed dedup. Stated explicitly in the Terra spec. |
| 15 | Summary dismissal was cross-view; per-realm split changes it | Accepted as a deliberate 4b delta: dismissal (and caption expansion) become per-realm — dismissing in the floating room won't suppress the dock bubble after a mode switch. Documented in baseline deltas; revisit only if it annoys in practice. |
| 16 | Timing/focus behaviors asserted "identical" without a spec | Behavior table added below; each implemented with the exact legacy timings and cleanup. |
| 17 | Dead-CSS sweep unsafe (dynamic classes) and too early | Sweep postponed until after 4b ships; dynamic class families (`state-*`, `actions-*`, spotlight/dock combos) enumerated in an allowlist; sweep uses the allowlist + grep of literal maps, not raw JSX text search. |

### Behavior-transition table (Sol #16)

| Behavior | State lives in | Trigger/timing | Cleanup |
|---|---|---|---|
| Spotlight enter animation | stage/view (enterKey + until) | 280ms window keyed by `${sessionId}:${startedAt}` (pending: `pending:${sessionId}`) | key change resets |
| Picker/settings back | component onPointerDown (before click/focus churn) | pointerdown navigates; click suppressed | — |
| Rename | view-state.renamingSessionId | dblclick enters (focus+select); Enter commits set_nickname; Escape AND blur cancel WITHOUT commit | snapshot prune if agent gone |
| Launch toast | view-state.toast + timer | 2000ms → toast clears AND picker closes | clearToastTimers on open/close |
| Error toast | view-state.toast + timer | 2600ms → clears | same |
| Learn capture | server-data.learnCapture + timer | 15000ms timeout → error toast; no_device cancels; view close cancels | cancelLearnCapture |
| Rebind order | — | set_button(new) BEFORE remove_button(old); no-op remove when same idx | — |
| Dock hover grace | view-state.dockHover + timer | 250ms leave grace; enter clears pending hide + steals intent | timer cleared on re-enter |
| Kill arm | ui-state store | 8000ms auto-disarm; second click confirms | pruneUiState on snapshot |
| Grant/PTT | usePttGrant refs | 300ms hold → ptt start; up/leave/cancel/blur → stop; click suppressed after hold | effect cleanup sends stop if active |
| Speed slider | local component state | drag = label preview only; ONE set_setting on release | — |
