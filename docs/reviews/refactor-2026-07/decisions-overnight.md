# Overnight decisions log — refactor autopilot (2026-07-22)

Owner directive: continue phases hands-off overnight; when an issue or
unknown comes up, triage with codex (gpt-5.6) and grok, make the best
informed guess, and record it HERE for morning review. Newest at top.

Format per entry: **context → options considered → who was consulted →
decision + why → how to reverse if you disagree.**

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
