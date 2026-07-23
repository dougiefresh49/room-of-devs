# Cross-review: gpt-5.6 on grok-4.5

Scope: comparison of the two round-1 reviews against the repository as it exists on 2026-07-21. Where the reports differed on facts or sequencing, I re-read the relevant source. The filesystem IPC under `~/.cursor/tts/` remains out of scope for redesign.

## 1. Points of agreement — the shared backbone of a consensus refactor path

The reviews agree on nearly all of the architectural backbone:

1. **The first durable boundary is a shared UI/application contract, not React by itself.** Both reports identify the server-owned `PanelSnapshot` in `tts-server/src/state-watch.ts`, the reduced copy in `panel/src/main.ts`, and mobile's untyped consumption as a source of drift. The shared package must cover snapshots, commands, query/result shapes, notices, and runtime validation of network JSON.

2. **Both UIs should become Vite/React applications in one pnpm workspace, with genuinely shared code.** Shared semantic tokens, room-card primitives, playback presentation, markdown, selectors/view-models, and a transport-neutral client are the correct center. Tauri/window operations and phone audio/call behavior remain in platform shells.

3. **WS and SSE+HTTP should remain transport adapters rather than be artificially merged.** Localhost desktop and authenticated LAN mobile have different exposure and capability needs. They should feed one store and delegate commands to one server application service, while the server retains an authoritative mobile allowlist.

4. **The daemon boundary needs untangling, especially `panel-ws.ts`.** It currently combines transport, validation, command execution, spawn/resume, settings/HID APIs, reply injection, and mobile dispatch. Both reviews support facade-preserving extraction without changing synthesis, filesystem IPC, or safety guards.

5. **The mobile page needs a real build artifact and deployment must fail loudly.** Both reports correctly reject continuing to copy raw `mobile.html`. The installed daemon must receive an internally consistent static build, server source, and dependency manifests; stale/removed files and swallowed copy/install failures must stop surviving deploys.

6. **Window policy should follow the owner's updated requirement.** `panel/src-tauri/src/lib.rs` unconditionally converts the sole window to an `NSPanel`, makes it non-activating/floating, and joins all Spaces; `tauri.conf.json` also unconditionally sets `alwaysOnTop`. Floating mode should be a normal activating window. Dock mode may retain special panel behavior, with two windows favored if changing native class/flags at runtime is unreliable.

7. **Migration must be incremental and preserve the risky controllers.** In particular, phone autoplay/audio handoff, lip-sync timing, grant optimism, drafts/focus, and the server's mute/lock/processing safeguards should be adapted behind stable interfaces before being rewritten. No phase should dual-bind an old and React handler to the same command.

8. **Legacy surfaces need an audit, not casual deletion.** SwiftBar, Raycast scripts, the bash ingest fallback, and `clean_text.py` are not all dead. `hook_stop.sh` still executes `ingest_claude_code.sh` when the Node path is unavailable, and `notify_queued.sh` still imports `clean_text`. Establish callers and ownership first; demote or remove only afterward.

## 2. Disagreements — where grok's review conflicts with mine

### A. Whether `audio.ts` is critical-path refactor work

Grok ranks `audio.ts` as Critical and its plan says not to split it unless a concrete need arises; my review ranks it Medium and explicitly moves any split after UI stabilization. The descriptions are compatible, but the severity label is not.

**Holding my position.** `audio.ts` is a real hotspot, but the mandate is UI componentization and a shared client boundary. It contains the credit-sensitive playback locks, processing markers, replay handling, phone grants, and now-playing persistence that both reviews say must remain stable. Splitting it concurrently creates risk without unblocking React. Extract `panel-ws.ts` application services first; leave `audio.ts` behind its existing exports until the new clients are stable, then split it only as a separate phase.

### B. Server extraction before or after workspace/contract work

Grok proposes workspace/types/tokens in phase 0, then a broad `panel-ws.ts` split in phase 1. My report starts with contract capture, then extracts command and picker services behind existing endpoints.

**Mostly holding, with a sequencing refinement.** A minimal dependency-free protocol package and captured fixtures should land first because the extracted service needs a canonical vocabulary. Immediately after that, extract only the command and picker application services required to stop WS/HTTP drift. Do not extract `settings-buttons.ts`, spawn internals, HID, and other unrelated pieces merely to make files smaller. This keeps the service step behavior-preserving and narrow.

### C. Sharing tokens before mobile has a build pipeline

Grok's phase 0 says the still-monolithic mobile page imports shared `tokens.css`, while its mobile Vite build arrives in phase 5.

**Holding my objection.** The current `mobile.html` is a single served file with inline CSS and no module/CSS build path. It cannot simply import a workspace CSS package in the same sense as the Vite panel. A temporary extra static stylesheet and server route would add deployment plumbing that is immediately discarded. Define the semantic token contract early, and let desktop or React islands consume it, but migrate mobile to it when the Vite shell exists.

### D. One `@room/shared` package versus separate protocol/client/UI packages

Grok prefers one `@room/shared`; I proposed separate `protocol`, `room-client`, and `ui` packages.

**Holding the separation, mildly.** The server must be able to import protocol types/guards without pulling React or browser code into the installed daemon dependency graph. Separate packages make that invariant structural and clarify deployment. One package can work with disciplined exports and dependency boundaries, but it is easier to accidentally make server runtime resolution traverse UI/workspace code. This is not a reason to move existing directories immediately; package boundaries and physical relocation are separate decisions.

### E. Where mobile capability metadata belongs

Grok suggests encoding `desktopOnly`/`mobileAllowed` metadata in the shared client so components disable unsupported actions. My report places the capability policy next to the server command service.

**Holding the server-authoritative position.** Client metadata is useful for presentation, but it is not authorization and cannot be the single encoding of the matrix. `dispatchPanelAction()` currently validates and enforces `MOBILE_ACTION_TYPES`; the extracted server policy must remain authoritative. The server may expose capabilities that the client renders, avoiding two manually synchronized lists.

### F. How much “live” UI is inherently shared

My round-1 component inventory included a shared `LiveToggle`; Grok correctly emphasizes that desktop's current “live” action cluster is not daemon live narration.

**Conceding and narrowing my position.** In `panel/src/main.ts:502-538`, `isSessionLive()` is only an alias for stage-worthy active Mac playback; the panel neither reads `agent.live` nor sends `set_live`. Mobile uses `agent.live` and `set_live` for an ongoing narration/conversation mode. Shared protocol types and perhaps a neutral live-status badge are warranted, but a shared toggle is owner-gated until desktop is intentionally given that product feature. The current desktop mode should be renamed during migration so it cannot be confused with daemon live mode.

## 3. What grok found that I missed

1. **The panel's local `AgentView` omissions are more consequential than generic type drift.** Grok specifically called out `queuedPreview`, `injectable`, and the entire `live` object. The code confirms all are in `state-watch.ts` and absent from `panel/src/main.ts`. This precisely explains why desktop cannot display waiting text or mobile-style live activity without contract work.

2. **Desktop “live” is a naming collision, not merely a shallower version of mobile live mode.** This is Grok's strongest catch. `isSessionLive()` checks current non-ack Mac playback, whereas mobile live mode persists via `set_live` and `agent.live`. My round-1 inconsistency item blurred these concepts.

3. **The room-card summary branch is dead in the main grid.** `actionClusterMode()` returns only `"live"` or `"idle"`; the `"summary"` mode is used elsewhere for dock spotlight behavior, not selected for room cards. This should be explicitly deleted or restored based on owner intent rather than mechanically ported.

4. **Markdown link behavior differs in a concrete product-relevant way.** The panel converts markdown links into inert `.md-link` spans (`panel/src/markdown.ts:16`), while mobile emits `target="_blank"` anchors (`mobile.html:2086`). A shared renderer needs an explicit platform link policy, not merely common parsing and sanitization.

5. **The legacy fallback path is demonstrably live.** Grok traced `hook_stop.sh` to the bash ingest fallback and `notify_queued.sh` to `clean_text.py`. My report asked for an audit but did not identify those concrete surviving callers.

6. **The source-of-truth control-surface decision deserves more prominence.** SwiftBar is still installed by `setup.sh`, not just present in the repository. Deciding whether it becomes launcher/status-only is necessary to prevent settings and controls from diverging again.

## 4. What grok missed or got wrong

1. **Its proposed type ownership can recreate the exact drift it diagnoses.** “Hand-copy once into `@room/shared`, server remains source of truth,” followed by a mitigation comment saying “mirror state-watch,” still leaves two definitions. The daemon and both clients must import the same protocol package. Runtime guards should live there too; TypeScript alone does not validate WS/SSE/HTTP input.

2. **“Dual HTTP surfaces” is inaccurate terminology.** The desktop endpoint in `panel-ws.ts` is a WebSocket surface, while `mobile-http.ts` is HTTP/SSE. The architectural conclusion—two transport adapters and security contexts—is correct, but they are not two HTTP servers implementing the same protocol.

3. **The migration omits message envelopes, request correlation, and ordering.** Desktop commands are largely fire-and-forget and errors are uncorrelated; mobile receives immediate HTTP results. A shared `send(action)` abstraction is underspecified without `requestId`/`CommandResult`. Likewise, `/snapshot` bootstrap can race an SSE frame. Use typed event envelopes and a daemon-local monotonic revision so older bootstrap data cannot overwrite newer stream state.

4. **It missed the repeated snapshot-build fan-out.** `mobile-http.ts:509-523` creates a separate `subscribe(() => buildPanelSnapshot())` callback per SSE connection. Each state event therefore repeats synchronous state/queue/played filesystem scans for every phone, while WS builds once and broadcasts. Cache one immutable snapshot per debounced state revision and fan it out to both transports.

5. **Its phase ordering delays the mobile artifact path too long.** Building an entire mobile parity clone in phase 5 and only then sharing components in phase 6 risks a second implementation of the UI mandate. Establish the mobile Vite shell and static-serving/deploy path, then migrate bounded slices directly onto shared primitives while retaining the current phone-audio controller behind an adapter. Do not clone all 4,567 lines and refactor them again.

6. **The deploy proposal is not atomic enough.** “Copy or rsync `mobile-dist`” improves on raw HTML but still permits mixed hashes if a process observes the directory mid-copy. Current `tts-server.sh` also swallows source/avatar failures and can leave removed modules installed. Stage a complete artifact/source set, validate `index.html` and manifests, stop the daemon, then rename/swap. Serve `index.html` as no-cache and hashed assets as immutable.

7. **The window recommendation assumes mode-gating an already-converted panel is straightforward.** `lib.rs` converts the only window to `NSPanel` once during setup and applies its class/style/collection behavior globally. A web `dockMode` conditional cannot by itself undo that native class. Two windows—or a deliberate native recreation strategy—should be the default recommendation if dock must stay an NSPanel.

8. **CSP is understated.** Calling null CSP acceptable because this is personal/local overlooks that mobile is LAN-exposed and both current UIs use broad HTML insertion. React improves default escaping but does not secure rendered markdown or URLs. CSP is not phase-zero work, yet a practical policy belongs after static asset origins, WS, images, and audio are inventoried.

9. **Its phase-0 visual promise is not internally achievable as written.** Beyond the token-import issue, “colors align; mobile still old renderer” requires editing the mobile monolith or new static routing. Token semantics can be agreed early, but visual alignment should be verified when each migrated surface actually consumes them.

10. **Its verification language around types is weaker than the installed-workspace risk.** There are currently two lockfiles (`panel/pnpm-lock.yaml`, `tts-server/pnpm-lock.yaml`) and no root workspace. Once the daemon imports shared protocol code, setup and restart must install/copy the exact package output and root lock/workspace manifests; a repo-only workspace link must not become a hidden runtime dependency under `~/.cursor/tts/`.

## 5. Consensus recommendation

I would endorse the following merged path.

### Phase 0 — Capture behavior and establish the protocol

- Record manual baselines for room, dock, picker, call/thread, Mac/phone grant, pause/resume, and saved replay; capture sanitized representative snapshots.
- Add a root pnpm workspace without physically moving `panel/` or `tts-server/` yet.
- Create a dependency-free protocol package containing the one canonical snapshot, command, query, notice, result, and event-envelope definitions plus runtime guards.
- Add request IDs and daemon-local snapshot revisions additively; keep old desktop messages accepted during a short compatibility window.

### Phase 1 — Unify server application services and snapshot publication

- Extract narrowly scoped command and session-picker services from `panel-ws.ts`; retain mobile capability enforcement on the server.
- Make WS and HTTP handlers thin adapters with consistent `CommandResult` semantics.
- Build one cached snapshot per debounced state revision and broadcast it to all WS/SSE subscribers.
- Do not split synthesis/audio or HID internals in this phase.

### Phase 2 — Introduce the shared client beneath existing renderers

- Add separate transport-neutral `room-client`, WS transport, and SSE+HTTP transport packages/modules.
- Own connection state, notices, revisions, command correlation, and the 25-second grant optimism once.
- Adapt the legacy panel first and mobile second without changing their visible shells; verify reconnects, stale errors, notices, and bootstrap/stream ordering.

### Phase 3 — Shared tokens and React leaf components

- Define semantic state/design tokens and shared markdown parsing with an explicit link policy.
- Build shared identity, avatar/frame helpers, badges, queue preview, grant/replay controls, now-playing presentation, toasts, and picker primitives.
- Mount React islands where safe, ensuring old and new handlers never coexist on the same action.
- Keep high-frequency lip-sync/karaoke time in refs/animation loops rather than rerendering the room tree.

### Phase 4 — Desktop React shell and native window correction

- Migrate room grid/picker/settings, then dock as its own bounded step.
- Put all Tauri calls behind a desktop platform adapter.
- Ship floating mode as a normal activating Mac window with shadow/decorations policy chosen by the owner.
- Implement dock behavior using a separate NSPanel window unless a tested native recreation approach proves simpler.
- Rename the current playback-stage “live” mode to avoid collision with daemon live narration.

### Phase 5 — Mobile Vite shell, shared components, and artifact cutover

- Establish the Vite entry and authenticated static serving first.
- Migrate room/picker directly to shared components; then player/replay; migrate call/thread/composer last.
- Preserve the current phone-audio/autoplay/handoff controller behind an adapter until parity is demonstrated.
- Stage and atomically install the built static directory with no-cache HTML and immutable hashed assets; remove raw `mobile.html` only after rollback confidence.

### Phase 6 — Remove compatibility code and settle legacy ownership

- Delete old renderers, duplicate types/tokens/markdown/avatar helpers, old envelopes, and raw mobile assets after both apps are stable.
- Produce a caller/install manifest for every script and control surface.
- Demote SwiftBar to launcher/status-only or stop installing it, according to the owner's decision; retain the ingest and cleaning fallbacks while they still have verified callers.
- Separate ordinary setup/install from opt-in ElevenLabs voice/SFX refreshes.

### Phase 7 — Optional server hotspot work

- Only after UI stability, split `audio.ts` and `hid.ts` behind their existing facades when there is a concrete maintenance benefit.
- Preserve filesystem IPC, mute-before-API behavior, deduplication, hold-one live buffering, locks/markers, phone-grant arbitration, and cached replay behavior unchanged.

### Remaining owner decisions

1. Dock native behavior: always-on-top only, or also non-activating and all-Spaces? This determines whether two Tauri windows are necessary.
2. Floating chrome: standard macOS titlebar/shadow or custom web chrome on a normal activating window.
3. Desktop live narration: no feature, indicator-only, or full toggle/chat. Do not equate it with the current playback stage.
4. SwiftBar/Raycast ownership: supported controls, launcher/status-only, or removal after parity.
5. Mobile artifact policy: committed build output versus mandatory build-on-install. Either is acceptable if stale artifacts fail loudly and installation is atomic.
6. Mobile multi-device support: one trusted phone or multiple simultaneous clients; this affects audio ownership and SSE fan-out behavior.
7. Canonical visual direction and mobile-vs-desktop density; semantic state colors should be shared regardless.
8. Which preferences remain browser/window-local versus daemon-owned.
9. Whether ordinary setup may be made fully free of opt-out live voice/SFX calls. Both reviews recommend that it should.

This merged plan keeps Grok's strongest concrete catches—the live-mode naming collision, dead summary branch, and surviving legacy callers—while retaining the stricter protocol, ordering, deployment, and risk boundaries from my first review.
