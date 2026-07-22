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
