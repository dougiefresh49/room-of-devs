# Architecture review and UI refactor spec

Scope: repository state reviewed 2026-07-21. Severity means risk to correctness, maintainability, or safe delivery of this personal long-lived tool—not internet-scale operational risk. The filesystem contract under `~/.cursor/tts/` is treated as fixed.

## 1. Architecture concerns

### Critical

1. **There is no shared, versioned UI contract.** `tts-server/src/state-watch.ts:34-70` defines `AgentView` and `PanelSnapshot`, while `panel/src/main.ts:15-43` re-declares partial equivalents and `tts-server/mobile.html:1558` begins from an untyped shape. `NowPlaying` is likewise server-owned in `audio.ts` and copied into the panel. Commands are defined and validated in `tts-server/src/panel-ws.ts:67-105,548-725`, but each UI constructs anonymous objects. A server field or command change can compile cleanly while breaking one client at runtime. This is the first boundary to extract; React alone will not solve it.

2. **The two clients do not actually use one application protocol.** Desktop receives snapshots and request/response messages through WS (`panel-ws.ts:730-757,1143-1393`); mobile receives snapshots plus notices over one untyped SSE data channel and posts a restricted subset to HTTP (`mobile-http.ts:476-524,624-657`). Session-picker data is also assembled differently: multiple WS requests on desktop versus `/picker` on mobile. `MOBILE_ACTION_TYPES` in `panel-ws.ts:1030-1043` silently creates a second capability model. This makes feature parity depend on coordinated edits across transport handlers instead of one command service and typed adapters.

3. **Both UI implementations are mutation-heavy monoliths where unrelated state invalidates large DOM regions.** `panel/src/main.ts` (2,868 lines) mixes protocol state, Tauri window management, lip-sync/blink animation, rendering, settings, picker, and event binding; its repeated `app.innerHTML` replacement (`:1138-1288,1765-1850`) forces rebinding and manual preservation of timers/local state. `tts-server/mobile.html` (4,567 lines) combines markup, 1,500+ lines of CSS, audio ownership/arbitration, chat, picker, renderer, and event wiring; `render()` at `:3772-3778` fans out broadly for each SSE frame. The explicit focus-capture workaround at `mobile.html:3325-3490` is evidence of the rendering model fighting a basic text-entry requirement. Small changes can regress audio, focus, timers, or double-fire guards far away.

### High

4. **`panel-ws.ts` is a transport, controller, domain service, settings repository, process launcher, and HID/settings API in one file.** Its 1,415 lines cover token/origin security, message validation, config writes, script execution, tmux probes, spawn/resume reservation, reply dispatch, replay control, and broadcasting. Mobile imports its domain operations directly (`mobile-http.ts` imports action/reply/picker/notice helpers), cementing HTTP behind a WS-named module. Split by responsibility, but preserve command validation and billing/playback guards exactly.

5. **Snapshot construction performs repeated synchronous filesystem scans on the event loop and once per subscriber.** `state-watch.ts:104-227` scans queue and played directories per agent and resolves several files; WS calls `buildPanelSnapshot()` once for a broadcast, but mobile creates one `writeSnap` subscription per SSE client (`mobile-http.ts:509-523`), so the same filesystem event rebuilds the full snapshot independently for every phone connection. Transcript and replay endpoints also synchronously read and split/scan whole files/directories (`mobile-http.ts:182-274`). This is acceptable at today's scale until replay/played history grows, then it can delay audio/control handling. Cache one immutable snapshot per debounced state event and broadcast it to all transports; index or bound historical scans without changing the files themselves.

6. **The desktop wrapper is built around a constraint the owner no longer wants.** `panel/src-tauri/src/lib.rs:25-53` always converts the only window to a non-activating `NSPanel`, forces floating level, and joins all Spaces/full-screen; `tauri.conf.json:19-32` also sets `alwaysOnTop`, removes decorations, enables transparency, and disables shadow. A normal floating room cannot behave like a normal Mac window or accept text-centric interaction comfortably. Make full/floating mode a normal decorated (or tastefully custom-chrome) Tauri window; reserve NSPanel/all-Spaces/always-on-top behavior for dock mode only. If runtime conversion between `NSWindow` and `NSPanel` is brittle, use two windows backed by the same React app and state client.

7. **Deployment can produce mixed or stale installations.** `scripts/tts-server.sh:22-47` copies only `src/*.ts`, `src/*.json`, one raw HTML file, and conditionally `package.json`; it does not sync the lockfile, delete removed source files, or fail when copies fail (`|| true`). `setup.sh:82-90` instead deletes and recopies the whole server, then installs dependencies. Thus restart and setup have materially different deploy semantics, removed modules can survive restart, and dependency resolution can drift. A mobile build introduces more artifacts, making explicit atomic artifact sync essential.

8. **`setup.sh` mixes installation with optional billable/external work.** After destructive server replacement and app/script install, `setup.sh:325-350` sources credentials, refreshes ElevenLabs voices, and may generate sound effects. A UI refactor should not require or accidentally trigger API work. Separate local build/install from an explicitly named asset/voice refresh command; installation should be deterministic and offline-capable once dependencies are present.

9. **Security boundaries exist but are scattered and hard to audit.** Mobile token extraction/cookie auth, static-path containment, range/live audio, and actions all live in `mobile-http.ts`; WS token/origin checks and action validation live in `panel-ws.ts`. Tauri disables CSP entirely (`tauri.conf.json:34-36`), while both old UIs depend heavily on HTML insertion. There are escape helpers and markdown sanitization efforts, but the breadth of `innerHTML` makes omissions costly. React text escaping reduces the default risk; keep markdown behind one reviewed renderer, retain token/origin/path checks, and add a practical CSP after inventorying local image/audio/WS needs.

### Medium

10. **Visual and behavioral primitives are copied, not tokenized.** Panel tokens start in `panel/src/style.css:1-19`; mobile defines a different palette at `mobile.html:10-26`, then both files contain many literal colors. More seriously, the semantic mapping differs: panel maps `working` to amber and `hand_raised` to blue (`style.css:533-545`), while mobile maps `working` to blue and `hand_raised` to amber (`mobile.html:18-21,227-230`). Shared tokens must be semantic (`state-working`, `state-hand-raised`) rather than merely a common color palette.

11. **Server hotspots have weak boundaries beyond the UI work.** `audio.ts` (1,085 lines) combines lock/marker lifecycle, process supervision, now-playing persistence, playback, replay storage, phone grants, and replay queries. `hid.ts` (1,063 lines) combines device I/O, mapping, rendering/state derivation, scheduler behavior, and CLI learn mode. Splitting these is worthwhile after the contract/UI extraction, but doing it concurrently with UI migration would multiply regression risk around the expensive synthesis path. Favor facade-preserving extractions: `playback-locks`, `now-playing-store`, `replay-store`, `phone-grant`; and `hid-device`, `button-mapping`, `hid-controller`.

12. **Legacy surfaces obscure ownership and deployment.** `setup.sh:304-312` still installs `plugins/cursor-read-aloud.5s.sh`; its controls overlap Room.app, and setup copy lists still include `ingest_claude_code.sh`, `clean_text.py`, `build_read_aloud_notifier_app.sh`, and Raycast-era affordances. References must be audited before deletion because hooks and installed scripts are an IPC surface. Establish a small manifest documenting each script's caller and installation status, then remove only unreferenced items in a separate change.

## 2. Cross-platform inconsistencies

1. **State color meaning is reversed.** Desktop: `panel/src/style.css:533-545` (`working` amber, `hand_raised` blue). Mobile: `tts-server/mobile.html:18-21,227-230` (`working` blue, `hand_raised` amber). There is no platform reason for the same room state to change color meaning.

2. **The shared room card is independently specified.** Desktop `renderCard` and `actionButtonsHtml` (`panel/src/main.ts:746-920`) include triage focus, stale/disconnected state, voice swapping, summary/live action clusters, terminal focus/kill, and desktop hover behavior. Mobile `renderMembers` (`mobile.html:3325-3455`) defines different badges, waiting text, hide-by-name, reply/chat, output destination copy, and replay behavior. Platform-exclusive controls are legitimate, but name/avatar/state/queue/muted/now-playing/primary action should share one component and one view-model.

3. **Grant pending has duplicated client-side race logic.** Desktop maintains `pendingGrantSessionId` with `PENDING_GRANT_MS = 25000` (`main.ts:129,506-533`) and mobile independently maintains `grantPending` and another 25-second timeout (`mobile.html:3368-3381,3933-3957`). The same optimistic state and expiry rule should live in the shared command store.

4. **Playback controls have different state machines and naming.** Desktop derives pause from snapshot and maintains wall-clock/lip-sync anchors (`main.ts:147-184,2687-2700`), while mobile has a much larger `computePlayerState` arbitration among `mac-live`, `mac-paused`, phone replay, pending tap, and local `<audio>` (`mobile.html:1840-2039`). Phone-specific audio ownership must stay mobile, but the common Mac now-playing/pause/replay semantics and labels should be a shared selector/component contract.

5. **Session discovery is transported and normalized differently.** Desktop requests `list_resumable` and `known_dirs` separately over WS and owns a hard-coded `PERSONAS` list (`main.ts:95-103,1340-1463,1951-1963`). Mobile requests aggregated `/picker`, receives server personas/projects directories, and normalizes loose alternate field names (`mobile-http.ts:489-493`; `mobile.html:3822-3927`). Both should consume a typed `SessionPickerData` query from one server service.

6. **Action results are asymmetric.** Desktop commands are mostly fire-and-forget WS messages with later typed error frames (`main.ts:249-253,2655-2834`); mobile `postAction` interprets HTTP status/body immediately (`mobile.html:1772-1789`) and special-cases reply status. Shared commands should return a uniform `CommandResult { ok, code?, message?, data? }`, even though WS correlates via IDs and HTTP returns directly.

7. **Live mode exposes different concepts.** Desktop compresses live behavior into `ActionClusterMode` and summary/status buttons (`main.ts:136,498-540,839-923`); mobile provides chat/call view, thread, timers, reply composer, and phone playback (`mobile.html:2280-2635`). The deeper mobile view is platform-specific, but the `LiveToggle`, live badge/activity, elapsed time, and status request should use shared selectors and components.

8. **Avatar behavior and asset ownership diverge.** Desktop contains expression classification, mouth frames, blink scheduling, preload logic, and public asset URLs (`main.ts:269-740`); mobile has its own avatar URL/fallback and speaking-frame decisions (`mobile.html:1670-1730,3325-3455`) while deployment copies avatars out of `panel/public` (`tts-server.sh:32-37`). Move assets to a neutral shared package and share URL/frame helpers; retain richer animation adapters where capabilities intentionally differ.

9. **Markdown rendering is separate.** Desktop uses `panel/src/markdown.ts`; mobile has `mdToHtml` in `mobile.html:2075-2138`. This creates different output and two security review surfaces. Use one shared renderer/component and an explicit allowed subset.

10. **User preferences have different scopes without a documented model.** Desktop persists dock captions/summary pane and spawn flags in local storage (`main.ts:127-128,2066-2093`); mobile persists hidden developer names, output/device choice, playback/listened data, drafts, and call state in page-local storage/state. Platform-local preferences are appropriate, but they should be typed under `desktopPrefs` and `mobilePrefs`, while daemon settings remain clearly separate and shared.

## 3. Refactor spec

### Target structure

Use one root pnpm workspace. The repository already has two separate lockfiles; sharing source through ad-hoc relative imports would make Vite resolution and installed-copy behavior fragile. Converge to one root `pnpm-lock.yaml` and workspace packages:

```text
pnpm-workspace.yaml
package.json                       # build/typecheck orchestration only
apps/
  desktop/                         # current panel Vite React app
    src/app/ DesktopApp.tsx
    src/platform/tauri.ts
    src/features/dock/
    src/features/settings/
    src-tauri/                     # moved last, or keep panel/src-tauri initially
  mobile/                          # Vite React app, produces static dist
    src/app/MobileApp.tsx
    src/platform/phone-audio.ts
    src/features/call/
    src/features/thread/
packages/
  protocol/                        # dependency-free TS types, schemas/guards, command results
    src/snapshot.ts
    src/commands.ts
    src/events.ts
    src/queries.ts
  room-client/                     # transport-neutral store, selectors, optimistic command state
    src/core.ts
    src/ws-transport.ts
    src/http-sse-transport.ts
  ui/                              # shared React components; no Tauri/phone globals
    src/components/
    src/tokens.css
    src/markdown/
  assets/                          # avatars/expression manifest, shared public-copy source
tts-server/
  src/services/room-command-service.ts
  src/services/session-picker-service.ts
  src/transports/panel-ws.ts
  src/transports/mobile-http.ts
  public/mobile/                   # generated/copied artifact only; preferably gitignored
scripts/
```

Start with React 19 (or the current stable React selected at implementation time), Vite, and plain CSS/CSS Modules. Do not add a component framework or a global state library initially. `useSyncExternalStore` around a small external `RoomClient` is enough for two clients and keeps transport logic independently usable. Use pnpm workspace dependencies (`workspace:*`).

### Component inventory

Shared presentation and behavior:

- `RoomHeader`, `ConnectionIndicator`, `HeldBadge`
- `RoomGrid`, `AgentCard`, `AgentIdentity`, `AgentAvatar`, `AgentStateBadge`, `QueueBadge`, `MutedBadge`, `QueuedPreview`
- `AgentPrimaryAction` (grant/replay/status selector), `GrantButton`, `ReplayButton`, `LiveToggle`
- `NowPlayingCard`, `PlaybackButton`, `PlaybackProgress`, `KaraokeText`, `DeviceBadge`
- `SessionPicker`, `PersonaPicker`, `ProjectRow`, `ResumableSessionRow`
- `ReplyComposer` as a controlled primitive (used mainly by mobile, available to desktop later)
- `LiveActivity`, `ElapsedTime`, `ToastRegion`, `EmptyState`, `IconButton`, `SegmentedControl`, `Modal/Sheet` primitives
- `Markdown` with one sanitizer/allowlist
- selectors/view-models: `selectVisibleAgents`, `selectAgentAction`, `selectNowPlaying`, `selectLiveState`, `selectGrantPending`

Desktop-specific:

- `DesktopShell`, native window chrome/drag regions, floating/docked layout switch
- dock pill/spotlight/captions and window sizing/snapping
- terminal focus, kill confirmation, persona/voice swap
- settings, HID button mapper/learn capture, shortcut help
- richer blink/expression renderer if sharing it would burden mobile

Mobile-specific:

- `MobileShell`, safe-area/header/menu and install-friendly responsive layout
- `CallView`, chat/thread timeline, push-to-talk/reply routing, ack playback
- phone audio engine, autoplay priming, Mac↔phone handoff, local replay history/listened state
- output-device selector and hidden-developer preference

Components should accept domain values and callbacks, never call `fetch`, `WebSocket`, Tauri APIs, or global audio directly. Platform containers own those adapters.

### State and protocol layer

1. Move `PanelSnapshot`, `AgentView`, `NowPlaying`, live/ack types, queries, commands, event envelopes, and `CommandResult` into `packages/protocol`. The daemon and both apps import the exact types. Add runtime guards for network input because TypeScript does not validate JSON. Keep the current filesystem JSON formats private to server repositories; do not expose them as UI models.

2. Introduce an envelope now, before component migration:

```ts
type ServerEvent =
  | { type: "snapshot"; revision: number; data: PanelSnapshot }
  | { type: "notice"; data: Notice }
  | { type: "command_result"; requestId: string; result: CommandResult };
```

The revision is daemon-local and monotonic; it prevents older bootstrap HTTP data from overwriting a newer stream frame. It does not replace filesystem state.

3. `RoomClient` owns `{snapshot, connection, notices, pendingCommands}` and exposes `subscribe/getSnapshot`, typed selectors, `queryPicker()`, `queryThread()`, and `dispatch(command)`. It owns the 25-second grant optimism once. Reconnect policy is in transports, not components.

4. `WsTransport` obtains `{token, port}` from the Tauri adapter, connects locally, receives envelopes, and correlates commands by `requestId`. `HttpSseTransport` bootstraps from `/snapshot`, listens to named/enveloped SSE events, POSTs commands, and calls mobile-only queries/audio URLs. Both feed the same core.

5. On the server, `room-command-service` performs validation/authorization and invokes existing scripts/domain functions. WS and HTTP become thin adapters. Preserve the mobile capability whitelist as an explicit policy next to the service, not an incidental `Set` inside the WS module. Preserve all existing checks for stale sessions, team membership, phone-grant supersession, replay locks, live-mode eligibility, and reply exit status.

### Build and deploy

- Root scripts should use pnpm filters, e.g. `pnpm --filter @room/mobile build`, `pnpm --filter @room/desktop build`, and a root `pnpm typecheck`. The server may continue running through `tsx`; no daemon compile step is required for this UI refactor.
- Mobile Vite output should be a self-contained static directory with relative or root-stable hashed assets. `mobile-http.ts` should serve `index.html` with no-cache and hashed JS/CSS/assets with long immutable caching. Avatars can either be hashed build assets or remain authenticated `/avatars/*`; choose one owner, not `panel/public` as mobile's source.
- `tts-server.sh start/restart` should build mobile from the repo (or consume a prebuilt artifact), stage server source plus `apps/mobile/dist` in a temporary directory under the install parent, then atomically replace the installed code/artifact while the daemon is stopped. Sync the root lockfile/workspace manifests required for installed server dependencies. Do not swallow copy/build failure; abort and leave the last installation runnable.
- Prefer `scripts/build-ui.sh` and `scripts/install.sh` as explicit local operations. `setup.sh` can orchestrate them, but should not make live ElevenLabs calls. Voice/SFX refresh becomes a separate opt-in command.
- Panel build remains `pnpm --filter @room/desktop tauri build --debug`; installation copies the produced app bundle. `setup.sh` should report when the installed app differs and that a running app must relaunch. Do not silently install an old bundle merely because it exists.
- Keep a single source-of-truth install manifest for scripts. After reference audit, stop installing SwiftBar and legacy utilities by default; optionally retain a `--legacy-swiftbar` switch for one transition release.
- Update `CLAUDE.md` in the same phase that deployment changes land, especially the two-location instructions and verification commands.

### Migration plan

**Phase 0 — Baseline and contract capture (no visual change).** Record screenshots/manual behavior for room, dock, picker, mobile card, call/thread, grant-to-Mac/phone, pause/resume, and replay. Extract protocol types/guards and fixture JSON from representative saved snapshots (sanitized, repository-local). Verify both existing typechecks and parse the mobile inline script. No live synthesis.

**Phase 1 — Unify server application services behind existing endpoints.** Extract command and picker services from `panel-ws.ts`; make current WS and HTTP handlers delegate to them. Add request IDs/results to WS while accepting old messages during migration. Build each existing client unchanged. Manually exercise `/snapshot`, `/picker`, `/thread`, rejected commands, and free saved-audio replay paths.

**Phase 2 — Shared client core under the old UIs.** Introduce `packages/protocol` and `room-client`; adapt desktop WS first, then mobile SSE/HTTP, while existing template renderers read the client's state. This isolates transport differences before React. Verify reconnection, notice handling, grant timeout, stale-session errors, and out-of-order bootstrap/SSE behavior.

**Phase 3 — Tokens and leaf components.** Create shared tokens and React primitives, then mount islands for badges, avatar, queued preview, buttons, markdown, and now-playing. Keep current page shells and audio/window controllers. Use side-by-side screenshots at desktop widths and real phone widths. Semantic state colors must now match.

**Phase 4 — Desktop React shell.** Replace full-room/picker/settings renderers, then migrate dock separately. Wrap Tauri operations behind `DesktopPlatform`. First ship the normal floating window behavior; then implement dock-only NSPanel/always-on-top, preferably as a second Tauri window if runtime class changes are unreliable. Verify resizing, focus/text controls, Spaces behavior, dock hover/snap, HID settings, and relaunch/install flow.

**Phase 5 — Mobile React shell and build artifact.** Migrate room grid/picker first, leaving the existing phone audio controller behind an adapter; then migrate replay player; migrate call/thread/composer last because autoplay, stream handoff, and draft focus are the highest-risk interactions. Introduce Vite output and static serving only after functional parity locally, then switch deployment from `mobile.html` to `dist` atomically.

**Phase 6 — Delete compatibility code and audit legacy surfaces.** Remove template renderers, old message acceptance, `mobile.html`, duplicate type/markdown/avatar helpers, and obsolete CSS. Audit every script/plugin reference from hooks, SwiftBar, Raycast, setup, and server spawn calls; remove only proven dead files. Update documentation and install manifest.

**Phase 7 — Optional server hotspot splits.** With UIs stable, split `audio.ts`, `hid.ts`, and snapshot repositories behind their existing public facades. This is deliberately not on the critical path to React.

Every phase is shippable and uses manual/scripted verification only: `pnpm exec tsc --noEmit` in affected packages, build both UIs, `bash -n` for changed scripts, parse/build checks, saved replay audio, HTTP/WS smoke requests with synthetic fixture state where possible, and visual interaction checks. No new CI or test-suite apparatus is proposed.

### Risks and mitigations

- **Double synthesis or duplicate commands during coexistence:** one shared pending-command store, stable request IDs, disable controls immediately, and retain server locks/dedup as final authority. Never dual-dispatch from React islands and legacy handlers.
- **Phone autoplay/stream handoff regression:** keep the current audio controller intact behind an adapter until the mobile shell is stable; migrate its state machine last and verify with cached/saved audio.
- **SSE/HTTP and WS drift during transition:** shared protocol package and command service; compatibility window is additive and time-bounded.
- **React render cadence harms lip-sync/karaoke:** keep high-frequency animation time in refs and `requestAnimationFrame`; update targeted DOM/canvas state rather than committing the whole snapshot tree at 70–80 ms intervals.
- **Workspace/deployment resolution breaks installed daemon:** server runtime must not import TS by traversing back into repo packages. Install the required workspace package source/build output with the daemon, and smoke-start without credentials before switching artifacts.
- **Hashed mobile assets cache incorrectly:** no-cache `index.html`, immutable hashed assets, atomic directory swaps, and a visible build/version string in diagnostics.
- **Tauri window-mode changes break dock behavior:** separate normal and dock windows if necessary; share the same store and UI components; verify activation, text input, Spaces, full-screen, snapping, and restoration independently.
- **Design unification erases useful platform differences:** share semantic tokens, components, and view-models; keep layout, density, input modality, phone audio, and native window behavior in platform shells.
- **Server cleanup disturbs billing safeguards:** do not refactor synthesis flow with UI phases; preserve mute-before-API, ingest dedup, live hold-one buffer, processing markers/locks, and cached-only acknowledgements verbatim behind facades.
- **Legacy deletion breaks hooks:** build the caller/install manifest first and provide one transition install option for SwiftBar; deletion is its own reversible phase.

## 4. Open questions

1. Should floating and docked desktop modes be two Tauri windows (simpler, safer native behavior) or one window whose native class/flags change at runtime? I recommend two windows if the dock must remain a non-activating all-Spaces panel.
2. Should the normal floating window use standard macOS titlebar/decorations, or custom web chrome with normal activation/shadow? The former is more native and maintainable; the latter preserves the current visual identity.
3. Is SwiftBar still a supported fallback, or can setup stop installing it once the React desktop reaches parity? If retained, which controls are authoritative there?
4. Is mobile intended only for one trusted LAN and one phone, or should multiple simultaneous phones be supported? The answer affects audio ownership, SSE fan-out expectations, and device handoff UX.
5. Should desktop gain the mobile chat/thread/reply experience, or are only the room card, now-playing, replay, and live toggle shared? This determines whether `ReplyComposer`/thread components are truly shared now or merely reusable.
6. Which mobile preferences should survive browser data clearing or follow the daemon—hidden developers, listened history, output target, drafts? Keeping them local is simplest, but it should be an explicit product decision.
7. Should avatar expression/blink/lip-sync behavior be identical across platforms, or is mobile intentionally lighter for battery/performance? Shared frame semantics are recommended even if render cadence differs.
8. Is a root pnpm workspace/lockfile acceptable, including moving `panel/` to `apps/desktop`, or should paths remain stable for now? I recommend workspace adoption immediately but defer physical directory moves until after the protocol/client extraction.
9. Should install always build UI artifacts from source, or should it require already-built artifacts and fail with a clear command? For a personal repo, build-on-install is convenient; either is sound if stale artifacts cannot be silently installed.
10. May setup be changed so all ElevenLabs voice/SFX refreshes are explicitly opt-in? This review strongly recommends yes because ordinary UI installation should never incur external API use.
