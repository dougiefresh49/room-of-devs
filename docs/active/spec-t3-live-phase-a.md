# Spec: T3 live mode — Phase A (watch/listen live for SDK sessions + live-mute)

Status: ACTIVE (2026-08-15), rev 2 — incorporates Sol + grok plan reviews
(/tmp/review-sol-phase-a.md, /tmp/review-grok-phase-a.md). Built overnight by
delegates against this spec. Phase B (replies into T3 threads) is a separate
spec written after this ships.

## Goal

Sessions started from T3 Code (SDK-harness sessions, `sdk: true` in their room
state card since 2026-08-14) get the live experience on the mobile room page:

1. **Chat sheet** — open chat, see transcript history (server side already
   works; only UI-gated today).
2. **Go live** — hear intermediate narration while the agent works (existing
   live pipeline, gate relaxed).
3. **Live-mute toggle** — watch the response arrive as TEXT with **zero
   automatic Gemini/ElevenLabs spend while muted**: no intermediate synthesis,
   and turn-finals FALL BACK to the normal announce/hand-raise flow (tap to
   play) instead of live auto-streaming. Flippable mid-call. Explicit UX rule:
   a mute flip stops FUTURE clips; a clip already playing finishes (the audio
   controller is deliberately untouched).

Out of scope: replying to SDK sessions (Phase B), panel go-live UI (panel
auto-renders LiveBadge), any team-session behavior change.

## Semantics: the three mute-adjacent concepts (do not conflate)

- `agent.muted` (existing, AgentViewSchema): global agent mute — never speaks.
  Untouched.
- `live.muted` (NEW): live narration muted — watch text, no auto synthesis.
- Turn-finals while live-muted: behave as a NON-live session's finals
  (announce mode, tap-to-play bills on demand as today).

## Contracts

### Protocol (`packages/protocol/src`)

- `AgentViewSchema` (snapshot.ts): add **optional** `sdk?: boolean`
  (additive — deploy-skew rule in snapshot.ts:1-7 requires optional; readers
  default false). Snapshot builder always emits it.
- `AgentLiveSchema` (snapshot.ts): add **optional** `muted?: boolean` and
  **optional** `lastEmitAt?: string | null` (heartbeat for emitted/held
  intermediate text — see live-tail below). Builder always emits both.
- Commands (commands.ts):
  - `set_live` payload gains optional `muted?: boolean` (initial state when
    `on: true`; ignored for off).
  - NEW `set_live_mute`: `{ type: "set_live_mute", sessionId: string,
    muted: boolean }`. Must be added to `COMMAND_TYPES` (fixture coverage
    gate iterates it).
- `packages/protocol/scripts/hand-validate.ts` (the frozen drift oracle —
  NOT daemon code): `set_live` arm currently requires exactly 3 keys
  (~line 231-240) → allow the optional `muted` boolean; add a
  `set_live_mute` arm. Without this `pnpm check-fixtures` fails.
- Fixtures: panel-snapshot.json agents gain `sdk` and a live object with
  `muted`/`lastEmitAt`; commands.json gains `set_live_mute` + a
  `set_live`-with-muted variant; invalid-commands.json gains a bad
  `set_live_mute` (missing/typed-wrong `muted`).
- No changes needed: panel-ws allowlists, room-client senders (generic),
  panel/src consumers (read-only), prototype specimens (fields optional).

### Daemon (`tts-server/src`)

- `live-mode.ts`:
  - `LiveEntry` gains `muted: boolean` and `lastEmitAt: string | null`
    (absent on old files ⇒ false / null on read).
  - `setLiveSession(sessionId, on, opts?: { muted?: boolean })`.
  - NEW `setLiveMuted(sessionId, muted)`: patch preserving all other fields;
    no-op if entry absent.
  - NEW `isLiveMuted(sessionId): boolean` helper (single reader used by
    live-tail + index.ts so semantics can't drift).
- `services/commands.ts`:
  - `set_live` gate (~667): `isTeamSession(sessionId) || isSdkCard(sessionId)`
    (import from `../state.js`); notice text updated. Pass `muted` through.
  - `case "set_live_mute"` → `setLiveMuted`. Add to `MOBILE_ACTION_TYPES`.
  - Note: dispatch gate rejections only emit a notice; /action still returns
    200 (existing contract, do not change) — tests must assert via snapshot,
    not HTTP status.
- `index.ts` (queue consumer — the flip-race + finals gates):
  - Where a live session's items are treated as auto-deliverable (~154-157):
    treat `isLiveMuted(session)` as NOT live for auto-delivery — finals fall
    back to announce mode.
  - Immediately before the Gemini rewrite call (~253-271): for
    `source:"live-cc"` items, if the session is now live-muted (or no longer
    live) → move item to played/ WITHOUT synthesis. This closes the
    queued-before-mute race.
- `state-watch.ts` (~254-275): project `muted` + `lastEmitAt` into
  `agent.live`; add `sdk` from the state card JSON (`=== true`).
- `live-tail.ts`:
  - Emit path (`enqueueIntermediate`, ~99): if live entry `muted` → skip the
    queue write entirely. Keep the existing global `loadMutedSessions()`
    check (separate feature).
  - REGARDLESS of mute, every emit decision (i.e., a point where text WOULD
    be enqueued — after min-length + dedup checks) also stamps
    `lastEmitAt: now` on the live entry via `updateLiveEntry`. This is the
    text-freshness heartbeat: reviews proved text-only intermediates
    otherwise never touch the live entry and muted watch would stall.
  - Hold-one buffer, dedup, Stop-hook final ownership: unchanged.
- `scripts/mock-live.ts`:
  - `up` gains `--sdk`: writes the state card with `sdk: true` and SKIPS the
    team_map entry (mock a T3-style session).
  - Its local LiveEntry literal gains the new fields.
  - `stream` refuses (with a clear message) when the entry is muted (test
    harness honesty: a muted session must not produce live frames even in
    mocks).

### Mobile (`packages/mobile/src`)

- `AgentCard.tsx`: Chat button when `agent.injectable || agent.sdk`.
- `ConvoSheet.tsx`: call-view slide + Go-live affordances likewise. Reply
  composer stays `injectable`-only; for sdk sessions render the hint
  "Replies for T3 sessions come with Phase B — use the T3 app." ALSO gate
  CallView's dock "Send a text" affordance to `injectable` (review finding:
  otherwise sdk call view shows a functional-looking control that slides to
  a composer that can't send).
- Mute toggle UI:
  - `ChatView.tsx` header (next to Go live/End live) and `CallView.tsx` dock:
    speaker on/off button dispatching `set_live_mute`.
  - Optimistic + serialized: reuse the `beginLiveTransition`-style pending
    guard — while a mute request is in flight, the button is disabled and
    shows the target state; state reconciles from the next snapshot. (Review
    finding: rapid taps double-send otherwise.)
  - When muted, CallView center card shows a "watching" treatment (activity
    label + "audio off" hint).
  - Sticky per-session pref (prefs.ts, localStorage) records the last USER
    INTENT (set at dispatch time, not snapshot ack); used as the initial
    `muted` when going live. Default unmuted.
- Live text freshness (`convo-state.ts` — implement inside `onSnapshot`,
  which receives the full PanelSnapshot; `useConvo`'s ConvoSnapshot does NOT
  carry live fields, review finding):
  - While the sheet is open on session S and S's `live.on`: when
    `live.lastEmitAt`, `live.lastActivity?.at`, `live.toolCount`, or
    `agent.state` changes → bump `threadRev`, throttled with TRAILING
    coalescing: if >2.5s since last bump, bump now; else arm a single
    trailing timer for the window end. Never drop the last change. Keep the
    existing immediate final-frame trigger.
- `ChatView.tsx`: keep the working row visible while live-muted (today it
  hides when liveOn; hide only when unmuted, karaoke covers it then).
- Naming care: `agent.muted` (global) vs `agent.live.muted` (live narration)
  — do not cross the streams.
- `audio/controller.ts`: NO changes.

### Explicitly unchanged (credit guard)

Ingest/Stop-hook path structure, double-fire protections, the TTS truncation
caps, the configured Gemini and ElevenLabs model ids, voice config, audio
controller.

## Lane split (parallel worktrees)

- **Lane 1 — daemon+protocol (grok-4.5):** protocol schemas, commands,
  hand-validate.ts, fixtures, live-mode.ts, services/commands.ts, index.ts
  consumer gates, state-watch.ts, live-tail.ts, mock-live.ts.
  Gate: `pnpm check-fixtures`, `tsc --noEmit` (tts-server), `pnpm run
  check-live-fixtures`, `bash -n` on any touched shell scripts (none
  expected).
- **Lane 2 — mobile UI (composer-2.5):** AgentCard, ConvoSheet, ChatView,
  CallView, convo-state, prefs. Codes against the contract shapes above
  (protocol optional fields mean existing types compile; where the new
  fields are missing from its worktree's protocol types, read via safe
  optional access and narrow locally).
  Gate: `tsc --noEmit` for packages/mobile.
- Merge order: Lane 1 → Lane 2. Integrator (main session): resolve, full
  `pnpm typecheck` + `pnpm check-fixtures` + `pnpm run check-live-fixtures`,
  `pnpm --filter @room/mobile build`, deploy `tts-server.sh restart`,
  re-run `setup.sh` only if scripts changed (none expected).

## Test plan

Free lane (must pass before any paid call):
1. `pnpm check-fixtures`, `pnpm typecheck`, `pnpm run check-live-fixtures`.
2. Mock harness: `mock-live.ts up` (team) — unmuted live streams cached clip
   as today; snapshot carries `live.muted:false` + `lastEmitAt`.
3. `mock-live.ts up --sdk` — snapshot agent has `sdk:true`, no team entry;
   `set_live` via mobile `/action` accepted (assert via snapshot live!=null,
   NOT http status); plain non-team non-sdk card stays live-off after
   set_live attempt (assert snapshot + notice).
4. Muted zero-spend proof: seed fake sdk card + fake transcript; set_live
   muted; append intermediate-shaped entries (text + tool_use + tool_result)
   to the fake transcript; assert: NO new queue file, NO gemini/elevenlabs
   lines in server log, live entry `lastEmitAt` updates, `/thread` returns
   the text. Then flip unmute via set_live_mute and confirm entry patch
   preserved `toolCount`.
5. Queued-before-mute race: with session live UNmuted, hand-write a
   `source:"live-cc"` queue file (fake, tiny) while the daemon is stopped,
   set the entry muted, start the daemon: on processing, item moves to
   played/ with no synthesis (log line present).
6. Browser round (codex computer use; chrome-devtools MCP fallback): real
   mobile page — sdk agent shows Chat; open sheet; go live muted; watch text
   arrive (mock or real T3 session); toggle unmute/mute (button serializes);
   CallView shows watching treatment; no "Send a text" for sdk; end live.
   Screenshots as evidence.
7. Real-session sanity: enable live (muted) on the owner's real T3 session
   card; confirm zero queue writes + zero gemini log lines while it works.

Paid lane (owner pre-approved, ≤3 ElevenLabs syntheses): one real unmuted
live intermediate through the actual pipeline — use a cheap-model team
session (mock-live cannot exercise synthesis; review finding) — confirm
audio streams to phone with new fields present, then mute mid-call and
confirm the next intermediate does NOT synthesize.

## Risks / notes

- SDK cards survive dead PIDs 12h (by design); the tailer's silence auto-off
  (30 min) — not process death — is what ends live on a torn-down T3 session.
  Acceptable: live chip may linger up to ~30 min after T3 reaps the process.
- Old live_sessions.json entries lack new fields → read defaults.
- `set_live_mute` for a non-live session: silent no-op.
- /action returns 200 even for gate-rejected set_live (existing contract).
