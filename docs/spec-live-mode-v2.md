# Spec v2: call view + chat view redesign, bug fixes (post-owner-test)

Owner tested v1 (2026-07-21): fundamentals work — reply → phone ack → working
→ final auto-plays — but the UI failed review. This round: Sesame-inspired
two-surface redesign + the bugs found in testing. v1 spec: spec-live-mode.md.
Concept round v2 + cross-reviews: docs/mockups/live-mode-v2/.

## Diagnosed bugs (from the owner's test session)

1. **"No intermediates spoke"** — NOT a tailer bug: the tested turn's
   transcript gained zero intermediate text blocks (single final message,
   correctly held for the Stop path). The failure is experiential: live mode
   showed "working…" and dead air. Fix = free display-only activity feed
   (below), not more synthesis.
2. **Mac panel stuck after live session** — panel treats every non-ack,
   un-ended nowPlaying as a stage-taking spotlight with lip-sync; it predates
   `kind:"live"` and phone-routed frames. Live clips seized the panel stage,
   and stop/pause only act on Mac playback, so the stage looked wedged and
   unresponsive. Fix in §C.

## A. Server plumbing (tts-server/src — codex-owned)

### A1. Thread history endpoint — real history for the chat view

`GET /thread/<sessionId>?limit=40` (mobile-http.ts, token-gated like /snapshot):
- Validate sessionId: `/^[0-9a-f-]{8,64}$/i` → else 400. Resolve transcript
  via the live-tail glob helper (export it from live-tail.ts). 404 when no
  transcript. Malformed/truncated JSONL lines: skip silently (same as tailer).
- Single pass over all lines building an array, then slice(-limit). Per line:
  - skip `isSidechain`.
  - `type:"user"`, not tool-result (no `toolUseResult`, no `tool_result`
    blocks), text not starting `<task-notification` → push
    `{ role: "user", text, at }` (string content or text blocks joined;
    cap 2000 chars).
  - `type:"assistant"` with text blocks → push `{ role: "agent", text, at,
    final: false }` per text block (cap 2000).
- **final flag, exact rule**: after the pass, walk the pushed agent items;
  an agent item is `final: true` iff no other agent/tool activity was
  pushed/seen between it and the next `role:"user"` item or EOF. Equivalent
  implementation: mark the LAST agent item before each user item (and before
  EOF) as final. Everything else is an intermediate.
- `at` from the transcript line's `timestamp` field; null if absent.
- Response `{ sessionId, items }`. No caching; the phone fetches on chat
  open and refetches after each SSE final. Delete the localStorage reply
  history code path (client).
- Client merge rule: `/thread` is the single source for history; SSE only
  triggers refetches (no client-side splicing of thread items → no dedup
  problem).

### A2. Live activity feed — display-only, zero credits

- live-tail.ts already parses `tool_use` blocks. Extend the live entry:
  `lastActivity: { label: string, at: string } | null` in live_sessions.json
  (exactly ONE current activity — the UI shows current label + toolCount,
  never a scrolling feed; codex review verdict). Written by the tailer per
  tool_use; skip the write if the label is unchanged within 2s.
- Label = `<ToolName>: <short detail>`; detail preference:
  `input.file_path` basename → `input.description` → `input.command` →
  `input.prompt`/`input.query`; truncate detail to 40 chars, full label cap
  60. Truncation is also the redaction story (labels can carry command
  text; 40 chars, and never any value after an `=` sign — split on `=` and
  keep the left side if the detail is a command).
- **Lifecycle**: cleared (null) on genuine user prompt (turn start), on
  session state → hand_raised (final owns the screen), and by live-off.
- Writes go through the existing atomic tmp+rename helper; the tailer is
  the only writer of this field (daemon-internal, single-threaded).
- state-watch buildSnapshot passes it through in the agent's `live` object
  ({ on, toolCount, lastActivity }). Never synthesized.

### A3. Keep from v1 (do not regress)

Hold-one buffer; live-flag re-reads after waits; stale-skip; 1000-char cap;
30-min silence auto-off; cleanup ends live; ack marker-before-inject;
phrase-audio route; hand_raised drop in reconcile.

## B. Mobile redesign (tts-server/mobile.html — grok-owned)

Two surfaces inside the existing `#expanded` sheet for injectable agents.
The winning concept HTML in docs/mockups/live-mode-v2/ is the visual
reference — match its layout hierarchy, not necessarily pixel-for-pixel.

### B1. Chat view (default surface; replaces v1 convo layout)

- **Compact header row** (one row, ~56px): 40px avatar left, name + status
  dot line beside it, `Go live` pill right, collapse chevron right of it
  (all controls on the right — codex note on grok's far-left collapse). No
  hero avatar, no stacked identity block (v1 failure #1).
- **Thread** from `GET /thread/<sessionId>` (real history, both roles);
  agent bubbles left, user right. Play chips on agent FINAL bubbles only,
  when live is OFF and a replay match exists. Matching contract: newest
  replay entry with same sessionId whose `rawText` starts with the thread
  item's first 200 chars (normalized whitespace); repeated identical
  messages may mis-attach — accepted for a personal tool (the clip content
  is identical anyway). In live mode: no play chips anywhere.
- **Input row** (v1 failure #2): single-line textarea that auto-grows to
  max 4 lines (`rows=1`, height from scrollHeight), inline circular send
  icon button at its right inside one input shell, NO Cancel button. Draft
  persistence and Wispr-Flow-stable rebuild rules unchanged.
- **Playback strip contract** (v1 failure #3): transport hidden entirely
  when no clip is playing. While a clip plays, ONE slim strip above the
  input: ▶/⏸ toggle, a one-line karaoke of the currently-spoken words
  (current word highlighted, line scrolls), and an `×` that stops phone
  playback. No speed pill, no scrub, no timestamps in the strip.
- Ack chips + working row stay in-thread (from v1); the working row shows
  `live.lastActivity.label` + toolCount when present. **Ownership rule
  (grok review)**: when live is ON, the working UI lives ONLY in the call
  view's card — the chat thread (reached via the live pin) shows no
  working row and no activity duplicates.

### B2. Call view (live mode — Sesame-style isolated screen)

- Entered via `Go live` (chat header). **Slide contract (matches the
  owner's Sesame description)**: the call view is the base surface while
  live. Tapping `Send a text` → the CALL slides LEFT off-canvas and the
  CHAT enters from the right; the back arrow reverses it. Go live itself:
  chat slides left, call enters from the right (~300ms transforms).
- Layout (grok's presence + gpt's single card, per codex verdict): name
  chip pinned top-center (small, with the credits chip attached); avatar
  centered upper-third, ~120px rounded square (animation-ready); below it
  ONE content card. **Card precedence** (highest wins, swaps in place):
  1. **speaking** — a clip is playing on the phone for this session:
     karaoke text (dim styling for kind live, full for final).
  2. **final landed, not yet playing** — final text, "auto-playing…" tag.
  3. **working** — `lastActivity.label` + toolCount + pulsing dots.
     ONE current label, no scrolling feed (codex note on grok's monitor
     feel). No extra pills alongside the speaking card.
  4. **idle-in-live** — last final stays with a subtle done state.
- Bottom dock (grok's symmetric version): `End live` hang-up (red-tinted,
  left) · elapsed-live timer (center) · `Send a text` (right). NOTHING
  else — no output/broadcast buttons (codex note on gpt's dock), no
  transport (v1 live failure #1). `End live` first stops phone audio and
  clears live state, THEN slides back to chat.
- While chatting mid-live, a single slim "live pin" strip sits atop the
  chat (back-to-call arrow, tiny name, timer, End) — one row, NOT a second
  identity header (codex note on grok's stacking).
- The <audio> element keeps playing across slides.
- Cost visibility: thin edge glow + the name-chip credits chip
  ("live · N clips") where N = client-counted `kind:"live"` nowPlaying
  frames this turn (reset on each genuine user prompt / reply send). Named
  source: liveClipCounts (client), never derived from toolCount.

### B3. Removed / regression guards

- v1 hero-header, Cancel button, always-on transport: gone.
- Classic player for non-injectable sessions: byte-identical behavior.
- Live entry still primes both audio elements in the tap gesture.

## C. Panel fix (panel/src/main.ts — codex-owned)

- Add `"live"` to the panel's NowPlaying kind union.
- Frames with `kind === "live"` OR `output === "phone"`: never take the
  stage (no spotlight, no lip-sync takeover, no card growth) — same class
  of treatment as "ack". Instead the owning agent's card shows a small
  "on phone" chip while such a frame is active.
- **Chip lifecycle**: visible while the current nowPlaying is an un-ended
  phone frame for that session; cleared when the frame gains `endedAt`, is
  replaced, or goes stale (startedAt older than 5 min — belt for a missed
  clear). Overlap resolution: ack frames keep existing ack handling; a Mac
  frame replacing a phone frame reverts to normal stage rules (nowPlaying
  is single-slot, so last write wins).
- Stage/pending-grant bookkeeping (pendingGrant, spotlightEnterKey,
  summaryKey baselines) must skip phone frames so nothing waits on them or
  wedges.
- Stop button semantics unchanged (Mac playback) — with phone frames off
  the stage there is nothing to appear stuck.

## D. Split of work

- **codex (gpt-5.6)**: §A + §C. Files: tts-server/src/mobile-http.ts,
  live-tail.ts, live-mode.ts, state-watch.ts, panel/src/main.ts (+ its
  style.css if a chip style is needed). Verification: `pnpm exec tsc
  --noEmit` in tts-server/ AND panel/.
- **grok (cursor-agent, worktree)**: §B, mobile.html only. Verification:
  extract inline <script>, `new Function` parse check.
- **fable**: spec, winning-concept selection, merge, integration taste
  pass, end-to-end verification, deploy, commit.

## Out of scope (backlog)

- Image attachments from phone (Claude-mobile-app-style uploads) — owner
  wants next round.
- Voice streaming / push-to-talk; lip-sync animation in call view (the
  layout is animation-ready; assets exist per docs/design-avatar-lipsync.md).

## Verification (no credits)

tsc clean ×2; mobile JS parse; `/thread` endpoint against a real transcript
(read-only) **including a final-flag fixture check**: the last agent item
before each user item (and before EOF) must be final:true, all others
final:false — verify against a transcript with a multi-text-block turn;
tailer dry-run unchanged; panel: fake a `kind:"live"` .now-playing.json and
confirm no spotlight (codex computer-use screenshot); live toggle
round-trip on the idle Karai session.

Concept sources for §B: docs/mockups/live-mode-v2/ — build grok's skeleton
(dock, presence avatar, edge glow, live pin) with gpt's strict single-card
call body and in-shell composer; the B1 playback-strip contract comes from
THIS SPEC (neither concept models the × / karaoke one-liner).
