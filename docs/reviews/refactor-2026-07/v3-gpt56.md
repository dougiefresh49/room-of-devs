# GPT-5.6 review v3 — the conversational layer

## Q1 — Compatibility with the v2 refactor consensus

**Verdict: yes.** The v2 architecture is a good substrate for this feature, and the refactor should still execute first. The important seam is already in the plan: WS and SSE/HTTP are thin transports over one daemon command service. A future interpreter belongs beside that service and invokes the same typed commands; it must not inject itself into React components, `RoomClient`, `panel-ws.ts`, or the audio implementation.

The intended flow is:

```text
mic/text input -> STT adapter -> conversational router -> command/query service
                                      |                    |       |
                                      |                    |       +-> transcript/context read
                                      |                    +-> existing deterministic actions
                                      +-> direct conversational answer -> speech/output adapter
```

This composes with the present code rather than replacing it:

- `ptt.sh` already produces a transcript, and `voice.ts` already normalizes it, applies aliases, resolves targets, and maps a safe action vocabulary. The rule parser should remain the zero-LLM fast path. An unmatched or composition-like utterance can fall through to an AI router.
- Arcade PTT already binds a character to a session through `hid.ts -> ptt.sh start|stop <sessionId>`. Preserve that target metadata when calling the router. Targetless phone/Raycast input needs an explicit active-session/room target or clarification; the model must not guess among sessions.
- `live-tail.ts` already knows how to find and incrementally parse Claude transcript JSONL, while `/thread` already builds a bounded conversational projection. Extracting a read-only transcript/context service during the server-service work avoids a second parser later.
- The existing audio path and phone `/live-audio/` path remain output adapters. Interpreter answers should enter playback with explicit provenance and session attribution, not masquerade as coding-agent queue items. This preserves locks, phone ownership, replay metadata, mute behavior, and credit guards.

### Cheap insurance to bake in now

1. **Keep the Phase 1 command extraction domain-level.** Define commands as data and return a uniform `CommandResult`; do not expose shell script names as the public protocol. The future router should call `CommandService.execute(command, actor/context)` exactly as WS/HTTP do. `voice.ts` should eventually become another adapter over this service rather than retaining a parallel `spawnSync` dispatcher.
2. **Make multi-action execution explicit.** The owner's “write to memory and clear the session” is an ordered plan, not one opaque prompt. Reserve a daemon-internal `CommandPlan` with ordered steps, per-step results, stop-on-failure behavior, and a plan-level idempotency key. Do not expose arbitrary shell execution. Initially allow only a small registered tool vocabulary.
3. **Use a versioned extensible envelope in `packages/protocol`.** Reserve `requestId`, `conversationId`, `turnId`, `sessionId`, `source` (`text | ptt | phone | arcade`), `kind`, `timestamp`, and optional `replyTo`/`sequence`. Add discriminated event kinds later rather than a bag of optional conversational fields. Unknown kinds must be ignorable. This is reservation, not implementation.
4. **Reserve cancellation and lifecycle semantics.** Conversational work needs `accepted -> interpreting -> executing/responding -> completed|failed|cancelled`, plus a cancellation key/abort signal. This matters even before full duplex: releasing PTT, pressing stop, switching target, or client disconnect should not leave a stale answer that speaks later. `CommandResult` alone is insufficient for a multi-stage turn.
5. **Separate content from delivery.** A typed response should carry text, attribution, `interruptible`, and output intent; an audio controller decides Mac vs phone and acquires the existing playback/phone grant. Do not put audio URLs or WebRTC assumptions into the core command schema.
6. **Keep transcript reads bounded and centralized.** Phase 1 already calls for bounded thread reads. Make the parser/query reusable by `/thread` and a future context provider, with byte/item limits, redaction of tool payloads/secrets, and no sidechain chatter by default.
7. **Retain the LAN security boundary.** A phone-originated interpreter request is a privileged command request. It goes through the existing token gate and server-authoritative mobile capability policy. Conversational phrasing must never broaden what mobile is allowed to execute.

### What should remain deliberately unbuilt

No streaming STT, VAD, barge-in, hosted conversation SDK, durable semantic memory, Hermes integration, always-listening mic, or conversational React UI belongs in the refactor. Do not add a new process: the v2 “one daemon, shared services” decision remains right. Do not force WS and SSE into one transport; full-duplex audio can later use its own endpoint while control/state continue through the existing boundaries.

### Likely regrets if left unchanged

The only material regrets would be (a) extracting a command service that merely wraps current UI action strings rather than defining domain commands; (b) freezing envelopes as only snapshot/one-shot command shapes with no correlation or cancellation; (c) letting `/thread` remain a private parser inside `mobile-http.ts`; or (d) coupling the mobile phone-audio controller directly to queue-item semantics. None requires building the feature now.

## Q2 — What is the middle layer?

It is a **small, policy-constrained conversational router in the daemon**, not a new coding agent and not primarily a speech engine. Its job is to classify a turn into one of three outcomes:

1. deterministic command or ordered command plan;
2. read-only contextual answer from bounded room/session context;
3. prompt to the heavy coding agent because the request requires code reasoning, mutation, or judgment outside the router's authority.

### Candidate A: in-house daemon interpreter

This is the best fit. It reuses the already-paid Gemini dependency, local Whisper PTT, action vocabulary, session resolution, transcript files, playback routing, and mobile authentication. `voice.ts` provides a strong safety pattern: normalize/alias/rule-match first, ask for clarification on ambiguous targets, and expose only enumerated actions. The AI layer should extend that pattern with structured output/function calling, never free-form script selection.

I would split the eventual service into four narrow pieces: `RuleRouter`, `LlmRouter`, `ContextProvider`, and `TurnCoordinator`. The LLM sees registered tool schemas and a bounded context bundle. The coordinator validates every returned tool call, enforces source capabilities and confirmation policy, executes ordered steps, and formats a short result. “What was that remote URL?” is a read-only answer; “write to memory and clear” is a two-step plan, with the destructive/session-terminal second step requiring exact target resolution and preferably a concise spoken/visual confirmation until the grammar proves reliable.

Do not reuse `processWithGemini()` or `generateCharacterResponse()` as the abstraction. They demonstrate client/model plumbing, but their prompts and output contracts are for spoken rewriting/acknowledgment. The router needs low temperature, structured schemas, small output caps, timeouts, cancellation, and its own usage logging.

### Candidate B: Hermes

Hermes overlaps at the far side of the boundary, not at the center of this feature. The May design describes task decomposition, kanban state, delegation, provider/tool selection, background workers, searchable cross-session memory, and eventual autonomy. Those are useful when the owner says “refactor auth and coordinate the team.” They are unnecessary when the owner says “repeat that URL,” “pause,” or “send these two slash commands.”

Putting Hermes on every conversational turn would add another agent runtime, its kanban/SQLite/session model, provider configuration, and extra latency. The earlier design itself flags 10–20s stacked latency, immature Claude Code worker integration, and dependency/maturity risk. It also explicitly keeps the voice/avatar layer independent. Therefore Hermes should remain a possible **downstream orchestration tool**: the in-house router may later hand a genuine multi-agent goal to Hermes just as it hands a prompt to Claude Code. Hermes should not own STT, turn-taking, room transport, command authorization, or basic contextual Q&A.

This does not reject the Hermes vision; it prevents a conversation feature from prematurely adopting the much larger task-orchestration architecture. If Hermes is later adopted for orchestration, its memory/search can be one context source behind the same `ContextProvider` interface.

### Candidate C: ElevenLabs Speech Engine / Agents

Speech Engine is an integrated media/turn-taking plane: hosted STT, WebSocket conversation connection, VAD/turn detection, interruption signals, and hosted TTS, while this daemon supplies the LLM. It would replace local mic-to-file/Whisper for participating clients, most manual turn-taking, and the current request-at-a-time TTS path for conversational replies. It would not replace command policy, transcript context, session targeting, authentication to room actions, or the coding agent.

Character voices help materially: the desired output voices already live at ElevenLabs, so there is no voice migration. The attraction grows at full duplex, where VAD, low-latency audio streaming, reconnection, and barge-in are the difficult parts. It is much less compelling for v0 PTT, which already works locally and costs $0 for STT.

The trade is ownership and cost. Today phone mic/control reaches the local daemon and phone audio is already streamed by it; Speech Engine routes live microphone audio and transcripts through ElevenLabs and introduces a cloud conversation lifecycle. Internet loss now breaks input as well as synthesis, provider retention/privacy settings matter, and the daemon must issue short-lived tokens rather than exposing an API key. Current public API pricing lists Speech Engine at **$0.08/minute**, Scribe realtime at **$0.39/hour**, batch Scribe at **$0.22/hour**, and TTS v3 at **$0.10/1K characters**; Speech Engine pricing excludes the custom LLM brain's cost. ([ElevenLabs API pricing](https://elevenlabs.io/pricing/api))

### Recommendation: staged hybrid, local brain first

Build Candidate A after the refactor, retaining local Whisper PTT and existing TTS/audio as the first media adapters. Make Speech Engine a later, replaceable full-duplex adapter if real use shows that VAD/barge-in/latency justify its cloud dependency and per-minute charge. Keep Hermes downstream and optional for actual orchestration.

This shape is economically aligned and avoids lock-in on both sides: the command/context policy stays local, while STT/TTS media providers can change. It also gives a useful product before solving realtime audio.

### Concrete cost sketch

Assume one turn contains 8 seconds of user speech, about 2,000 input tokens of recent context/summary, a 100-token router result, and a 500-character (roughly 30-second) spoken answer. These are explicit planning assumptions, not billing guarantees.

| Path | Approximate marginal cost |
|---|---:|
| Local Whisper + Gemini 2.5 Flash-Lite router + ElevenLabs v3 TTS | STT $0 + LLM ~$0.00024 + TTS ~$0.05 = **~$0.050/turn** |
| ElevenLabs batch STT + same router + v3 TTS | STT nominally ~$0.0005 + LLM ~$0.00024 + TTS ~$0.05 = **~$0.051/turn** before any minimum billing granularity |
| Speech Engine + same custom router | At $0.08/min, 38 seconds nominally **~$0.051 + ~$0.00024 LLM**; actual metering/rounding and included-plan allowances must be checked in a spike |

The LLM math uses the published Gemini 2.5 Flash-Lite rate of $0.10/M input and $0.40/M output tokens. The repo currently names `gemini-3.1-flash-lite`; its exact account/model rate should be read from billing before implementation rather than inferred from a different generation. ([Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing))

TTS dominates this example. A command-only turn with a cached acknowledgement can be effectively free; short direct answers should be aggressively concise. Speech Engine can be price-competitive with standalone v3 TTS for long replies, but PTT plus local Whisper retains local ownership and incurs no charge while the user is thinking or silent.

For comparison, waking a frontier coding model re-sends or cache-reads a much larger coding context and invites a full agent turn. At current Claude Opus list prices ($5/M fresh input, $0.50/M cache hits, $25/M output), a 50K-token context plus 500 output tokens is about **$0.26 fresh** or **$0.038 on cache-hit input**, before tools and additional turns. ([Anthropic model price sheet, effective 2026-05-27](https://www-cdn.anthropic.com/files/4zrzovbb/website/3684c2faafb97418665782cea0001f439f74b1d2.pdf)) The owner's actual Claude subscription makes this quota/opportunity cost rather than necessarily a per-turn invoice, but the ratio remains the point: a sub-mill LLM routing call avoids spending a heavy-model wakeup on conversational retrieval. For a spoken answer, ElevenLabs—not the interpreter—is usually the cash cost.

## Q3 — Memory and context for the middle agent

“What was that remote URL?” does not require general agent memory. It requires accurate recency retrieval over the current session, with provenance.

The initial context stack should be:

1. **Current-turn/session identity:** target session, project/cwd, persona, live state, and recent room actions.
2. **Bounded recent transcript projection:** reuse a centralized version of `transcriptThread()`, which already filters sidechains and tool results and marks conversational finals. For factual lookup, also allow a safe extractor over recent tool-result text because the URL may only appear in command output; the mobile projection currently omits that. Tool inputs/results must be redacted and tightly byte-bounded before reaching Gemini.
3. **Small structured fact cache:** maintain ephemeral per-session facts such as URLs, branch names, file paths, ports, and decisions, each with source timestamp/offset. This can be derived incrementally from the same JSONL tail and discarded/rebuilt. It is more reliable and cheaper than asking an LLM to summarize everything.
4. **Rolling summary:** add only after transcript windows become too large or latency measurements demand it. Update on meaningful turn boundaries, not every JSONL line, and retain source offsets so a fact can be checked against raw text. A summary is lossy context, not authority.
5. **Durable cross-session room memory:** only for facts the owner explicitly asks to remember or for a later measured recall need. Store small Markdown/JSON records on the filesystem with provenance, scope, and timestamps. Do not silently turn every conversation into durable memory.

### Does this reopen SQLite?

**Not yet.** One active session, a bounded recent window, and an in-memory fact cache are precisely what filesystem tailing handles well. `/thread` currently rereads and parses the whole JSONL, so the refactor's bounded-thread service should first gain offset/mtime caching and perhaps tail-maintained per-session projections. That is a measured optimization without a database.

The SQLite-as-derived-index door opens if the feature demonstrates one of the v2 triggers: cross-session full-text search over unbounded history, repeated cold scans that remain a bottleneck after caching, or a need to query facts across months. If that occurs, SQLite FTS can index transcripts/facts as a **rebuildable derivative**. JSONL and explicit memory files remain authoritative; queue, locks, billing markers, and hook-visible state remain filesystem IPC. The conversation feature does not justify Hermes's kanban DB, ContextDB, pgvector, or Supabase.

### Claude Code memory versus room memory

`CLAUDE.md` and Claude's auto-memory are instructions/knowledge for the coding agent. The room may read deliberately scoped, non-secret portions as optional background, but it must not edit them implicitly to satisfy “remember that.” The room's memory serves conversation continuity across agents and should be provider-neutral. An explicit command can ask the coding agent to write its own memory, or a separate room-memory tool can write a room record; those are distinct operations and should be named distinctly in the tool schema. This prevents a cheap router from mutating coding-agent instructions under an ambiguous phrase.

## Q4 — Phased path and amendments

### Stage 0 — Refactor insurance only

**Unlocks:** no user-facing conversation yet; ensures the feature fits cleanly later.

**Cost:** tiny additions to protocol/service design, no API spend.

**Needs from refactor:** domain command service, reusable bounded transcript query, extensible correlated envelopes, and cancellation/lifecycle reservation. Execute v2 Phases 0–6 in their agreed order.

### Stage 1 — PTT intent router

Flow: existing local PTT/Whisper -> normalize/aliases/rule fast-path -> Gemini structured intent only on unmatched/composite speech -> validate -> existing command service. Support a deliberately small set: inject prompt, grant/pause/replay/mute, safe queue actions, and registered slash-command plans. Require exact target resolution; confirm terminal/destructive composites; cap steps (for example, three); log plan/result without storing raw audio.

**Unlocks:** natural variants, compound commands, and cheaper arcade/mobile speech without a heavy-agent turn.

**Cost:** usually fractions of a cent for Gemini; $0 STT; cached/silent acknowledgment where possible.

**Needs:** no new UI and no new process. A status/turn notice can travel over the existing transports. Start with arcade/Raycast PTT; mobile microphone capture can follow after the Vite cutover.

### Stage 2 — Contextual sidecar Q&A

Add read-only tools over current session metadata, recent transcript/tool-output projection, replay metadata, and ephemeral extracted facts. The router must cite the source conversationally or visually (“from the last command output…”), answer briefly, and escalate when evidence is absent. It must never run grep or shell merely because a fact was not found; that is a heavy-agent request unless a separately authorized read-only room tool is later added.

**Unlocks:** “what was that URL/branch/file?” and status questions without interrupting Claude.

**Cost:** the router call plus optional short TTS; context is bounded to keep it stable.

**Needs:** centralized transcript service and typed conversational response notices. Add ephemeral fact extraction before a rolling LLM summary; add the summary only on measurement.

### Stage 3 — Mobile conversational turn mode

Add hold-to-talk in the migrated mobile app, using local-daemon upload of a bounded recording first. Stream turn lifecycle and text to the call/thread UI; route response audio through the existing phone audio controller. Add cancel/stop and clear attribution between “room assistant” and the coding persona.

**Unlocks:** actual conversational rhythm on phone while preserving local control and existing output routing.

**Cost:** same as Stages 1–2 plus network/upload latency; no always-on cloud minute meter.

**Needs:** the mobile Vite shell and phone-audio adapter from v2 Phase 5, plus authenticated audio-upload limits. This should follow, not enter, the UI refactor.

### Stage 4 — Full duplex and barge-in spike

Prototype two adapters against the same `TurnCoordinator`: ElevenLabs Speech Engine and, only if worthwhile, self-managed realtime STT/VAD plus current TTS. Measure time to committed transcript, time to first audio, interruption correctness, false turns, network failure behavior, and dollars per hour. Pick Speech Engine if its media quality/reliability earns the loss of local ownership; otherwise retain local capture. Do not adopt ElevenLabs Agents as the policy brain merely because Speech Engine supplies media orchestration.

**Unlocks:** hands-free turn detection, streaming replies, and barge-in cancellation.

**Cost:** Speech Engine currently advertises $0.08/conversation-minute plus the custom LLM; self-managed media costs engineering time and standalone STT/TTS usage.

**Needs:** abort propagation all the way from client/VAD to Gemini and TTS, generation IDs so late chunks are discarded, and an audio arbiter that preserves the existing one-floor/phone-ownership rules.

### Stage 5 — Optional orchestration and durable recall

Only after normal conversation works, allow the router to escalate genuine goals to Hermes if the separate Hermes architecture is adopted. Independently add a rebuildable SQLite FTS index only after measured cross-session search demand.

**Unlocks:** conversational entry into multi-agent work and historical recall.

**Cost:** the complexity already documented in the Hermes design; it is not a prerequisite for Jarvis-like room interaction.

### Concrete amendments to `docs/spec-ui-refactor.md`

I recommend **four narrow amendments**, not a new refactor phase:

1. In `packages/protocol`, state that envelopes are versioned/discriminated and reserve correlation/source fields plus turn lifecycle and cancellation semantics; do not define full conversational schemas yet.
2. In Phase 1 services, define the command service in domain terms, with an internal ordered/idempotent `CommandPlan`, source capability enforcement, and no arbitrary shell tool. Plan to route `voice.ts` through it after extraction so there is one executor.
3. In Phase 1 bounded thread work, extract transcript parsing from `mobile-http.ts` into a reusable read-only transcript/context service, including bounded safe access to selected tool-output text and mtime/offset caching. `/thread` remains one consumer.
4. In Phase 5, keep the phone-audio controller content/delivery-neutral and preserve an abortable input/output adapter seam; explicitly say mobile PTT/full duplex are future features, not refactor scope.

Add two owner decisions to the future-feature list, without blocking v2: (a) whether room memory and Claude memory are separate explicit destinations (recommended: yes), and (b) whether full duplex may send mic audio to ElevenLabs or must preserve local STT. No new package, database, daemon process, or phase is justified now. A future `tts-server/src/services/conversation/` module is sufficient when Stage 1 begins; `packages/protocol` and `room-client` only gain concrete conversational types when there is a consumer.
