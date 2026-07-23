# Overnight decisions log — refactor autopilot (2026-07-22)

Owner directive: continue phases hands-off overnight; when an issue or
unknown comes up, triage with codex (gpt-5.6) and grok, make the best
informed guess, and record it HERE for morning review. Newest at top.

Format per entry: **context → options considered → who was consulted →
decision + why → how to reverse if you disagree.**

---

## Phase 4b (two windows: floating NSWindow + dock NSPanel) — 2026-07-22 night

Same-session follow-on to 4a. Sol focused review of the ~260-line delta
(1 blocker, 2 majors, 2 minors — all fixed pre-deploy).

### What shipped

- `main` window: normal ACTIVATING NSWindow, standard macOS titlebar
  (owner decision #1), alwaysOnTop removed, appears in Dock/⌘-Tab while
  floating. `dock` window: hidden second webview converted ONCE at setup
  via to_panel(), carrying the old whole-app policy (float level 4,
  non-activating+resizable mask, CanJoinAllSpaces+FullScreenAuxiliary).
- lib.rs `set_room_mode` = the mode authority: Mutex-serialized,
  idempotent, ROLLBACK on any failed step (policy failures restore the
  previous visible window — no partial commits, Sol major #2). Dock
  entry computes the FINAL bottom-center position in Rust from MAIN's
  monitor + the dock's current size BEFORE order_front_regardless (the
  plugin's show() is never used — it makes the panel KEY; Sol blocker:
  without Rust-side placement the dock appeared parked until the next
  React commit). Activation policy is role-aware: Regular floating,
  Accessory docked (runtime AppHandle::set_activation_policy).
- **Hide, not destroy** on mode switch (logged in the design doc):
  to_panel is one-shot, webview recreation re-runs the whole bootstrap;
  hidden windows cost memory only and rAF parks itself.
- Two realms, same bundle: App switches on window label via
  platform.windowRole(); each realm runs its own RoomClient/stores/
  engine; coordination via daemon snapshots only (spec invariant).
  view-state.dockMode died — window visibility IS the mode.
- Capabilities split per window (Sol 4b #1 from the design critique):
  dock gets geometry/drag/ws_token/set_room_mode only — no dialog, no
  close. New permissions/allow-set-room-mode.toml (hand-written app
  permission, mirrors allow-ws-token).
- Close = quit: main's CloseRequested → app.exit(0) (the hidden dock
  would otherwise keep the process alive). The old in-app ✕/title/drag
  died in ALL headers (RoomView + Picker + Settings — Sol major #3
  caught the second titlebar in Terra's views); native chrome owns
  those. body.native-chrome CSS drops the floating-card corner styling.
- Dock geometry effect: deps [width,height] + serialized/coalesced
  adapter calls (Sol minor #4). Deliberate delta: a DRAGGED dock now
  stays where you put it until its size changes or dock mode re-enters
  (legacy re-centered on every snapshot).
- Cross-realm grant markers became reactive: `storage` events from the
  other realm bump an external-store version App subscribes to (Sol
  minor #5) — the newly shown realm renders pending spinners without
  waiting for a snapshot. Sol verified the localStorage-sharing
  assumption holds for this stack (same-origin webviews, one default
  WKWebsiteDataStore); daemon claim markers remain the billing backstop.

### Verification

Gates: workspace typecheck, cargo check, vite build, panel-dev-install
deploy. codex computer-use window-behavior pass: **11/11 PASS, zero
grants** — standard titlebar + activation (LaunchServices Foreground
floating / UIElement docked, i.e. the role-aware policy verified both
ways), immediate bottom-center dock placement, dock never steals focus
(Finder stayed active through pill interaction), dock visible over a
native full-screen Space, 4 rapid mode switches with no stuck/double
state, cross-realm localStorage proven (same timestamp read from both
webviews' consoles), dock spotlight staged during free replay, transport
single-fire, red-light close quits the app + clean relaunch. No visual
artifacts (corners/titlebar/seams) reported.

---

## Phase 4a (desktop React shell, single window) — 2026-07-22 evening

Design: `phase4-shell-design.md` (my draft) → Sol adversarial critique
(gpt-5.6-sol, high effort: 4 blockers, 13 majors — resolutions table in
that doc) → implementation → Sol deep pre-deploy diff review (1 blocker,
7 majors, 3 minors — ALL fixed before deploy, see below). Terra
(gpt-5.6-terra) implemented the server button-null fix + PickerView/
SettingsView against written specs; shell architecture, stores, stage
engine, gesture, and merges in-session.

### What shipped

- main.ts (2508 lines) + the Phase 3 portal seam (host.tsx/syncIslands/
  placeholder contract) DELETED; real component tree: App / RoomView /
  AgentCard / DockView / PickerView / SettingsView over external stores
  (view-state.ts, server-data.ts — legacy timer/error semantics moved
  verbatim, incl. per-surface writable flags, learn-capture 15s window,
  toast 2000/2600ms belts, dock hover 250ms grace).
- Lipsync/blink → stage/ engine: ONE rAF loop + ref registry, 70ms
  watchdog when rAF stalls >150ms (WebKit rAF in a non-key NSPanel is
  unproven — Sol), SIGSTOP pause-anchor arithmetic preserved, blink
  restore-not-replay on wake, React never owns img src (engine sets the
  first frame synchronously at ref registration).
- Grant/PTT gesture → usePttGrant on the card/dock-avatar-btn: refs-only
  state, exactly-one `ptt stop` on unmount/blur/visibility/pointercancel,
  event firewall extended with [data-no-grant] (portaled Radix popover
  content bubbles through the REACT tree — clicks on popover padding
  would have armed PTT; two belts now: PopoverContent stops
  pointerdown/mousedown/click + firewall rejects [data-no-grant]).
- Platform adapter (`platform/tauri.ts`) — the only importer of
  @tauri-apps/*; dock geometry + corner snap moved behind it; snap
  no-ops when the window is hidden (4b: both realms get the HID event).
- Stage-vocab rename per spec: isSessionLive → isStageActive /
  isSpotlightWorthy, ClusterMode "live" → "stage",
  `.spotlight-ring.live` → `.on-stage`. NEW LiveBadge (@room/ui) reads
  `agent.live` — card chips row + dock spotlight (owner decision #3,
  indicator only).
- **Button-patch null bug FIXED both sides** (the one sanctioned daemon
  change, daemon deployed first): protocol ButtonPatchSchema strict +
  nullable clearable fields (name NOT nullable; character+action both
  non-empty rejected; {} rejected) with negative fixtures + checker
  support; server parseButtonPatch accepts null=clear, applyButtonPatch
  null-safe; test-panel-ws-buttons.ts extended (null clears character/
  action end-to-end over WS — PASSED).
- Cross-realm grant belt (grant-guard.ts): localStorage markers so 4b's
  two realms can't double-dispatch a grant around a mode switch; markers
  settle the moment this realm's RoomClient optimism clears (Sol deploy
  review BLOCKER: naive 25s TTL would have pinned spinners and blocked
  legitimate re-grants). Daemon claim markers stay the billing authority.
- scripts/panel-dev-install.sh: build → stale-artifact check → install →
  relaunch (v2-consensus dev install command).

### Judgment calls (review in the morning)

- **Kill-arm/swap state stays in the external ui-state store** rather
  than React state — remounts no longer force it, but it's proven,
  snapshot-pruned, and not worth churning.
- **JSX mirrors legacy class names/structure exactly**; style.css rules
  untouched except the .on-stage rename + new .chip.live-mode. Dead-CSS
  sweep deferred until after 4b (Sol: dynamic `state-*`/`actions-*`
  classes make a grep sweep unsafe; needs the allowlist).
- **Toast stays the legacy single-toast model** (sonner stays vendored,
  unused).
- **Settings name/notes inputs are uncontrolled with value-keyed
  remounts** — a server update refreshes them unless you're mid-edit of
  that very field (single-user tool; legacy lost focus entirely here).
- **Speed slider**: drag is local preview; ONE deduped commit on
  pointer-up/cancel/blur/key-up (legacy double-sent on change+pointerup).
- **Spotlight enter animation** now replays via keyed remount per staged
  message instead of a 280ms wall-clock class window (render-pure).
- **Tailwind policy formalized** (Phase 3 deferral): no global preflight
  permanently; tokens unlayered → Tailwind theme/utilities layered →
  app CSS unlayered wins; primitives carry their own scoped resets.

### Deploy + verification

- Gates: workspace typecheck, check-fixtures (incl. new negative cases),
  panel vite build, verify-live.ts 9/9, buttons WS test.
- Daemon deployed via tts-server.sh restart (button fix live).
- Panel: pnpm tauri build --debug → install → relaunch
  (scripts/panel-dev-install.sh).
- codex computer-use, 3 rounds, ONE paid grant total (~jellyfin's queued
  update; exactly one grant_floor → gemini → elevenlabs in the log):
  - PASS with evidence: room grid, NEW LIVE badge (staged free via a fake
    session tailing an EMPTY transcript — the daemon's no-transcript
    guard kills live for sessions without one, so the empty file is the
    no-spend trick), queued previews, transport single-fire (2 clicks =
    2 log lines), replay single-fire, swap popover (7 personas), popover
    PADDING click fires no ptt/grant (the new firewall), outside-click
    dismiss, grant single-fire + loading ring, settings general/buttons,
    **button assign→unassign→restore persisted correctly in
    arcade_buttons.json (null fix proven live)**, picker + flags, rename
    single set_nickname, dock enter/hover/captions/expand, character
    swap via persona chip → avatar art remounts (engine re-registration
    path), **mouth flaps visibly alternate + smooth under the rAF
    engine** during a free cached replay.
  - False alarms triaged, all legacy parity: "gray avatars" =
    default/idle.png IS a solid gray square and no session had a
    character (engine verified working via DOM probe: src set, 200,
    naturalWidth 64); kill-arm "failure" = codex clicked the correctly
    DISABLED kill button on a non-team card (no team session existed to
    test arming; logic verbatim from Phase 3's verified pass);
    rename-to-empty rejected server-side (legacy behavior).
  - Not visually confirmed: blink (130ms frame, missed by ~5fps
    screenshot sampling; rides the same tick loop as the verified
    flaps). Settings buttons rows with lowercase character values show
    "Unassigned" in the dropdown — pre-existing legacy quirk (case
    mismatch vs capitalized option values), unchanged.
  - All test state cleaned: fake live session (state file + live entry +
    empty transcript) removed, session_voices.json restored (Leonardo
    swap reverted), TestNick nickname cleared.

---

## Phase 3 (tokens + leaf React islands, panel only) — 2026-07-22 daytime

### Verification outcome (deployed same day)

- Gates: workspace typecheck clean (incl. new @room/ui), check-fixtures ok,
  panel vite build ok, verify-live.ts 9/9 against the running daemon.
- Sol pre-deploy review of the full diff: **no substantive findings**.
- codex computer-use (4 passes; the first used accessibility presses which
  can't drive the hover-gated clusters — its cluster "FAILs" were test
  artifacts, daemon logs proved the commands never left the tool, not the
  panel): islands render (badges, chips, NEW queued preview, summary pane
  markdown with bold/inline-code), transport buttons single-fire (two
  clicks = exactly two daemon log lines), Speak Status single-fire, swap
  popover opens with all 7 personas + outside-click dismiss, kill-arm
  proven by an atomic devtools probe — `{armedAt200ms: true,
  disarmedAt9500ms: true}`, no kill dispatched. Grant: ONE card click →
  spinner → exactly one grant_floor → gemini → elevenlabs sequence in the
  log; lipsync flapped smoothly with the new green rings during playback.
- Spend: one granted synthesis (~1170 chars, this Claude session's own
  raised hand — same pattern as Phase 2's test). The card-less
  `enqueue_manual` "Verify" item was deleted (manual sessions have no
  state file → no card; known daemon behavior, predates this phase).
- Quirk found, accepted: clicking the window-title drag region doesn't
  dismiss the swap popover (Tauri drag intercepts the pointer); any other
  outside click does. Legacy had NO outside-dismiss at all.

Design: `phase3-tokens-islands-design.md` (my draft) → Sol adversarial
critique (gpt-5.6-sol, high effort, 16 findings — resolutions table
appended to that doc) → implementation. Terra (gpt-5.6-terra) implemented
the vendored shadcn/Radix primitives + Markdown renderer against a written
spec; domain components, tokens, and the main.ts island surgery done
in-session.

### Judgment calls made without asking (review in the morning)

- **Island seam kept as one persistent root + portals despite Sol calling
  it a blocker.** Sol's failure mode (React cleaning up under
  innerHTML-replaced DOM) is defused by two facts: replaced containers
  stay detached WITH their subtrees (React's removeChild is safe), and
  syncIslands() flushSync-commits in the same task as the legacy render —
  no async window. His alternative (stable host regions) is Phase 4's
  React shell by another name; not a leaf-island-phase change.
- **Grant/PTT stays 100% legacy** (card-wide gesture entangled with the
  300ms PTT hold on the same element; moving it makes the card an island,
  not a leaf). Single ownership preserved. Codex still verifies
  single-fire.
- **Cluster-gap clicks no longer grant** — legacy fired a billable grant
  when you clicked the empty gap BETWEEN action buttons on a hovered
  card; the new event firewall (`isNonGrantTarget`) treats the whole
  cluster container as non-grant surface. Deliberate improvement, not a
  parity bug.
- **Swap popover is now Radix-positioned** (collision-clamped, top/end
  preferred) instead of the hand-rolled fixed-position math; autofocus
  suppressed so snapshot-driven remounts don't steal focus. Positioning
  may differ by a few px from legacy.
- **`--room-interactive` token added** (Sol #11): `--blue` aliases it, so
  future state-color changes don't restyle links/sliders/borders.
- **Old-green alpha literals** (`rgba(73,217,154,…)`, dock-live
  `rgba(88,214,141,…)`, `#9aebc6`, `#4ade80`) all re-derived from
  `--room-accent` via color-mix — otherwise the accent change would have
  produced two greens (Sol #12).
- **remark-breaks added** to the shared Markdown component so soft line
  breaks keep rendering as `<br>` like the legacy renderer (Sol #14).
- **Tailwind v4, preflight OFF**, utilities layered → legacy unlayered
  CSS wins by design; formal layer policy deferred to Phase 4 (Sol #13,
  his recommendation matched).
- **queuedPreview now visible on desktop** (hand-raised cards show the
  waiting text) — the spec's called-out gap, landed as part of the chips
  island. New `.queued-preview` rule in style.css.
- **panel/src/markdown.ts deleted** (both call sites are islands now);
  `stripMarkdown` lives in @room/ui.
- **Mid-gesture snapshot click-loss NOT fixed** — pre-existing legacy
  behavior (innerHTML rebuild), identical cost model with islands;
  documented instead (Sol #3).

Baseline deltas vs `baseline/checklist.md` (intended, owner-decided):
accent green is now #3ecf8e everywhere the old #49d99a/#58d68d appeared
(conn dot, speaking ring, hold-active, dock live controls, phone chip);
queued-preview text is new on hand-raised cards; swap popover positioning
is Radix-computed. State color MAPPING is unchanged on the panel (it
already matched the owner decision).

---

## Phase 2 (shared client under old UIs) — 2026-07-22 daytime

### Verification outcome (deployed same day)

- Sol pre-deploy review of the full diff: no substantive findings.
- Live WS harness (now committed: `packages/room-client/scripts/
  verify-live.ts`, runs the real WsTransport+RoomClient under Node):
  9/9 basic checks; reconnect run proved down/up edges across the daemon's
  token rotation AND the epoch gate accepting rev 1 < old rev 2 after
  restart (the case plain rev-gating would have bricked).
- codex computer-use pass: desktop room/dock/expand PASS, mobile PASS with
  zero console errors (rev/epoch ignored by old client as designed). Its
  two "FAILs" were test artifacts, not regressions: (a) the one grant click
  landed on this Claude session's own hand-raised card (its Stop hook fired
  mid-test) instead of the "Verify" card — the optimism mechanism itself
  passed (spinner → audio → cleared); (b) the reconnect red-dot phase was
  faster than the first screenshot — edges already proven by the harness.
- One synthesis total spent (216→529 chars, the granted card). The unused
  "Verify" test queue item was deleted afterward to avoid a later billable
  grant on test data.

### Mobile wiring DEFERRED to Phase 5 (kickoff explicitly delegated this call)

Context: wire room-client under mobile.html now (committed IIFE bundle via
owner decision #5) or defer. Consulted: an Explore scout mapped
mobile.html's internals; grok-4.5-high triaged; Sol's design critique
covered the same ground. Both models converged on **defer**: of the three
Phase 2 behavior changes, mobile only meaningfully gains rev-gating (its
SSE is ordered steady-state; EventSource already reconnects), the wiring
glue (IIFE global + committed bundle + monolith edits) is throwaway the
moment Phase 5's Vite SPA lands, and the phone is the daily driver —
regression asymmetry is bad. `SseTransport` still ships in the package
(typechecked, protocol-faithful to /events + POST /action) so Phase 5
mounts it directly. Reverse by: building the room-client IIFE bundle and
wiring per the scout notes (single `snapshot` var + `postAction` are the
seams) — nothing in Phase 2 forecloses it.

### Grant optimism unified on PANEL semantics (mobile's differed — not a copy)

The spec's premise ("the duplicated 25s logic") turned out half-true: only
the 25s belt was duplicated. Panel cleared pending on now-playing baseline
change; mobile cleared when the agent left `hand_raised` (fires while
synthesis is still pending — spinner drops too early) and on POST failure.
Unified in `grant.ts`: per-session pending MAP (mobile's concurrency;
panel's single slot silently dropped spinner #1 if you granted two agents),
panel's baseline-key rule scoped per session, mobile's dispatch-failure
rollback, 25s belt. Net panel-visible change: near zero; mobile adopts
this in Phase 5.

### Snapshot staleness gate is (epoch, rev), not rev-reset-on-reconnect

Sol's critique caught that resetting the rev baseline on every reconnect
conflates connection generation with daemon generation (revs are
daemon-global; only a daemon restart resets them). Added additive
`epoch` (daemon boot time) to PanelSnapshot, stamped in state-watch;
client resets its rev baseline only when epoch changes (pre-epoch daemons
fall back to reset-on-reconnect). Old clients ignore the field.

### reconnecting-websocket wedge guarded

RWS v4.4.0's connect path has no rejection handler for async URL
providers — a rejected `ws_token` invoke (daemon down at panel launch =
token file missing) would set `_connectLock` forever and kill reconnection.
WsTransport's provider never rejects: falls back to last-known URL, else
`ws://127.0.0.1:9/` (discard port → instant refusal keeps the retry loop
alive). Found by Sol, verified against the vendored RWS source.

### Server-side fixes ridden along (small, Phase-2-adjacent)

- SSE `/events`: subscribe BEFORE the bootstrap write (a state change in
  the gap was previously lost until the next watched change). Ordering
  stays safe for the existing mobile.html last-writer-wins client.
- `query()` settles only on the expected tagged domain reply (server sends
  it BEFORE command_result; mutations can emit tagged frames too — naive
  "any tagged reply" correlation would mis-settle). Replies also cached
  (`getCachedQuery`) for Phase 3 islands; legacy handlers still get them
  via onEvent.

### Pre-existing bug found, NOT fixed (out of scope): button patch nulls

The panel has ALWAYS sent `{action: null}` / `{character: null}` to clear
button assignments, and the server's `parseButtonPatch` (from 4bf9724,
pre-refactor) has always rejected null as `bad_message` — assign/unassign
from the panel's Buttons settings tab silently no-ops server-side. Phase 2
keeps the wire bytes identical (`sendButtonPatch` cast). Fix belongs in a
deliberate change to both sides (accept null = clear, or send deletes
differently). Logged here + should join Known issues.

### Design provenance

`docs/reviews/refactor-2026-07/phase2-room-client-design.md` (my draft) →
Sol adversarial critique (gpt-5.6-sol, high effort) → this implementation.
Transports implemented by Terra (gpt-5.6-terra) against the spec'd
Transport interface, then hand-revised (typed TransportError, wedge guard,
requestId passthrough).

---

## Phase 1 (server recovery + services) — shipped same night

### Codex review findings on Phase 1, all seven fixed before deploy

1. **High** — snapshot memoization would have let `sessionInSnapshot()`
   authorize grants/replies against up-to-2s-stale data (grant to a
   just-killed session = re-billable). Fixed: authorization uses a fresh
   `buildPanelSnapshotFresh()`; memoization stays for presentation paths
   (WS broadcast, SSE, /snapshot). kill_team also invalidates before its
   immediate broadcast.
2. **High** — dead-holder lock takeover (unlink + wx) raced: two reclaimers
   could both win. Fixed with atomic rename-quarantine (`takeoverStale`) in
   BOTH `acquireLock` and `claimProcessing` — only one rename succeeds.
   (The claimProcessing race predates this refactor; fixed while there.)
3. **Medium** — drainQueue lost-wakeup race could strand a file pushed in
   the window between loop-exit and `processing = false`. Fixed with a
   recheck after the flag drop.
4. **Medium** — new dir indexes had accidentally become case-insensitive vs
   the old `endsWith` match. Reverted to exact case semantics.
5. **Medium** — transcript "8MB bound" still read whole files. Fixed with a
   real fd tail read (`readSync` at offset).
6. **Low** — retention pruned ALL files, old script only `*.json`; keep=0
   semantics differed. Matched old behavior.
7. **Low** — `knownDirs()` leaked its memoized array. Returns a copy now.

### Decisions I made without asking (review in the morning)

- **Deployed `tts-server.sh` via direct copy instead of running full
  `setup.sh`** (twice tonight). Reason: setup.sh still contained the
  ElevenLabs voice/SFX refresh (now split out) and rm-rf's the installed
  server; targeted copy was the credit-safe minimal deploy. Next full
  `setup.sh` run is safe now that the refresh is opt-in.
- **`--refresh-voices` flag name** for the opt-in ElevenLabs refresh in
  setup.sh (spec only said "opt-in command").
- **Snapshot staleness budget**: memoized snapshot TTL 2s, catalog scans
  5s, log rotation threshold 5MB, single-slot `.1` rotation (no gzip
  chain). All judgment calls, all trivially tunable in
  `maintenance.ts` / `state-watch.ts` / `session-catalog.ts`.
- **`failed_retention_count` config default 50** (new key, mirrors
  played_retention_count).
- **Fail-loud sync is direct rsync, not stage-then-swap**: the daemon is
  always stopped during sync (start-only path), so a staging dir + atomic
  swap adds ceremony without a real crash window. Spec said
  "stage-then-swap"; I judged direct-with-abort equivalent here. Cheap to
  revisit if you disagree.
- **Observation, no action taken**: 5 of the 7 recovered queue files belong
  to long-dead sessions with no state file — they now sit visible to grant
  scripts but card-less in both UIs (before tonight they were stranded
  invisibly, so nothing got worse). A follow-up could age queue items for
  sessions absent from state/ into failed/ after N days. Left alone: queue
  admission policy is credit-sensitive and deserves an awake owner.
  **You may want to just delete those 5 old files by hand** — they live in
  `~/.cursor/tts/queue/`. Reviewed contents (all are end-of-session recaps
  from closed sessions; nothing in them that isn't already in memory/docs):
  - `1784133751-893-cc-67ed12f4-bb2.json` (Jul 15) — "memories written"
    recap (Session Token Hygiene save).
  - `1784137293-367-cc-37b927a9-341.json` (Jul 15) — answer on keeping the
    codex skills.
  - `1784137523-068-cc-2844ae19-4b2.json` (Jul 15) — chrome-devtools MCP
    double-registration finding.
  - `1784176161-438-cc-a13b9dab-05b.json` (Jul 15) — "safe to /clear"
    recap of Pending Next Session (Tailscale round).
  - `1784496950-866-cc-d2dd62e5-b81.json` (Jul 19) — throwaway "did you
    mean /login?" reply.

  Delete with:
  `rm ~/.cursor/tts/queue/{1784133751,1784137293,1784137523,1784176161,1784496950}*.json`

  The other two queue files are the LIVE raised hands (jellyfin 97921813,
  agent-usage-bar 75a33b56) — keep those.

### Phase 0: codex review findings, all fixed before deploy (fb2e845)

Not really "decisions" — codex found them, I verified and fixed all four:

1. **High** — fresh `setup.sh` install would copy the repo's
   `tts-server/src/protocol` symlink into the install where it dangles.
   Fixed: setup.sh replaces it with staged real files + drops copied
   node_modules; tts-server.sh sync also defensively un-symlinks.
2. **Medium** — invalid envelope values (`requestId: 123`,
   `source: "bogus"`) would have been silently stripped, accepting messages
   the old server rejected. Fixed: only schema-valid envelope fields are
   stripped; invalid ones stay on the body → `bad_message` as before.
3. **Medium** — schema allowed empty `requestId` while the server treated
   `""` as absent. Fixed: schema now requires non-empty (minLength 1).
4. **Low** — `cp -R` fallback in the sync didn't mirror `rsync --delete`.
   Fixed: fallback now clears the target dir first.

## Phase 5 chunks A+B (2026-07-22 night, fresh session)

Build spec: `phase5-mobile-design.md`. Chunk A (mock harness) authored by
codex/Terra, chunk B (SPA scaffold + /app serving) by grok-4.5 in a
worktree; fable reviewed both diffs. Judgment calls:

1. **Mock transcripts live at `~/.claude/projects/mock-live-harness/<id>.jsonl`**
   — mirrors how the tailer resolves transcripts by session id, so the
   REAL installed tailer tails the fake session (proven live: `live.on`
   stayed true in the snapshot). Cleanup removes them.
2. **`mock-live.ts final` refuses a second call per session.** A second
   assistant-final would flush the held first one through the real tailer
   → real synthesis. One held final is free and exercises the hold-one
   buffer; the refusal keeps the harness zero-spend by construction.
3. **Harness `stream` takes the real `.stream-lock`** (wx, PID-checked
   release in `finally`) and refuses fresh non-mock now-playing frames —
   verification-hygiene rule enforced in code, not convention.
4. **SPA dev route is `/app`** (base `/app/`, hashed assets under
   `/app/assets/` immutable, index no-cache). Cutover later flips `/` to
   the dist and keeps `/legacy` → mobile.html for one release.
5. **Tailwind preflight ON for @room/mobile only** — React owns the whole
   mobile shell, no legacy CSS coexists there. Shared `@room/ui/tailwind.css`
   still omits preflight (panel constraint).
6. **Known smell carried to chunk C:** `StateBadge` depends on host
   `.badge`/`.state-*` CSS; grok duplicated those rules into the mobile
   stylesheet. Move them into `@room/ui` when chunk C builds the real
   room view.
7. `dist/` is globally gitignored; committed-dist policy implemented via
   `!packages/mobile/dist/` + `!packages/mobile/dist/**`.

## Phase 5 chunk C (2026-07-22 night, fresh session)

Room + picker views on shared components (`packages/mobile/src/**` +
one additive `@room/ui` CSS export). Zero synthesis, no daemon touched.
Judgment calls:

1. **Chunk-B smell #6 resolved: leaf-component host CSS moved to
   `@room/ui/src/components.css`** (`.badge`/`.state-*` + `.chip`
   variants + `.queued-preview` + `.live-dot`, both keyframes). New
   opt-in export `@room/ui/components.css`; mobile imports it, the
   panel does NOT (it still ships an identical copy inside `style.css`
   — importing there would double-apply). `--muted` referenced with a
   `var(--muted, var(--room-muted))` fallback so the file is
   self-sufficient; mobile also keeps the `--muted` alias.
2. **"Catch up" is omitted from the overflow menu, not stubbed.** In
   mobile.html mi-catchup posts NOTHING to the server — it drives
   client-side playback of unheard replay clips, which is the chunk-D
   audio/replay layer. Per the phase rule (actions whose target doesn't
   exist yet are omitted, not disabled), the overflow menu ships with
   Hold room only; the dropdown is the seam where chunk D re-adds Catch
   up. Hold room is fully wired (toggle → `hold_room`, label from
   `selectRoomHeld`).
3. **Phone-grant works but there's no phone player yet.** Granting with
   the device toggle on "phone" sends `output:"phone"` (daemon streams
   to /live-audio and the snapshot shows the "on phone" chip), but the
   mobile.html `primeAudio()`/player is deferred to chunk D — no audio
   element is unlocked/consumed here. Clean seam, expected.
4. **spawn/resume send `persona` only when one is selected** (matches
   mobile.html exactly; the daemon's mobile handler tolerates its
   absence). The shared `SpawnSessionCommandSchema` marks `persona`
   required, so App casts the payload `as Command`. A picker persona is
   always selected when `/picker` returns a non-empty `personas` list
   (default = first), so the omission only occurs if the daemon returns
   no personas.
5. **Queue count uses the shared `AgentChips`** (renders `raisedCount>0`
   as a number chip) rather than mobile.html's bespoke
   ">1 → 'N queued'" text — per the chunk-C instruction to reuse the
   `@room/ui` leaves. Muted is shown as an extra `.chip` + name
   strike-through.
6. **Launch flags stay device-local localStorage** (`mobile_flag_*`,
   defaults preserved) — daemon-side migration of hidden-devs/output/
   flags is the deferred post-cutover follow-up (owner decision #7),
   not grown here. Hidden-devs key/seed (`mobile_hidden_dev_names_v1`,
   `["job-search-2026"]`) and output key (`mobile_output_device`)
   preserved byte-for-byte for cutover continuity.

## Phase 5 chunk D (2026-07-22 night, fresh session)

Player + replay history + phone-audio adapter (`packages/mobile/src/**`,
additive only). Zero synthesis; no daemon, scripts, mobile.html, or panel
touched. The whole phone audio engine from mobile.html (~1576–3300) ports
behind ONE `src/audio/controller.ts` adapter (framework-free, owns the
`<audio>`, abortable); React talks to it via `src/audio/react.ts` hooks.
Judgment calls:

1. **Speed multiplier is STATIC-only; live streams run at the base rate.**
   `applySpeed()` sets `playbackRate = live ? base : base × speedMult`.
   mobile.html's `applySpeed` applied the multiplier in live mode too
   (its own comment even defended it), but its state comment says
   "phone static playback only (live streams can't sustain >1×)" and the
   phase-5 build directive says live = full rate. I honored the stated
   contract (a corrected divergence from the shipped code, not a copy).
   The speed control is hidden during live anyway, so the only behavioral
   change is: a live stream started while `speedMult>1` now plays at 1×
   base instead of racing the edge. Flag if the owner preferred the old
   racing behavior.
2. **A track ending hides the strip (entry cleared) instead of lingering
   as "last spoken."** mobile.html kept `phoneMeta` after end for the
   expanded player; §B1's contract is "strip hidden when nothing plays,"
   so on natural end (no catch-up continuation) the controller clears and
   the docked mini player disappears. Re-tapping the row in the history
   replays it (fresh `play()`).
3. **Mac↔phone handoff machinery is ported but dormant.** The task lists
   `checkMacToPhoneHandoff` / `playHandoffFile` / `beginMacToPhone` /
   `beginPhoneToMac` / `cancelHandoff` as controller responsibilities, so
   they live in the adapter and `onSnapshot` runs the *detection* half
   every frame. The *initiator* UI (a mac-live transport / "move to this
   phone" button) is chunk E — `beginMacToPhone`/`beginPhoneToMac` have no
   caller yet, so handoff can't be exercised until E wires the buttons.
   Clean seam, no stub.
4. **Docked mini player KEEPS a speed pill; the in-chat playback strip
   (§B1) will not.** These are two different surfaces: the room-screen
   docked player (this chunk, task item 3 explicitly lists speed) vs. the
   chat-view playback strip (§B1, chunk E, explicitly no speed pill). No
   conflict — §B1's no-scrub/no-timestamp/hidden-when-idle principles are
   applied to the docked player; the speed control is the one addition.
5. **A minimal `Toast` surfaces controller notices** ("Mac is speaking —
   stop it first", "No replays yet for X", "Ready — tap to play"). The SPA
   had no toast infra; rather than pull in the `@room/ui` sonner/Radix
   toast (provider + portal for a handful of strings), the controller
   carries a tiny `notice` store and `Toast.tsx` renders it. Swap to the
   shared toast in chunk E if the call view needs richer notifications.
6. **Karaoke stayed mobile-local** (`src/audio/karaoke.ts`, the pure
   half of `karaokeFromAlignment`) rather than extracted to `@room/ui`.
   The design allowed either ("shared `KaraokeLine` if extracted, else
   mobile-local"); only mobile consumes it today, so extraction would be
   speculative. Trivial to promote when the panel's stage layer wants it.
7. **The replay catalog is fetched twice** (App's history list + the
   controller's own enrichment fetch inside grant-pickup / handoff). Kept
   the controller self-contained and delivery-neutral (it doesn't read
   App's React state) at the cost of a second cheap `GET /replay-list`.
   A shared reactive replay store is the obvious consolidation if the
   double-fetch ever matters; it does not for a personal LAN tool.
8. **Grant button recolored per the live-review polish note:** the
   fully-saturated `#3ecf8e` fill became a darker green *surface*
   (`color-mix(accent 18%, surface)` via inline style, since the mix
   needs a runtime CSS var) with accent icon/text/border/focus-ring. The
   disabled "Working…" state keeps the neutral `surface-strong`.

### Chunk D — Sol review round (fix commit)

An independent gpt-5.6-sol review of the chunk-D diff found 6 major + 2
minor concurrency/lifecycle bugs; all 8 fixed, one-adapter design kept.
The unifying change is a single **source generation** (`srcGen`) bumped by
the ONE `setSource()` mutator on every `<audio>.src` change/teardown, which
every awaited `play()` continuation and delayed callback validates.

1. **Stale grant pickup (major).** Pickups now carry a `pickupSeq` token
   (bumped by any new pickup / manual play / Stop) and revalidate the live
   frame after the `fetchReplayList` await (same key, still active,
   still phone-routed, same file). A `handledPhoneKeys` set dedupes by
   `nowPlayingKey` so a transient `nowPlaying=null` → same frame can't
   re-arm; "already loaded this file" now returns regardless of paused
   (killed the paused-is-idle restart).
2. **Overlapping live reconnects (major).** `reconnectLive` is serialized
   behind a `reconnecting` flag; `ended` + the delayed `error` retry + the
   watchdog can no longer double-commit the consumed segment or race src
   swaps. The consumed segment is committed exactly once — and ONLY on an
   actual reconnect/switch, not on the stall path (else a user retry
   double-counts the same anchor). Every src change bumps `srcGen`, so
   stale `error` callbacks are rejected by generation.
3. **Stop didn't invalidate pending work (major).** All teardown/source
   changes go through `setSource`/`clear`, which advance `srcGen` (and
   `pickupSeq`); every awaited `play()` rejection is gen-guarded, so a
   late rejection after Stop can't set pending-tap on an empty player.
4. **resume() bypassed arbitration + paused-finalized live (major).**
   `resume()` now refuses while `isMacLive()`, and when a live clip
   finalized while paused it resumes via the live→static switch at
   `liveBaseSec + currentTime` instead of replaying the stale live URL.
5. **Leaky catch-up cancellation (major).** `stopCatchUp()` now clears the
   queue AND stops the current catch-up clip. New `onFilesRemoved(files)`
   (called by App on Clear and on hide-dev) drops those files from the
   queue and stops the current clip if it was one of them; App computes a
   hidden dev's replay files and forwards them.
6. **Illusory retry bound (major).** Replaced the single reset-on-1s
   counter with a real budget: consecutive-zero-progress (reset on
   progress) + a hard total-reconnect ceiling + a wall-clock ceiling.
   Exhaustion sets `liveStalled` (stops the loop); an explicit user tap
   resets the budget and retries.
7. **Uncoordinated replay refreshes (minor).** `useReplayList` now
   coalesces dirty signals: at most one fetch in flight, one queued rerun;
   serialization means a stale response can never overwrite or
   `pruneToFiles` from a superseded catalog.
8. **Watchdog never disposed (minor).** `audioController.dispose()` is
   called in `main.tsx`'s `beforeunload` alongside `client.dispose()`;
   `dispose()` kills the tick + watchdog intervals, tears down the audio,
   drops listeners, and is idempotent.

## Phase 5 chunk E (2026-07-22 night, fresh session)

Call view + chat/thread + reply composer + phone-audio-adapter handoff
activation (`packages/mobile/src/**` additive; `packages/ui` untouched;
no daemon/scripts/mobile.html/panel touched; zero synthesis). New:
`convo-state.ts` (sheet + live/ack/thread bookkeeping store), `thread.ts`
(`useThread` + replay-match), `drafts.ts` (in-memory per-session drafts),
`dock.ts` (phone/mac dock model + `macOffsetSec`), and components
`ConvoSheet`/`ChatView`/`CallView`/`Composer`/`ThreadBubble`/
`PlaybackStrip`/`PlayerSheet`/`KaraokeLine` (extracted from MiniPlayer).
`api.ts` gains `fetchThread`; the controller gains additive-only helpers.
Judgment calls:

1. **Call↔chat slide follows the WINNING CONCEPT, not §B2's prose.** The
   spec text says both transitions bring the incoming panel "from the
   right"; a single linear track can't do that, and the winning concept
   (`concept-grok.html`) implements the standard push — call is the
   "forward" screen: it enters from the right on go-live and exits right
   on send-a-text; chat slides under it to the left; the back arrow
   reverses. Two absolutely-stacked panels, `translateX` 300ms. Audio is
   unaffected regardless (it lives in the controller singleton, not the
   panels), so the slide never interrupts playback.
2. **Card precedence = legacy ordering (speaking > working > final >
   idle), a deliberate deviation from §B2's literal "speaking > final >
   working".** Legacy put working before final on purpose (comment at
   mobile.html:2444): after a clip ends, the old now-playing frame lingers
   un-ended, so a "final-pending" test also matches a STALE final and
   would freeze the card on the previous message when a new reply starts
   the agent working. A genuinely fresh final auto-plays within ~1s and
   surfaces as the *speaking* card anyway, so nothing is lost; the ordering
   only prevents the stale-final freeze. Flag if the owner wants the strict
   §B2 order.
3. **Live timer origin is snapshot-driven, not optimistic.** `beginLive`
   only zeroes the clip count + shows the call surface; the timer origin
   (`liveStartedAt`) is set when the daemon confirms `live.on` and cleared
   on the on→off transition (which also forces the sheet back to chat,
   matching legacy `if (!liveOn) callViewOpen=false`). This stops the
   sub-second go-live optimism window from being mistaken for a live-off
   transition. Cost: the timer reads 0:00 for that < 1s gap.
4. **Replay-match returns the FIRST match, not the last.** The §B1
   contract is "newest replay with the same sessionId whose rawText starts
   with the first 200 chars". Legacy walked a chrono-ASCENDING list and
   kept the last match; `GET /replay-list` here is NEWEST-FIRST (per
   api.ts + App.newestForAgent), so the first match is the newest.
5. **Handoff surface (item 3): an expanded PlayerSheet off the docked
   player, and the docked player now also surfaces an active MAC clip.**
   Chunk D only surfaced PHONE playback, leaving `beginMacToPhone`
   unreachable. To activate BOTH dormant initiators without rebuilding a
   full Mac transport (scrub/timestamps that §B1 removed), the MiniPlayer
   gained a compact "Playing on Mac · tap to move here" variant; tapping
   either variant opens `PlayerSheet` (primes audio on entry, §B3), whose
   Mac|Phone device row calls `beginPhoneToMac()` / `beginMacToPhone(np,
   meta, macOffsetSec(np))`. `macOffsetSec` mirrors legacy `macElapsedMs`
   (wall × atempo rate, clamped to an alignment/CPS duration estimate).
   The device row keeps NO transport beyond play/pause + speed, honoring
   §B3's classic-player minimalism. Flag if Mac-clip surfacing in the
   mobile dock is unwanted (it's a small additive bar).
6. **Reply-ack phrase clip plays on a SECOND controller element.** The
   composer/go-live gestures `primeAck()` and convo-state plays the routed
   `phoneAck.ackFile` via a dedicated `ackAudio` element inside the
   controller, so the "on it, boss" clip never clobbers a loaded main clip
   (legacy used a standalone `ackAudio` for the same reason). The ack also
   shows as a thread chip + a call-card beat.
7. **Chunk-D follow-ups.** (a) `clear()`/`stop()` now dismiss any residual
   "Ready — tap to play" notice so it can't linger past a Stop.
   (b) `window.__roomAudio` is a frozen read-only handle
   (`playbackRate`/`status`/`src`/`live` getters) backed by controller
   getters that expose primitives only — the instance never leaks, so
   verification tooling can observe the unattached `<audio>` without being
   able to drive it.
