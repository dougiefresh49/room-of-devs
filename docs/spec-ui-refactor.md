# UI Refactor Spec — Shared React Components Across Panel + Mobile

Status: **consensus v2, awaiting remaining owner decisions** (final section).
Produced 2026-07-21 by a two-model review series: gpt-5.6 (codex) and
grok-4.5 (cursor-agent) reviewed independently, then cross-reviewed each
other — twice (round 1: architecture + refactor path; round 2: wrapper
choice, server/storage/DB, dependency posture). Full reports:
`docs/reviews/refactor-2026-07/`. Disputes were resolved by re-reading the
code; everything unresolved is an owner decision — nothing here silently
picks a side.

## Why (the consensus diagnosis)

1. **No shared wire contract.** `state-watch.ts` owns `PanelSnapshot` /
   `AgentView`; `panel/src/main.ts:15-43` re-declares a _partial_ copy that
   omits `queuedPreview`, `injectable`, and the whole `live` object;
   mobile.html consumes the JSON untyped. Desktop literally cannot render
   waiting text or live activity without contract work first. React alone
   fixes none of this — the contract is the first extract.
2. **Two ad-hoc protocols.** Desktop: WS fire-and-forget with uncorrelated
   error frames + multiple picker requests. Mobile: SSE snapshots + POST
   `/action` with immediate HTTP results + aggregated `/picker`.
   `MOBILE_ACTION_TYPES` is a second capability model hidden as a `Set` in
   `panel-ws.ts`. `mobile-http.ts` importing `dispatchPanelAction` from
   `panel-ws.js` is the wrong seam — it becomes a shared command service.
3. **Mutation-heavy monoliths.** `mobile.html` (4,567) and `panel/src/main.ts`
   (2,868) re-render whole regions via innerHTML/template strings; focus,
   drafts, timers, and audio survive via bespoke workarounds (mobile's
   focus-capture block, panel's rebinding). This is the debt the mandate
   kills.
4. **Desktop window built around a dead constraint.** `lib.rs` unconditionally
   converts the sole window to a non-activating, floating, join-all-Spaces
   NSPanel with app-global `Accessory` activation; `tauri.conf.json` adds
   `alwaysOnTop`. Owner: that behavior is wanted for dock mode only.
5. **Deploy can ship stale or mixed code.** `tts-server.sh` copies with
   `|| true`, never deletes removed files, doesn't sync lockfiles; raw
   `mobile.html` copy must die when the mobile build lands. `setup.sh` mixes
   install with billable ElevenLabs voice/SFX refresh (`:325-350`).
6. **Server hygiene gaps (v2 findings):**
   - **Startup queue recovery hole**: the queue watcher uses
     `ignoreInitial: true` and the in-memory queue starts empty
     (`index.ts:406-428,523-535`) — files queued while the daemon is down
     (or orphaned by a crash) are never auto-admitted after restart. A live
     inspect found 7 stranded files. Correctness + credit-safety, fix early.
   - **Stream lock is not atomically acquired**: `acquireLock()` is
     check-then-`writeFileSync` while `claimProcessing` correctly uses
     exclusive `wx` (`audio.ts`); lock holders include other processes
     (`phrases.ts`, `announce.ts`), so this is interprocess.
   - **Retention drift**: `played/` observed at 442 entries against a
     50-file config because `cleanup_played.sh` only runs from ingest;
     `countSuperseded()` re-scans `PLAYED_DIR` **per agent** on every
     snapshot build (`state-watch.ts:153-174`); each SSE client also
     rebuilds the whole snapshot independently (`mobile-http.ts:509-523`).
     `hook.log` grows unbounded (`logger.ts`); `failed/` has no retention.

### Notable cross-platform inconsistencies (fix via shared components)

- **State colors are semantically reversed**: panel `working`=amber,
  `hand_raised`=blue (`style.css:532-537`); mobile `working`=blue,
  `hand`=amber (`mobile.html:18-19`). Tokens must be semantic
  (`--state-working`), and one mapping must win (owner decision).
- **"Live" is a naming collision, not a depth difference**: panel's
  `isSessionLive()` means "Mac lipsync stage is active"; it never reads
  `agent.live` or sends `set_live`. Mobile's live is daemon narration/call
  mode. Rename the desktop stage concept during migration.
- **Duplicated 25s grant optimism**: `PENDING_GRANT_MS` in `main.ts:129` and
  an independent `grantPending` + 25000ms timeout in `mobile.html` — belongs
  in the shared client, once.
- **Two markdown renderers with different link policies**: panel emits inert
  `.md-link` spans; mobile emits real `target="_blank"` anchors.
- **Persona catalogs**: panel hardcodes `PERSONAS`; mobile gets them from
  `/picker`. Both consume one typed `SessionPickerData` service.
- **Dead code**: panel's `"summary"` action-cluster branch is unreachable for
  room cards — delete or restore deliberately, don't port mechanically.

## Closed by v2 consensus (owner veto still possible)

- **Desktop shell: keep Tauri 2.** Electron rejected (ships Chromium+Node
  all day for a companion app and still has no first-class NSPanel);
  browser/PWA-desktop rejected (can't do NSPanel/Spaces/activation policy);
  native SwiftUI/WKWebView rejected unless `tauri-nspanel` proves
  unblockingly broken (it would rewrite working glue + a JS↔native bridge
  for little gain). Fix the build pain with scripting instead: a dev
  install command (build → stage → replace bundle → relaunch on request,
  fail on stale artifacts) and `pnpm tauri dev` for ordinary React work.
- **Window mechanics: two Tauri windows.** `main` = normal activating
  NSWindow (normal Spaces/focus), created as the floating room. Dock =
  second webview window, converted once via `to_panel()` with float level,
  non-activating mask, `CanJoinAllSpaces` + `FullScreenAuxiliary` — i.e.
  today's `lib.rs` policy moves onto the dock window only. App-global
  `Accessory` activation must also become role-aware (`Regular` while the
  floating window is primary — behavior check in the desktop-shell phase).
  Two webviews are two JS realms: same bundle, but each mounts its own
  `RoomClient`; coordination happens via daemon snapshots, not shared
  memory. Only floating chrome (standard titlebar — recommended — vs
  custom) remains an owner decision.
- **Storage: no database.** Filesystem + retention + memoization beats
  SQLite at this scale; a DB can't replace the hook IPC contract, so it
  would only add dual-write/reconciliation surface. **Supabase rejected
  outright** (network, credentials, privacy, hosted lifecycle for a
  local single-user tool). Reopen SQLite only on a measured trigger
  (unbounded searchable history, analytics over months, scan bottlenecks
  that in-memory caching can't fix) and then only as a **rebuildable
  derived index** — never for locks, queue admission, billing markers, or
  hook-visible state.
- **React 19 + Vite** (Preact rejected; the shadcn layer is React).
- **Dependency posture reversed from v1** — see stack below.

## Dependency stack (v2)

| Area                | Pick                                                                                                                                                                                        | Notes                                                                                                                                                                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI primitives       | **Tailwind + selective vendored shadcn/Radix** in `packages/ui`                                                                                                                             | Take `Button`, `Dialog`/`Sheet`, `Popover`, `DropdownMenu`, `ToggleGroup`, `Tooltip`, toast (sonner-style). Do NOT take layout/sidebar/card kits — `AgentCard`, `RoomGrid`, `KaraokeLine`, call/chat chrome stay custom. shadcn vendors source into the repo: good for a personal monorepo. |
| Design tokens       | **Semantic CSS variables remain the authority**                                                                                                                                             | `--state-working`, `--state-hand-raised`, `--room-accent`… mapped into the Tailwind theme. Never encode state as raw color utilities; the amber/blue reversal is fixed at the variable layer.                                                                                               |
| Protocol validation | **Valibot** in `packages/protocol`                                                                                                                                                          | Schemas + inferred types; validate at transport boundaries (and commands server-side). Modular imports suit the mobile bundle. Zod acceptable if owner prefers familiarity. Package is React/browser-free, not dependency-free.                                                             |
| WS reconnect        | **`reconnecting-websocket`** (or equivalent maintained client) behind `WsTransport`                                                                                                         | Replaces the fixed 2s timer; backoff/jitter/intentional-close/queued sends are the wheel worth importing. Lives below React in `room-client` — no socket hooks, no realtime SDKs.                                                                                                           |
| SSE                 | **Native `EventSource`**, protocol made revision-aware                                                                                                                                      | Browser already reconnects; add snapshot revisions so stale bootstrap/replayed frames are ignored.                                                                                                                                                                                          |
| Client state        | **External `RoomClient` + `useSyncExternalStore`**                                                                                                                                          | Zustand/Jotai/Redux rejected — a pushed atomic snapshot isn't a state-library app.                                                                                                                                                                                                          |
| Data fetching       | **No TanStack Query**                                                                                                                                                                       | Push model; picker/thread/replay are a few imperative typed queries cached in `RoomClient`. Revisit only if read models multiply.                                                                                                                                                           |
| Markdown            | **`react-markdown` + `rehype-sanitize`**, raw HTML disabled, platform link component (inert vs external)                                                                                    | Replaces both hand-rolled renderers and kills `innerHTML`/`dangerouslySetInnerHTML` for message text. Add `remark-gfm` only if tables/task-lists become real needs.                                                                                                                         |
| Classes             | **`clsx` + `cva`**; `tailwind-merge` only inside vendored primitives                                                                                                                        |                                                                                                                                                                                                                                                                                             |
| Icons               | **Lucide** via a shared `IconButton` (labels mandatory)                                                                                                                                     |                                                                                                                                                                                                                                                                                             |
| Rejected            | Zustand/Jotai/Redux/MobX, TanStack Query (snapshot path), virtualization, date libs (`Intl` + tiny helpers), MDX/remark-heavy stacks, realtime SDKs, Next.js/Remix, Electron, any DB client |                                                                                                                                                                                                                                                                                             |

## Target structure

Root pnpm workspace, **no physical directory moves initially** (`panel/` and
`tts-server/` stay put until protocol + client are green):

```text
pnpm-workspace.yaml
package.json            # orchestration scripts only
packages/
  protocol/             # Valibot schemas + inferred wire types: PanelSnapshot,
                        # commands, queries, notices, CommandResult, envelopes.
                        # React/browser-free — daemon imports it directly.
  room-client/          # external store + selectors + grant optimism;
                        # reconnecting-WS transport + revision-aware SSE/HTTP
  ui/                   # semantic tokens, Tailwind preset, curated vendored
                        # shadcn/Radix primitives, domain components, Markdown
  assets/               # avatar/expression source of truth (may start as
                        # ui/public), replacing "copy out of panel/public"
panel/                  # Tauri app: normal main window + dock NSPanel window
packages/mobile/  (or apps/mobile — naming open)
                        # Vite SPA → static dist served by mobile-http
tts-server/
  src/services/         # snapshot, recovery, command, picker/catalog
scripts/                # atomic artifact sync; dev install/relaunch command;
                        # voice/SFX refresh split out of setup
```

Invariants:

- Daemon and both UIs import **the same** protocol package (no mirrored
  types). Installed daemon under `~/.cursor/tts/` must never resolve modules
  back into the repo workspace — stage package output with the install.
- WS and SSE/HTTP stay separate transports (two listeners = deliberate
  security boundary: loopback WS vs LAN HTTP) as thin adapters over one
  server command service. Mobile capability allowlist stays
  **server-authoritative**; server may expose capabilities so clients render
  disabled states from one list.
- Filesystem IPC under `~/.cursor/tts/` untouched. Credit guards
  (mute-before-API, dedup, hold-one live buffer, locks/markers, phone-grant
  windows, cached-only acks) preserved verbatim; `audio.ts` / live-tail off
  the React critical path. No process split — one daemon, shared services.
- **Future direction (v3 consensus, `docs/design-conversational-layer.md`):**
  a conversational interpreter (voice → intent → commands/Q&A) will later
  join as an **in-process daemon consumer of the shared command and
  transcript services**. UIs and `room-client` never own intent routing;
  no conversation SDK, package, or schema is built during this refactor —
  only the seams noted in the phases below.

### Component inventory (abridged)

Shared: `RoomGrid`, `AgentCard` (identity/avatar/state badge/queue/muted/
queued-preview/primary action), `NowPlaying` + transport buttons,
`KaraokeLine`, `Markdown`, `SessionPicker`/`PersonaPicker` structure,
`ConnectionDot`, toasts, `LiveBadge`, modal/sheet + `IconButton` primitives
(vendored shadcn under the hood), selectors (`selectVisibleAgents`,
`selectNowPlaying`, `selectGrantPending`…). Shared components take domain
values + callbacks only — no fetch/WS/Tauri/audio calls inside.

Desktop-only: shell + dock (spotlight/captions/snap), Tauri window adapter,
settings + HID/arcade mapper, terminal focus/kill, voice swap, rich
blink/expression animation.

Mobile-only: shell (safe-area/touch), call + chat/thread views, reply
composer + PTT, phone audio engine (autoplay priming, Mac↔phone handoff),
output-device pref, hidden-devs/replay-history/listened state.

## Phases (each shippable, manual/scripted verification, zero live synthesis)

**0 — Baseline + protocol.** Screenshot/behavior checklist for room, dock,
picker, call/thread, grants, pause/resume, replay. Root workspace (no
moves). `packages/protocol` with Valibot schemas + fixtures from sanitized
snapshots. Additive `requestId`/`CommandResult` on WS and a daemon-local
monotonic snapshot revision — old messages still accepted; no big-bang
protocol redesign. Envelopes stay discriminated + additive (unknown kinds
ignorable) and commands carry an authenticated `source`/actor context
(`desktop | mobile | voice | interpreter`) — reservation only; no
conversational schemas or lifecycle machinery yet.

**1 — Server recovery, hygiene, services, deploy.** In order within the
phase:
_(a) Recovery slice:_ startup scan of `queue/*.json` reconciled through the
existing `processQueueFile`/`claimProcessing` path (no bypass of mute/live/
lock guards; watermark against the watcher so nothing is missed or
double-admitted); stream lock moved to exclusive-create (`wx`) acquisition;
`hook.log` rotation; `failed/` retention; daemon-enforced `played/` cleanup
at startup.
_(b) Services:_ extract _narrow_ command + session-picker services from
`panel-ws.ts`; WS/HTTP become thin adapters with uniform `CommandResult`.
The command service is **domain-shaped, not panel-action-shaped** —
`voice.ts`/PTT are documented as eventual callers (migration can be lazy;
the grammar/aliases stay intact; no interpreter service is created yet).
One memoized snapshot per debounced revision for all subscribers, and played
metadata read/indexed **once per build**, not per agent. TTL/mtime caching
for picker/catalog. Transcript parsing moves out of `mobile-http.ts` into a
reusable bounded **transcript service** with separate projections: the UI
thread (as today) and a future redacted tool-output projection for factual
Q&A (`transcriptThread` currently strips tool results — don't bake that
limitation into the service API). Fail-loud stage-then-swap deploy;
ElevenLabs voice/SFX refresh split out of default `setup.sh` into an opt-in
command. Optional spike: serve a stub built page from the mobile dist path.

**2 — Shared client under old UIs.** `room-client` + both transports wired
beneath the existing renderers (panel first, mobile second). Grant optimism
moves into the client once. Verify reconnect (now with real backoff),
notices, stale-session errors, bootstrap/stream ordering via revisions.

**3 — Tokens + leaf React islands.** Tailwind + curated shadcn baseline;
semantic tokens land (state-color reversal resolved); shared
`react-markdown` renderer with link policy; leaf components (badges, avatar
helpers, queued preview, transport buttons, now-playing text) mounted as
islands. Rule: an action is owned by the old handler OR the React island,
never both. Lip-sync/karaoke timing stays in refs + rAF.

**4 — Desktop React shell + two windows.** Room/picker/settings, then dock
as its own step. All Tauri calls behind a platform adapter. Floating =
normal activating window; dock = separate NSPanel window carrying today's
`lib.rs` policy; role-aware activation policy; hide-vs-destroy on mode
switch decided here. Rename the desktop "stage live" vocabulary.

**5 — Mobile Vite shell + cutover.** Vite entry + authenticated static
serving first; migrate room/picker **directly onto shared components** (no
parity clone), then player/replay, then call/thread/composer last;
phone-audio controller stays behind an adapter until parity is proven with
cached audio; keep that adapter content/delivery-neutral and abortable
(future interpreter replies route through it). Phone mic capture /
hold-to-talk is explicitly **future work** — today's phone is output +
typed reply only. Atomic cutover: no-cache `index.html`, immutable hashed
assets, staged swap, `mobile.html` kept as rollback for one release.

**6 — Delete + legacy audit.** Remove old renderers, duplicate
types/markdown/tokens, compatibility acceptance, `mobile.html`. Build a
caller/install manifest for every script (bash ingest fallback and
`clean_text.py` are still live via `hook_stop.sh` / `notify_queued.sh`).
PTT plumbing (`ptt.sh`, `voice_ptt.sh`, `voice.ts` grammar/aliases, arcade
bindings) is **not** a legacy deletion candidate — it's the input half of
the future conversational layer. SwiftBar demoted or dropped per owner. Update CLAUDE.md in the same change
as each deploy-behavior change.

**7 — Optional server splits.** `audio.ts` → playback-locks /
now-playing-store / replay-store / phone-grant; `hid.ts` → device / mapping /
controller — facade-preserving, only on concrete need.

## Risks

- Dual-dispatch double-fire during coexistence → single pending-command
  store, immediate control disable, server locks/dedup remain final
  authority.
- Queue reconciliation double-admission → route through existing claim
  guards + watcher watermark; billed items still go to played/failed.
- Phone autoplay/stream-handoff regression → audio state machine migrates
  last, behind adapter, verified with cached/saved audio only.
- React cadence hurting lipsync/karaoke → rAF + refs, targeted commits.
- Installed daemon breaking on workspace resolution → stage package output
  into the install; smoke-start without credentials before swapping.
- Credit burn during refactor → never touch mute/live-tail/audio locks in UI
  phases; verify with `signal.ts replay` and keyless runs; install path
  makes no API calls.
- Legacy deletion breaking hooks → manifest first, delete in its own
  reversible phase.

## Owner decisions

**Closed by v2 consensus** (say so if you want any reopened): keep Tauri;
two-window dock mechanics; no database (SQLite only on measured trigger,
Supabase never); React 19; Tailwind + selective shadcn; Valibot;
reconnecting-websocket; react-markdown path.

**Still open:**

1. **Floating window chrome** — standard macOS titlebar (recommended) vs
   custom web chrome.
   - Choice: standard macOs titlebar
2. **State colors** — which mapping is canonical for `working` /
   `hand_raised` (panel amber/blue vs mobile blue/amber) and which accent
   wins (mobile `#3ecf8e` vs panel `#49d99a`).
   - working / hand raised should be amber then blue.
   - the green accent from mobile
3. **Desktop live-mode depth** — none / indicator-only / full toggle / full
   chat+reply port. (Stage-vocabulary rename happens regardless.)
   - start with indicator only but i think the full port would eventually be in the cards
4. **SwiftBar + Raycast** — launcher/status-only, feature-freeze, or stop
   installing once React desktop reaches parity.
   - im not sure if the swiftbar tool has much merit anymore, might not be necessary
5. **Mobile artifact policy** — build-on-deploy vs commit `dist`; either is
   fine if stale artifacts fail loudly.
   - commit is fine for now until we need to do something different
6. **Multi-phone** — one trusted phone or multiple simultaneous clients
   (affects SSE fan-out + audio ownership design).
   - uhh right now i generally only use one phone for this so can just put multiphone on backburner
7. **Preference scope** — which of hidden-devs / listened history / output
   target / drafts stay browser-local vs move daemon-side.
   - idk what drafts are
   - hidden-devs / listened history: seems like these should be daemon side
   - output targer: hmm spotify has it where the target is set and doesnt matter which device the next song is chosen on, the output device plays the choice until the output device is changed. so maybe something like that? daenon side?
8. **setup.sh API split** — both models strongly recommend voice/SFX
   refresh become opt-in; confirm so Phase 1 can include it.
   - im not sure what this means. go with the recomendationt

**Future-feature decisions** (conversational layer — decide when it's
scheduled, none block this refactor): interpreter reply policy (silent /
cached / `say` / character ElevenLabs), room-memory vs Claude-memory as
separate explicit write destinations, duplex mic-audio privacy line, and
PTT-only vs wake word. See `docs/design-conversational-layer.md`.
