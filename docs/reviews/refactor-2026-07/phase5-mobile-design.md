# Phase 5 — Mobile Vite SPA + Cutover: build design

Status: authored 2026-07-22 (fresh session, post-Phase-4). Parent spec:
`docs/spec-ui-refactor.md` (Phase 5 section + owner decisions, all final).
Live-mode UI contract: `docs/spec-live-mode-v2.md`. Judgment calls made
during this phase append to `decisions-overnight.md`.

## Goal

Replace `tts-server/mobile.html` (4,567-line single file) with a React 19
Vite SPA at `packages/mobile`, served token-authenticated by mobile-http,
built on the shared packages (`@room/protocol`, `@room/room-client`,
`@room/ui`). Phase STARTS with the no-spend live-mode mock harness so live
behavior has regression cover before the call/thread views migrate.

## Standing constraints (every chunk, every delegate)

- **Zero live synthesis.** No Gemini/ElevenLabs calls, ever. Harness and
  all verification use fake sessions, cached replay clips, `live-tail.ts
  once`, `signal.ts replay`. Delegated prompts must state this.
- **Credit guards untouchable:** ingest dedup, mute-before-API, live gates
  + hold-one buffer in `live-tail.ts`, locks/markers in `audio.ts`,
  grant windows, cached-only acks. UI phases never edit these paths.
- **Verification hygiene:** never mutate REAL playback state. Mock
  harness operates only on `mock-`-prefixed fake sessions and must refuse
  to run when real playback is active (fresh non-mock `.now-playing.json`
  or held stream lock).
- Gates for every chunk: `pnpm typecheck` clean at root, `bash -n` on
  changed shell scripts, mobile.html untouched (it is the rollback until
  cutover).
- Filesystem IPC under `~/.cursor/tts/` is the contract — additive changes
  only, nothing renamed/removed.

## Chunk map (file ownership is disjoint; A ∥ B, then C → D → E → cutover)

| Chunk | Owns | Depends on |
| ----- | ---- | ---------- |
| A — mock harness | `tts-server/scripts/mock-live.ts`, `tts-server/fixtures/live/`, `docs/testing-live-mode.md` | nothing |
| B — SPA scaffold + serving | `packages/mobile/*`, `tts-server/src/mobile-http.ts`, `scripts/tts-server.sh`, `.gitignore` | nothing |
| C — room + picker views | `packages/mobile/src/**` (views), possibly new leaves in `packages/ui` | B |
| D — player + replay history | same | C |
| E — call/thread/composer + phone-audio adapter | same | D + A (harness drives verification) |
| Cutover | mobile-http `/` flip, `/legacy` rollback route | E parity pass |

## Chunk A — no-spend live-mode mock harness

New CLI `tts-server/scripts/mock-live.ts` (run:
`pnpm exec tsx scripts/mock-live.ts <cmd>` from `tts-server/`), operating
on `TTS_DIR` (default `~/.cursor/tts`, overridable env for dry testing).

Subcommands:

- `up [name]` — create a fake session (`mock-<ts>` id): `state/<id>.json`
  agent entry (persona optional; gray default avatar is a known non-bug),
  an EMPTY transcript file (proven Phase 4: daemon tailer stays alive on
  empty transcripts, kills live only for transcript-LESS sessions — read
  `live-tail.ts` for how the transcript path is associated), and a
  `live_sessions.json` entry `{on:true, since, toolCount:0,
  turnStartedAt, lastActivity:null}` via the same atomic tmp+rename
  pattern as `live-mode.ts`.
- `activity <id> <label>` — stamp `lastActivity {label, at}` (drives the
  call-view activity line + LIVE chip free).
- `tools <id> <n>` — bump toolCount.
- `stream <id> [--output phone|mac] [--rate 16000]` — simulate a live
  clip with ZERO synthesis: copy a cached `replay/*.mp3` into a fresh
  `replay/<ts>.mp3.part`, append bytes progressively at ~16 kB/s, write
  `.now-playing.json` `{kind:"live", output, replayFile, grantId:
  "mock-…", synthesisComplete:false}`, then on completion rename to
  `.mp3` and finalize the frame. This exercises `/live-audio` chunked
  streaming, the call view, and Mac↔phone handoff for real. MUST refuse
  if a real (non-mock) now-playing frame is fresh or the stream lock is
  held; MUST NOT go through `audio.ts` playback (no ffplay spawn) — it
  fabricates the frame only. Study `audio.ts` now-playing/grant fields
  first and mirror them exactly.
- `final <id> <text>` — append a plausible assistant-final JSONL entry to
  the fake transcript (drives hold-one/turn logic in the REAL tailer with
  zero cost, since nothing queues without the Stop hook).
- `down [id|--all]` — full cleanup: live entry off+removed, state file
  removed, mock replay parts/files removed, `.now-playing.json` cleared
  ONLY if it is a mock frame. `--all` sweeps every `mock-*` artifact.

Fixtures + free regression check:

- `tts-server/fixtures/live/*.jsonl`: 3–4 sanitized transcripts covering
  the tailer's decision space (plain turn, tool-heavy turn, held-final
  flushed by continuation, held-final dropped by user prompt).
- Sidecar `*.expected.txt` per fixture = the exact `live-tail.ts once`
  stdout decisions. `mock-live.ts check-tailer` runs every fixture
  through `once` and diffs against expected — a zero-cost hold-one-buffer
  regression test. Root `package.json` script: `check-live-fixtures`.

Docs: `docs/testing-live-mode.md` — lane 1 (this harness, free), lane 2
(the owner-approved bounded paid smoke: sonnet/haiku team session,
one-sentence prompts, few clips, codex computer-use drives; cite CLAUDE.md
policy). Keep it short and operational.

## Chunk B — SPA scaffold + authenticated static serving

`packages/mobile` (name `@room/mobile`, private):

- Vite + React 19 + `@tailwindcss/vite`, workspace deps `@room/protocol`,
  `@room/room-client`, `@room/ui` (raw-TS resolution like panel — no
  aliases needed). Tailwind entry imports `@room/ui/tailwind.css`;
  preflight MAY be enabled here (React owns this shell; no legacy CSS) —
  delegate decides and logs it.
- `vite.config.ts`: `base: "/app/"`, hashed assets (Vite default), build
  outDir `dist`.
- `src/main.tsx` copies the panel boot order exactly
  (`panel/src/main.tsx`): construct `RoomClient(new SseTransport({}),
  {source:"mobile"})`; subscribe stores BEFORE `client.start()`; start
  LAST. Same-origin SseTransport defaults already match the daemon.
- Scaffold App: connection dot (`selectConnected`), raw visible-agent
  list from `selectVisibleAgents` with `StateBadge` from `@room/ui` —
  just enough to prove snapshot flow + tokens render on a phone.
  No further UI (that's chunk C).
- Commit the built `dist/` (owner decision #5). `.gitignore`: add
  `!packages/mobile/dist/` and `!packages/mobile/dist/**` below the
  global `dist/` rule.

mobile-http.ts:

- New routes, same token/cookie auth as `/`:
  - `GET /app` and `GET /app/` → `dist/index.html`, `Cache-Control:
    no-cache`.
  - `GET /app/assets/<hashed>` → `Cache-Control: public, max-age=31536000,
    immutable`, traversal-safe via existing `safePathUnder`.
  - Extend `contentTypeFor` with `.js`, `.css`, `.svg`, `.woff2`, `.map`.
- Dist root = `$SERVER_DIR/mobile-dist` (sibling of mobile.html in the
  install). **Fail loudly:** if the dist dir is missing at startup, log
  one clear warning and 503 `/app` with a plain-text explanation — never
  silently 404. `/` continues to serve mobile.html unchanged.

scripts/tts-server.sh `sync_source()`:

- Add `rsync -a --delete "$REPO_ROOT/packages/mobile/dist/"
  "$SERVER_DIR/mobile-dist/"`, fatal if the repo dist is missing
  (mirrors the mobile.html gate). Keep the mobile.html `cp` — it is the
  rollback path until cutover completes.

## Chunk C — room + picker (build directly on shared components, no parity clone)

Reference: `panel/src/app/` (RoomView/PickerView/AgentCard) for shape;
`mobile.html` regions for behavior: room grid `renderMembers`/`memberCard`
(~3325–3616), hidden devs (1699–1743, 3509–3553), picker (3822–3900,
4426–4480). Views: room grid of `AgentCard`-family components (reuse
`@room/ui` leaves: StateBadge, AgentChips, QueuedPreview, SummaryText,
LiveBadge), header device toggle + conn dot, hidden-devs section, session
picker sheet (`/picker` via `client.query`, spawn/resume via `request()`).
Grant taps go through `client.grant()` (optimism now shared). Mobile
launch-flag prefs stay localStorage for now; **hidden-devs/listened/output
daemon-side migration is deliberately deferred to a post-cutover follow-up**
(owner decision #7 honored later — don't grow this phase).

## Chunk D — player + replay history

Docked mini player + expanded playback strip per spec-live-mode-v2 §B1;
replay list from `/replay-list`; listened/cleared state (localStorage,
same keys so history survives cutover); speed control (phone static only);
karaoke line via shared `KaraokeLine` if extracted, else mobile-local.
Phone audio engine (`primeAudio`, `playReplayEntry`, live streaming,
handoff, grant pickup — mobile.html 2926–3300) ports behind ONE adapter
module `src/audio/controller.ts`: content/delivery-neutral, abortable,
React talks to it via a tiny store — no `<audio>` juggling inside
components. Parity is proven with cached audio + the chunk-A harness
before anything else consumes it.

## Chunk E — call/thread/composer (last; taste-critical)

Implements spec-live-mode-v2 §B1/§B2 exactly (chat bubbles + play chips on
finals, call view precedence speaking>final>working>idle, slide
transition, activity line, go-live toggle, composer auto-grow + drafts
in-memory). `/thread` remains the single history source; SSE triggers
refetch. Verified end-to-end with the chunk-A harness (fake live session,
mock stream, handoff) — zero synthesis — then ONE bounded paid smoke pass
(lane 2) for final parity.

## Cutover (own commit, after E parity)

`/` serves `dist/index.html` (no-cache); `/legacy` serves mobile.html for
one release; delete `/app` alias or keep as canonical — decide then. QR/
URL helpers unchanged. CLAUDE.md updated in the same change (two-location
section: dist sync replaces raw mobile.html sync).

## Verification plan (batched, per token-hygiene)

Per chunk: typecheck + `bash -n` + `check-live-fixtures` (A+). After B:
deploy via `tts-server.sh restart`, curl `/app` with token (200 + correct
MIME on one asset + 401 without token), confirm SSE snapshot renders in
the scaffold. After C/D/E: one codex computer-use round per chunk with the
complete checklist (phone-viewport Chrome against LAN URL), harness-driven
live checks in E. Baseline: `docs/reviews/refactor-2026-07/baseline/`
mobile items + the not-baselined live list (checklist.md 61–66).
