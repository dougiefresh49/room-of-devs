# GPT-5.6 cross-review v3 — the conversational layer

## 1. Three-way agreement

The three reports converge on the important architecture, with differences mostly in how much future-proofing to write into the refactor spec.

### Middle-layer shape

The shared answer is an **in-process, policy-constrained interpreter in the daemon**:

```text
PTT/text input
  -> local STT where applicable
  -> voice.ts rules/aliases as the zero-cost fast path
  -> Gemini flash-tier structured routing on misses or compound requests
  -> validated command plan OR bounded contextual answer OR escalation
  -> shared command service / existing output adapters
```

It is not a general coding agent. It has a registered tool vocabulary, exact session targeting, source-aware authorization, bounded context, and no arbitrary shell tool. Simple rules remain deterministic; the cheap model handles paraphrases, composition, and short read-only Q&A; the heavy coding session receives only work that actually needs coding reasoning or mutation.

All three also agree that TTS is selective. Silent command execution or a cached/local acknowledgement is preferable for routine actions; ElevenLabs character speech is justified for an actual contextual answer. That matters because synthesis, not the interpreter call, is likely to dominate marginal cost.

### Hermes verdict

**Hermes is not the conversational middle layer.** Its design is for goal decomposition, kanban/task state, worker delegation, provider selection, and cross-session orchestration. Putting it in the path of “pause” or “what was that URL?” adds the wrong state model and latency. If the Hermes architecture is adopted later, it becomes an optional downstream actuator for a genuine multi-agent goal, and possibly a context provider. It does not own speech, turn-taking, command authorization, or ordinary room Q&A.

### ElevenLabs verdict

**Do not adopt Speech Engine or Agents as the initial control plane.** The hosted shape becomes interesting only at the full-duplex stage, where realtime STT, VAD, interruption, and audio connection management are the hard problems. It does not replace the daemon’s policy brain, target resolution, transcript access, or command service.

The agreed initial media path is local PTT/Whisper plus current output routing. Character voices already being ElevenLabs voices makes their TTS useful, but does not by itself justify moving microphone audio and turn ownership into their cloud. At the duplex stage, Speech Engine should be measured as one replaceable media adapter against a self-managed option; it should not be preselected or added to the refactor dependencies.

### Memory/database verdict

**This feature does not reopen SQLite now.** A current-session question needs the session transcript, recent room state, and a bounded projection that includes selected tool output. A small per-conversation log or rolling summary may be added later if follow-ups or long sessions prove it necessary. Durable cross-session recall is a distinct requirement; if it becomes frequent and filesystem scans are measurably inadequate, SQLite FTS may be introduced only as a rebuildable derived index. Filesystem IPC, locks, queue admission, credit markers, and hook-visible truth stay file-based.

Claude’s `CLAUDE.md` and auto-memory belong to the coding-agent domain. They may be optional read-only context, but they are not a stable room conversation store. “Write to memory” therefore requires an explicit destination contract: Claude memory, room memory, or both. The interpreter must not silently invent that meaning.

### Refactor compatibility

**The v2 refactor is compatible and should execute first without phase reordering.** Its shared domain command service, protocol package, thin WS and SSE/HTTP transports, daemon services, mobile Vite app, and platform audio adapters are the right seams. No new process, package, database, realtime SDK, or conversational UI should be built during the refactor.

The shared anti-regret items are:

- keep the command service domain-shaped and make it the eventual executor for panel, mobile, rules, and interpreter calls;
- preserve `voice.ts` normalization, aliases, and target resolution as a fast path rather than deleting them as legacy;
- keep protocol unions additive and correlated;
- extract bounded transcript reading from the `/thread` endpoint into a reusable daemon query service;
- keep intent routing out of React and `room-client`;
- keep audio content separate from Mac/phone delivery and preserve the loopback-WS versus token-gated-LAN boundary.

## 2. Disagreements

### How much protocol machinery belongs in the refactor

My report proposed reserving `conversationId`, `turnId`, lifecycle states, cancellation, sequencing, and an internal idempotent `CommandPlan`. Grok argues that additive unions plus the already-planned `requestId`/`CommandResult` are enough now. Fable asks only for a `source` field and a future event member.

I **concede the concrete conversational wire fields**. The spec already plans envelopes, additive `requestId`, and `CommandResult`; adding unused conversation identifiers and lifecycle states in Phase 0 would create speculative contract surface. The minimal present rule should be: envelopes remain discriminated/additive, commands carry an authenticated origin/actor context, and request correlation is preserved. Concrete `turnId`, cancellation, and lifecycle notices should land with the first conversational consumer.

I **hold on the semantic requirement**, but move its timing: full duplex will require abort propagation and generation IDs so late LLM/TTS output cannot speak after cancellation. Compound mutation will require an ordered coordinator with per-step outcomes. Those are Stage-1/Stage-4 implementation requirements, not Phase-0 fields to reserve blindly.

### Whether `voice.ts` should become `services/interpreter.ts` during Phase 1

Fable says Phase 1 should land `voice.ts` “as/behind `services/interpreter.ts`.” Grok says it should eventually route through the shared command layer. My report likewise allowed the migration to follow extraction.

I side with Grok’s timing. The UI refactor should name voice/PTT as a future command-service caller, but it should not create an empty “interpreter” service before the feature exists. `voice.ts` currently combines pure parsing/target resolution with synchronous script execution; Phase 1’s required work is already substantial. The cheap amendment is to ensure the new command service is not panel-shaped and not to delete the grammar. Splitting `RuleRouter` from execution belongs in conversational Stage 1 unless it is trivially necessary to remove the existing dispatcher duplication.

### ElevenLabs: later adapter or categorical rejection

Grok calls Speech Engine/Agents the wrong ownership model and recommends at most an STT-only experiment; Fable calls it possible “stage-3 ears”; I recommend a measured duplex adapter spike.

I hold the less categorical position. For PTT, Grok’s rejection is right: the repo already has local capture, local Whisper, and daemon-to-phone output, so hosted orchestration buys little. For full duplex, however, the cookbook’s interruption and connection management are not merely STT. Rebuilding VAD, streaming cancellation, reconnection, and barge-in reliably has a real engineering cost. The correct verdict is **reject now, compare later**, with LAN/privacy, latency, interruption correctness, and dollars per active hour as explicit measurements. “Never make it the control plane” remains correct: even if chosen for media, authorization and intent stay in the daemon.

### Rolling summary timing

Grok and Fable place a rolling summary/log in an explicit early follow-up stage. My report prefers ephemeral extracted facts first and adds an LLM summary only on measurement.

I hold that a summary is optional, not a default Stage-2 deliverable. Current-session URL recall is better served by a targeted bounded scan of source transcript/tool output than by a lossy summary. A tiny turn log is justified for “and the second one?” continuity; a model-maintained summary is justified only when bounded retrieval demonstrably loses useful context or prompt size grows materially.

### “Write to memory and clear” as two existing actions

Fable describes V0 as producing “two injects”; Grok describes a tool-call sequence of injects/slash prompts. My original report called for an ordered command plan.

The code makes the distinction important. `voice.ts`’s current `clear` action invokes `clear_session_queue.sh`; it does **not** send Claude’s `/clear`. Meanwhile `inject_prompt.sh` has one global `ptt/pending-inject.json`, and its undo window is latest-write-wins. Two ordinary sequential calls can cause the second to replace the first before either commits. Therefore the example cannot be implemented by naively invoking the existing injector twice. Stage 1 needs a first-class, target-scoped plan/coordinator: define whether “clear” means `/clear`, preserve the memory step before session rotation, serialize/acknowledge terminal commands, and expose one confirmation/cancellation unit. This supports my plan requirement, but it does not require putting `CommandPlan` on the public Phase-0 wire.

### Is phone microphone input already present?

Fable says mic capture exists because “phone mic reaches the daemon,” echoing wording in the brief. Grok correctly treats phone mic as future input. The repository is decisive: `ptt.sh` records the Mac microphone with `ffmpeg`; panel/HID can invoke it, while `spec-live-mode-v2.md` explicitly lists voice streaming/PTT as out of scope. `spec-ui-refactor.md` lists mobile PTT in the target inventory, not as a current implementation. Phone **audio output** exists; phone microphone upload/streaming does not. My staged report has the accurate boundary: add mobile hold-to-talk after the Vite cutover.

## 3. Best catches by each of the other two

### Grok-4.5

Grok’s strongest catch is the practical warning that conversation must not tempt the refactor to merge loopback WS and LAN HTTP. The token-gated LAN path is a different capability boundary, not an accidental transport duplication. That deserves explicit preservation when phone-originated interpreted commands become privileged mutations.

Grok also usefully calls out the current `/thread` projection’s weakness for Q&A. Verification shows `transcriptThread()` skips entries with `toolUseResult` or `tool_result` blocks and emits only user/assistant text. A URL printed by a command may therefore be absent even though it is in the source JSONL. The future context service needs bounded, redacted access to selected tool-result text; it should not simply call today’s UI projection and assume completeness.

Finally, Grok’s recommendation to make acknowledgements silent, cached, or local by default is the clearest economic framing. The Gemini router call is tiny; unnecessary ElevenLabs speech can dominate the turn.

### Fable-5

Fable’s best product insight is that PTT is not merely a temporary deficiency. It is also an explicit intent signal, a privacy boundary, and a cost control. V1/V2 can feel conversational without always listening, and full duplex may reasonably never earn its complexity.

Fable also makes the cleanest participant model: the interpreter is another daemon-side producer/participant, not a third UI. That is a useful guardrail against putting conversation state into React or treating the mobile thread as the source of truth.

Its warning not to let Phase-6 cleanup erase PTT/alias plumbing as “SwiftBar-era” is specific and worth retaining. The grammar, aliases, Levenshtein name resolution, and pre-bound arcade session metadata are reusable assets even though their synchronous script executor should eventually disappear.

## 4. Errors or weak recommendations in the other two

### Grok-4.5

1. **The public-WebSocket claim is too categorical.** Grok says the cookbook “requires” a publicly reachable WebSocket and cites ngrok-style setup. The supplied brief establishes a server integration and token endpoint, but a quickstart deployment technique is not enough to prove that every viable Speech Engine integration requires exposing this local daemon directly. The defensible architectural claim is narrower: hosted media introduces an external conversation lifecycle and may require cloud-reachable integration infrastructure, which must be validated during a spike. The LAN/privacy objection stands without overstating the exact topology.

2. **“Buy barge-in later in-house” understates the work.** Cancelling a Gemini promise and stopping playback is only part of barge-in. Correct behavior also needs VAD/endpointing, generation IDs, late-chunk suppression, audio focus arbitration, and reconnection/failure semantics. That engineering burden is precisely why Speech Engine remains a legitimate later adapter candidate.

3. **The cost numbers should remain assumptions, not conclusions.** Grok’s heavy-agent `$0.10–$1+ equivalent`, current Flash-Lite prices, and historical TTS overage may be useful order-of-magnitude planning figures, but they are account/model/plan sensitive. The stable consensus is relative: local STT is zero marginal provider cost, the cheap router is normally sub-cent, optional character TTS is often dominant, and waking a full-context coding agent is materially more expensive and disruptive. Billing should be read from the owner’s actual plans before implementation.

4. **A “Phase 7 optional interpreter facade split” is unnecessary as a spec amendment.** The feature is post-refactor future work. Naming the daemon seam and preserving domain APIs is enough; assigning it to the refactor’s optional legacy-facade phase blurs scopes.

### Fable-5

1. **Current phone mic support is incorrect.** As verified above, the mobile surface currently has text/live playback, while voice streaming/PTT is explicitly backlog. This affects Q1’s “audio is already bidirectional at the edges” claim: output is implemented, Mac/arcade input is implemented, but phone input is only a planned seam.

2. **`/thread` alone cannot answer all transcript questions.** Fable calls the URL example a transcript-service “tail + targeted scan,” which is directionally right, but elsewhere says to factor `/thread` parsing. The existing `/thread` helper deliberately discards tool results. The amendment must say “shared transcript source/parser with separate bounded projections,” not merely reuse the UI-shaped thread result.

3. **“Two injects” is unsafe with today’s injector.** The single latest-write-wins pending record means two normal `inject_prompt.sh` calls are not an ordered plan. It also conflates queue clearing with Claude `/clear`. This is the most important implementation miss in Fable’s V0.

4. **Creating `services/interpreter.ts` in refactor Phase 1 is premature.** The requested work is future-direction insurance. The refactor should expose a domain command surface and transcript query seam; it should not introduce a named service with no consumer or force voice migration into an already broad server phase.

5. **Treating Claude auto-memory as available “for free answers” needs a stronger boundary.** Its location/format is agent-owned and may change; the room should not promise behavior around it. `CLAUDE.md` is stable project instruction context. Auto-memory is, at most, opportunistic read-only context behind an adapter, never authoritative room state.

## 5. Final consensus

### Q1 — Compatibility

Yes. Execute the v2 UI refactor first and keep its phase order. The conversational layer fits as a future in-process daemon service calling the shared command and transcript/query services. Preserve separate transports/security boundaries and route audio through platform adapters. Do not add a conversational package, process, database, SDK, or UI now.

The present seams are limited to a domain-shaped command service, additive/correlated protocol envelopes, an authenticated actor/source context, reusable bounded transcript parsing with distinct UI and interpreter projections, preservation of the voice grammar, and content-neutral phone/Mac audio delivery.

### Q2 — Recommended middle layer

Choose the **staged in-house interpreter**:

1. deterministic `voice.ts` rules and aliases;
2. Gemini flash-tier structured routing for unmatched or compound input;
3. coordinator validation against a small registered action/query vocabulary;
4. shared command service for mutations and bounded transcript service for answers;
5. selective cached/local/ElevenLabs output;
6. escalation to the coding agent only for actual coding work.

Hermes is optional downstream orchestration, never the basic conversation router. ElevenLabs Speech Engine is rejected for PTT stages and retained only as a later full-duplex media candidate. Agents does not become the policy brain.

Per turn, local STT has no provider charge, a bounded Flash-Lite route/answer should normally cost well under a cent, and short ElevenLabs speech costs plan-dependent pennies and is often the dominant component. A silent command can be essentially just the router cost. The real saving versus a heavy-agent turn is avoiding a full-context coding-model wake-up, tool work, latency, and interruption; exact dollar comparisons must use actual account billing at implementation time.

### Q3 — Context and memory

For “what was that remote URL?”, use the selected session’s recent JSONL plus a bounded targeted scan that retains safe tool output; `/thread` remains the conversational UI projection but is not sufficient by itself. Include current room/session metadata and a tiny interpreter turn history for follow-ups. Add extracted facts or a rolling summary only after measured need.

Keep durable room memory separate from Claude instructions/auto-memory. Make memory destination an explicit tool argument or owner policy. Do not add SQLite now. Reopen a rebuildable FTS index only when cross-session search is frequent and measured filesystem retrieval is inadequate.

### Q4 — Staged path

| Stage | Deliverable | Unlocks | Refactor dependency |
|---|---|---|---|
| **0 — insurance only** | Domain command service, additive correlated envelopes, reusable transcript source/parser, preserved voice rules | Clean future attachment; no conversational behavior | v2 Phases 0–1, no reordering |
| **1 — PTT intent** | Mac/arcade PTT -> local Whisper -> rules -> Flash-Lite structured route; exact target and source capabilities; first-class ordered coordinator for compound terminal commands | Natural and compound commands without wasting coding-agent turns | Command service; voice becomes a caller; no new UI |
| **2 — contextual Q&A** | Read-only bounded context tools over transcript text, selected/redacted tool results, and room state; short attributed answers | URL/branch/status recall without interrupting Claude | Transcript/query service; optional response notice |
| **3 — continuity** | Small per-conversation filesystem log; extracted facts or summary only on measured need | Follow-ups and longer PTT conversation | Filesystem only |
| **4 — mobile PTT** | Authenticated bounded phone recording/upload into the same router; lifecycle text in call/thread; response through phone audio adapter | Conversational phone flow | Migrated Vite mobile shell and audio adapter |
| **5 — optional duplex spike** | Compare Speech Engine media adapter with self-managed streaming STT/VAD; abort propagation, generation IDs, late-output suppression, audio arbitration | Hands-free turns and true barge-in | Separate post-refactor experiment |
| **6 — optional orchestration/history** | Hermes escalation for real goals; rebuildable SQLite FTS only on measured demand | Multi-agent goals and durable search | Neither is a Jarvis prerequisite |

### Minimal amendments to `docs/spec-ui-refactor.md`

1. Under target invariants, add one paragraph: a future conversational interpreter is an **in-process daemon consumer** of the shared command and transcript/query services; UIs and `room-client` never own intent routing.
2. In Phase 0, state that command/notice envelopes remain additive and correlated, and carry authenticated actor/source context suitable for capability enforcement. Do **not** add concrete conversation/turn schemas yet.
3. In Phase 1, state that the command service is domain-shaped rather than panel-action-shaped and is the eventual execution surface for `voice.ts`/PTT as well as WS and HTTP. Preserve the grammar during cleanup. Do not migrate it or create an interpreter service merely for the refactor.
4. Replace “bounded thread reads” with a reusable bounded transcript source/parser supporting separate safe projections: `/thread` for UI text and a future context projection that can include selected, redacted tool-result text.
5. In the mobile/audio notes, clarify that phone PTT/full duplex are future features and keep the phone output controller content-neutral/abortable. Current phone audio is output-only; mobile mic input must be added later.
6. Add non-blocking future owner decisions: Claude-memory versus room-memory destination; interpreter response policy (silent/local/cached/ElevenLabs); and whether a duplex spike may send microphone audio through ElevenLabs.

No new package, process, database, dependency, phase, or phase reorder is warranted.
