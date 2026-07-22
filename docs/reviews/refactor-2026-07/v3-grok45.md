# Conversational-layer review v3 (grok-4.5)

Answers to brief-v3 Q1–Q4. Grounded in `docs/spec-ui-refactor.md`,
`docs/design-multi-agent-v2-hermes.md`, `docs/spec-live-mode-v2.md`,
`docs/ideas-backlog.md`, and current code under `tts-server/` + `scripts/`.
No daemon/API calls. Web pricing checked for ElevenLabs Agents / Gemini
Flash-Lite / TTS credits (July 2026 public figures).

---

## Q1 — Compatibility with the v2 refactor consensus

**Yes — the agreed architecture already accommodates this layer as a future
addition.** The conversational middle agent is almost entirely a *daemon*
concern that plugs into seams the refactor is already creating. It does not
need a redesign of packages, transports, or the two-window / mobile Vite
shape. Bake a few thin seams now; leave the product unbuilt.

### Seams that matter NOW (cheap insurance)

1. **Command service as the single execution surface (Phase 1 — already
   planned).** Today voice routing (`voice.ts` → `spawnSync` scripts),
   panel WS (`dispatchPanelAction`), and mobile POST `/action` are three
   callers with overlapping action vocabulary (grant / pause / inject /
   mute / set_live / …). The interpreter must become a *fourth caller of
   the same service*, not a fifth parallel script path. Phase 1’s extract
   of a narrow command service from `panel-ws.ts` is exactly the plug
   point. **Do not** leave `voice.ts`’s `executeAction` as a permanent
   spawn island — eventually route grammar hits and AI intents through the
   shared command layer so credit guards, inject markers, and phone-grant
   refuse windows stay one place.

2. **Protocol package: leave envelope room, don’t implement turns.**
   `packages/protocol` should treat command/query/notice unions as
   *extensible* (Valibot variants + unknown-passthrough or a documented
   “additive notice kinds” rule), not a frozen closed set that future
   `interpreter_turn` / `intent_result` / `conversation_notice` frames
   would force a big-bang rewrite to add. Concrete cheap move in Phase 0:
   schema comments + a `Notice` / `CommandResult` shape that already
   carries `requestId` + typed `ok|error` (planned) — enough that a later
   conversational notice is one additive schema, not a protocol redesign.
   **Do not** build conversational UI types or client handlers now.

3. **Audio in/out stays daemon-owned and composable.** Phone streaming
   (`/live-audio/`, phone grants, Mac↔phone handoff) already works as an
   *output* path. Mic capture today is Mac-side (`ptt.sh` → ffmpeg → local
   `whisper-cli` → `voice.ts`). Future phone mic / full-duplex should land
   as another *input adapter* into the same interpreter → command service
   pipeline — not as a second TTS/STT stack inside `room-client` or the
   React shells. Keep the v2 rule: no audio/fetch/WS inside shared UI
   components; phone-audio stays behind an adapter.

4. **`voice.ts` grammar remains the fast-path.** The rule table
   (`matchGrammar`, aliases, floor/injection name resolution) is the right
   zero-LLM path for “pause / go ahead / tell Donnie …”. The AI router
   only runs on unmatched transcripts. Refactor must not delete or bury
   this when extracting commands — preserve it as the first stage of
   `route()`.

5. **Thread / transcript reads stay query-shaped.** `/thread` +
   `findTranscript` / `transcriptThread` already give the interpreter’s
   context plane. Phase 1’s “bounded thread reads” is the right hygiene;
   expose the same helper to an in-process interpreter service later
   instead of re-parsing JSONL ad hoc.

### What stays deliberately unbuilt

- Interpreter service, Gemini tool-calling router, rolling summaries,
  barge-in, phone-mic duplex, Speech Engine / Agents SDK, Hermes wiring.
- Any React “conversation chrome” beyond today’s call/chat surfaces.
- Realtime SDKs (already rejected in v2 dependency posture) — do not sneak
  `@elevenlabs/client` into `room-client` “for later.”

### What we would REGRET from the current plan

| Risk | Why it hurts when this layer arrives |
|------|--------------------------------------|
| **Leaving voice/PTT as a permanent bypass of the command service** | Interpreter + panel + mobile diverge on inject markers, mute checks, phone-grant refuse — double-fire / credit bugs. |
| **Closing protocol unions as exhaustive with no additive notice path** | Conversational turns force a protocol rewrite mid-feature. |
| **Putting STT / conversation state in React or TanStack Query** | Breaks the push-snapshot model; duplicates daemon truth. |
| **Merging loopback WS + LAN HTTP “to simplify conversation”** | Security boundary (token LAN vs localhost) is deliberate; conversation must respect it. |
| **Shipping ElevenLabs Conversational client into the mobile shell during Phase 5** | Couples cutover to a product not chosen; fights LAN ownership. |
| **Reopening SQLite “because Hermes/memory” before a measured trigger** | Wrong reason (see Q2/Q3); dual-write against hook IPC. |

Nothing in the v2 phase order needs reordering for this. Phase 1 command
service + Phase 0 extensible protocol are the only insurance items; both
are compatible with “execute the refactor first.”

---

## Q2 — What IS the middle layer? Recommended shape

### Candidate evaluation

#### (a) In-house interpreter service in the daemon — **best fit**

Shape: STT transcript → **rule fast-path** (`voice.ts` grammar) → on miss,
**Gemini flash-lite** with function/tool calling over the existing action
vocabulary (inject, slash commands as injected prompts, grant/pause/mute/
replay/hold_room, plus a `answer_from_context` tool that reads transcript /
thread / optional summary) → execute via command service → optional short
TTS reply (character voice or `say`) when the turn is Q&A, not a silent
inject.

Why it matches the vision:

- Economics: STT is already local (`whisper-cli` + `ggml-base.en.bin` in
  `ptt.sh`); interpreter LLM is the same `gemini-3.1-flash-lite` the stack
  already pays for (`config.ts` / `gemini.ts`); TTS only when the owner
  needs a spoken answer — not on every inject.
- Does not interrupt the heavy coding agent for “what was that remote
  url?” — middle agent answers from files the daemon already tails.
- Multi-intent (“write to memory and clear”) becomes a tool-call sequence
  of injects / slash prompts, not one fat Claude turn.
- Extends code that exists (`voice.ts`, `live-tail.ts`,
  `transcriptThread`, `dynamic-response.ts` Gemini client patterns) instead
  of importing a new product.

#### (b) Hermes orchestration — **wrong frame for THIS feature**

Hermes (`docs/design-multi-agent-v2-hermes.md`) solves **task
orchestration**: kanban decomposition, multi-tool backends, sub-agent
spawn, cross-session memory search, optional ContextDB. The voice section
there routes arcade STT *into Hermes agents as the coding agents*.

Overlap with Jarvis-middle is superficial (“something hears you and
routes”). Differences that matter:

| Concern | Conversational middle | Hermes |
|---------|----------------------|--------|
| Job | Intent → cheap tools / inject / answer | Goal → kanban → coding workers |
| Latency | Sub-second–few seconds | Doc itself flags 10–20s+ stacked LLM risk |
| State | Transcript + room actions | SQLite kanban + agent sessions |
| Failure mode | Wrong inject / missed alias | Stuck workers, worktree conflicts |

Adopting Hermes *for conversation* would drag kanban DB, Hermes lifecycle
hooks, and provider complexity the room does not need for “pause” and
“what was the URL.” **Keep Hermes as a separate someday orchestration
track** (ideas adjacent to multi-agent vision docs; not in
`ideas-backlog.md` as Jarvis). Do not conflate the two.

Honest overlap: if Hermes ever *is* the agent runtime, its HTTP/CLI becomes
one more **inject target** behind the same interpreter tools — the middle
layer still sits above it.

#### (c) ElevenLabs Speech Engine / Agents — **wrong ownership model**

What it replaces (per cookbook + Agents product):

| Piece | Today | Speech Engine / Agents |
|-------|-------|------------------------|
| Mic capture | Mac `ffmpeg` / future phone mic | Browser → ElevenLabs WebRTC |
| STT | Local whisper-cli | Hosted STT |
| Turn-taking / barge-in | PTT start/stop (none duplex) | Hosted + AbortSignal on barge-in |
| TTS | Existing `streamTTS` / phone stream | Hosted TTS back to browser |
| LLM brain | Would be our daemon | Still our server (`onTranscript`) |

Costs (public July 2026):

- **Agents:** plan-bundled call minutes, then **~$0.08/min** wall-clock
  connection (silence >10s at 5% rate); LLM passthrough extra; text
  messages ~$0.003. Agents minutes are **separate from TTS character
  credits**.
- **Current TTS path:** per-character credits (~1 credit/char for
  Multilingual-class; Creator overage historically ~$0.30 / 1k chars).
  Short answers stay cheap; you are not billed for listening silence.

What breaks the LAN / local-ownership model:

- Cookbook requires a **publicly reachable** WebSocket URL (ngrok in the
  quickstart) and a conversation token endpoint — phone mic already reaches
  the daemon on LAN/Tailscale without that.
- Audio already streams to the phone via `/live-audio/`; routing playback
  through ElevenLabs WebRTC duplicates the phone path and fights Mac
  speaker / grant / lipsync ownership.
- Character voices being ElevenLabs already helps TTS quality on the
  *existing* path; it does **not** argue for hosting STT + turn-taking in
  their cloud for a single-user LAN tool.

Barge-in AbortSignal is the only clear win — buy that later in-house
(cancel in-flight Gemini + stop playback) without taking the whole hosted
pipe.

#### (d) Hybrid / other

**Staged hybrid (recommended):** (a) end-to-end first; optionally later
use ElevenLabs **STT-only** or a better local model if whisper quality
hurts — still daemon-routed. Never make Agents the control plane.
Hermes remains orthogonal.

### Recommendation

**Pick (a), staged:** rule fast-path → flash-lite tool router → command
service → selective TTS. Hermes = no for this feature. Speech Engine /
Agents = reject as primary architecture (optional later STT experiment
only).

### Cost sketch (order-of-magnitude, one conversational turn)

Assumptions: ~15s speech; short owner question; context pack ~4–8k tokens
(thread tail + optional summary); spoken answer ~120 characters when needed.

| Path | STT | Interpreter LLM | TTS / audio | Ballpark total |
|------|-----|-----------------|-------------|----------------|
| **Middle layer (recommended)** | Local whisper ≈ **$0** | Gemini 3.1 Flash-Lite ~$0.25/M in + $1.50/M out → **~$0.001–0.003** | ElevenLabs ~120 chars from plan credits, or ~**$0.03–0.04** at ~$0.30/1k overage | **~$0.00–0.04** (often ≪$0.01 if answer is silent inject / `say`) |
| **Same turn into heavy coding agent** | n/a (typed/injected) | Claude / Fable full turn: large context reread + tools — **orders of magnitude more** in token $ *or* Max-plan usage / latency | Plus normal Gemini rewrite + ElevenLabs for the agent’s spoken reply if it hands up | **$0.10–$1+ equivalent** / multi-second–minute agent work — and it **interrupts** the mid-task agent |
| **ElevenLabs Agents 60s connected call** | included in minute | LLM passthrough extra | included in minute | **~$0.08** + LLM even if most of the minute is “listening,” before silence discount |

The economic win is not “free voice” — it is **not waking the coding agent**
for interpretation and Q&A. That is the whole point.

---

## Q3 — Memory & context for the middle agent

### What “what was that remote url?” needs

Minimum viable context pack (all filesystem / already exist or cheap):

1. **Session transcript JSONL** — `findTranscript` / live-tail already
   resolve and parse it. Source of truth for what was said and tool
   results (URLs often appear in assistant text or command output).
2. **`/thread` rolling view** — same parse, UI-shaped; interpreter should
   call the shared `transcriptThread` helper (or a slightly richer
   `contextPack(sessionId)` that also keeps recent tool_use detail the
   thread endpoint currently strips).
3. **Last N user/agent turns + last activity label** — from live entry /
   snapshot; free.
4. **Optional per-session rolling summary file** — e.g.
   `~/.cursor/tts/state/<id>.summary.json` maintained by the interpreter
   after N turns or on live-off (Gemini flash-lite compress). Not required
   for v0; unlocks long sessions without stuffing 100k tokens into every
   intent call.
5. **Durable cross-session memory** — only if the owner asks “what did we
   decide last week?”; not needed for mid-task URL recall. Prefer a plain
   markdown/JSON memory file under `~/.cursor/tts/` before any DB.

### Does this reopen SQLite?

**No — not yet.** This is not the v2 “measured trigger”
(unbounded searchable history / analytics / scan bottlenecks caching can’t
fix). Transcript tailing + bounded thread reads + optional summary files
suffice for mid-task Q&A at room scale. Revisit SQLite **only** as a
rebuildable FTS index over transcripts if cross-session search becomes a
real daily pain — never for locks, queue, or hook IPC (v2 consensus
stands).

### Claude Code memory vs room memory

| Store | Owner | Role for the middle agent |
|-------|-------|---------------------------|
| **Project `CLAUDE.md` / skills** | Coding agent | Instructions the *heavy* model follows; interpreter may *read* for “what are we supposed to do,” but must not treat it as conversational scratchpad |
| **Claude auto-memory / session memory dirs** | Coding agent | Agent-private; fragile to depend on for room UX; optional read-only if path is stable |
| **Room files** (`state/`, transcripts, optional `*.summary.json`, future `room-memory.md`) | Daemon / interpreter | **Authoritative for Jarvis Q&A** and for “write to memory” intents that mean *room* memory |
| **Hermes MEMORY.md / ContextDB** | Hermes (if adopted) | Orchestration memory — orthogonal |

“Write to memory and clear” should map explicitly: e.g. inject `/memory`
or a prompt that updates Claude memory **and/or** append room-memory —
owner decision later. The interpreter must not silently invent a third
memory store without that decision.

`ideas-backlog.md` has **no** Jarvis / interpreter / Speech Engine entry;
live-mode-v2 lists voice streaming / PTT as out-of-scope backlog. This
feature is new relative to that list — not a duplicate of an existing
backlog item.

---

## Q4 — Phased path + amendments

### Staged path (after UI refactor ships / in parallel only where noted)

| Stage | What | Unlocks | Cost | Needs from refactor |
|-------|------|---------|------|---------------------|
| **v0** | PTT → whisper → `voice.ts` grammar → **on miss** Gemini flash-lite structured intent → existing actions via **command service**; spoken errors via `say` / cached phrases | Multi-intent (“memory + clear”), fewer “Didn’t catch that,” arcade PTT stops wasting injects on raw prose | Flash-lite per unmatched utterance; **no** ElevenLabs unless you choose spoken confirmations | Phase 1 command service; keep grammar; funnel `voice.ts` execute through it |
| **v1** | `answer_from_context` tool: transcriptThread + recent tail; short spoken answer via existing TTS **only for Q&A** | Mid-task questions without waking Claude | +1 flash-lite + small TTS on Q&A turns | Shared transcript helper; mute/lock guards before TTS; credit log line |
| **v2** | Per-session rolling summary file; optional room-memory.md append tool | Long sessions, light cross-turn recall | Occasional summary calls | Still filesystem; no DB |
| **v3** | Phone / call-view mic → same interpreter (HTTP upload or stream to daemon); PTT UX in mobile call dock | Jarvis on the phone without typing | Same as v0/v1 + mobile work | Phase 5 audio adapter; multi-phone owner decision matters |
| **v4** | Full duplex + barge-in (cancel Gemini + stop playback on new speech) | Tony-Stark feel | Higher STT duty cycle; still local STT preferred | Careful interaction with live-tail hold-one + phone grants — **do not** double-bill finals |

Do **not** block Phases 0–6 of the UI refactor on any of this. v0 can
land as a post-Phase-1 server feature once the command service exists.

### Amendments to `docs/spec-ui-refactor.md`

**Mostly: no structural redesign.** Concrete amendments worth adding:

1. **Document the future consumer (non-phase work):** one short subsection
   under Target structure / Invariants — *“Future conversational
   interpreter is an in-process daemon service that calls the shared
   command service; UIs never own intent routing.”* Prevents someone
   “helpfully” putting routing in `room-client`.

2. **Protocol (Phase 0):** note that notice/command unions must remain
   **additive** (reserve room for future conversational notices; do not
   implement them). No new package required.

3. **Services (Phase 1):** when extracting the command service, list
   `voice.ts` / PTT as an intended eventual caller alongside WS and HTTP
   (migration can be lazy, but the service API should not be panel-shaped
   only).

4. **Phase 7 optional:** add `interpreter` (or `intent-router`) beside
   audio/hid facade splits — **only on concrete need after v0**,
   facade-preserving.

5. **Owner decisions — add one optional future decision (not blocking
   refactor):** conversational TTS policy — silent inject vs `say` vs
   character ElevenLabs for interpreter answers (credits!).

6. **Explicit non-amendments:** do **not** reopen SQLite for this; do
   **not** add ElevenLabs Agents SDK to the dependency table; do **not**
   reorder phases; do **not** merge transports; do **not** invent a
   `packages/conversation` app now.

If the spec already implies extensible protocol + shared command service
(it does), the **minimum** amendment is item 1 (one paragraph of future
direction) plus item 5 (owner TTS policy when the feature is scheduled).
Inventing more work would violate the brief.

---

## Bottom line

The v2 refactor is compatible. Bake **command-service unity** and
**additive protocol** only. Build an **in-house flash-lite interpreter**
on top of `voice.ts` + transcripts — **not** Hermes-for-chat, **not**
ElevenLabs Speech Engine as the control plane. Memory stays filesystem +
transcript (+ optional summary). Execute the UI refactor first; Jarvis is
a staged daemon feature afterward.
