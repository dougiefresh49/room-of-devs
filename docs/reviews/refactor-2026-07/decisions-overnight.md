# Overnight decisions log — refactor autopilot (2026-07-22)

Owner directive: continue phases hands-off overnight; when an issue or
unknown comes up, triage with codex (gpt-5.6) and grok, make the best
informed guess, and record it HERE for morning review. Newest at top.

Format per entry: **context → options considered → who was consulted →
decision + why → how to reverse if you disagree.**

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

Kick off Phase 2 of the UI refactor.

Context: read docs/spec-ui-refactor.md first — consensus spec, all 8 owner
decisions answered inline; treat them as final. Session memory ("Refactor
Mandate") has current status. Phases 0+1 are SHIPPED and DEPLOYED
(fb2e845, 960c8de): @room/protocol exists (schemas, requestId/
CommandResult on WS, snapshot rev), the daemon has command/transcript
services, memoized snapshots, startup recovery, and fail-loud sync.
Overnight judgment calls are logged in
docs/reviews/refactor-2026-07/decisions-overnight.md — append to it if you
make more.

Phase 2 scope (shared client under the OLD UIs — no visual changes):

1. packages/room-client: framework-free external store over PanelSnapshot
   (@room/protocol types), selectors (selectVisibleAgents,
   selectNowPlaying, selectGrantPending…), typed queries, and command
   sending with requestId/CommandResult correlation (server support
   already live). Grant optimism (the duplicated 25s PENDING_GRANT_MS
   logic) moves in here, implemented once.
2. WsTransport on reconnecting-websocket (backoff+jitter replaces the
   panel's fixed 2s timer) and a revision-aware SSE/HTTP transport
   (drop frames whose rev <= last applied; rev ships in every snapshot).
3. Wire it beneath panel/src/main.ts FIRST: main.ts keeps its renderers
   but consumes the room-client store + transport instead of its raw
   WebSocket handling. Panel is Vite — direct workspace import.
4. Mobile second, and only if it doesn't fight the no-build reality of
   mobile.html: options are serving a small committed room-client bundle
   via mobile-http (owner decision #5 allows committed dist) or deferring
   mobile wiring to Phase 5. Triage with codex/grok, pick, and log the
   decision — don't ask.

Constraints: filesystem IPC and every credit guard untouched (mute-before-
API, dedup, hold-one live buffer, locks, phone grants, mobile allowlist
stays server-authoritative). Verification stays cheap-first: keyless runs,
signal.ts replay, ONE short enqueue_manual.sh poke max after deploy. If
live-mode behavior specifically needs end-to-end cover, use the bounded
paid lane in CLAUDE.md (cheap-model team session, few clips, codex
computer use drives the loop) instead of asking the owner to test.
Behavior parity except the three intended changes: real reconnect backoff,
rev-based stale-frame dropping, single grant-optimism source.

Deploy mechanics: daemon changes via ~/.cursor/tts/scripts/tts-server.sh
restart (fail-loud sync stages packages/protocol; if room-client is
imported by the daemon for any reason — it shouldn't be — stop and
reconsider). Panel changes need pnpm tauri build --debug in panel/ (cargo
from ~/.rustup/toolchains/stable-aarch64-apple-darwin/bin), then
./scripts/setup.sh (safe now — voice/SFX refresh is opt-in), then
relaunch the RUNNING Room.app (setup.sh does not restart it).

Verification gate: pnpm typecheck clean (all packages incl. room-client),
pnpm check-fixtures, panel vite build, live WS checks (requestId round-
trip, legacy untouched, reconnect: kill/restart daemon and watch backoff
reconnect + rev-ordered recovery), codex review of the diff before deploy
(codex-review skill; codex review takes NO custom prompt — use codex
exec), codex-computer-use sanity pass of both UIs after deploy, compare
against docs/reviews/refactor-2026-07/baseline/checklist.md.

Delegation per the FULL CLAUDE.md rubric — use the whole roster, not just
fable+cursor. The owner has ~98% of weekly codex (gpt-5.6) budget free and
wants it leveraged: use Sol (codex -m, flagship tier) as a design partner
on the room-client API (independent proposal or adversarial critique of
yours before you build) and for the deep pre-deploy review; Terra (codex
exec default) can implement well-specced chunks like the transports
(reconnecting-WS wrapper, revision-aware SSE) against the protocol
package. grok/composer via cursor-agent worktrees for mechanical pieces.
Final call on architecture + anything touching credit guards stays with
you in-session, and you own the merge — but codex is heavy-lifting
capacity, not just the reviewer. When Phase 2 is deployed and verified:
commit, update the Refactor Mandate memory and the decisions log, and
stop — Phase 3 (tokens + leaf React islands) is the next session.
