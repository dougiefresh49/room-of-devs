# Cross-review v3 (grok-4.5)

Read order: `brief-v3.md` → `v3-grok45.md` (mine) → `v3-gpt56.md` → `v3-fable.md`.
Claims below re-checked against `voice.ts`, `mobile-http.ts` `transcriptThread`,
`ptt.sh`, `config.ts` / `gemini.ts`, `docs/spec-ui-refactor.md`,
`docs/design-multi-agent-v2-hermes.md`, `docs/spec-live-mode-v2.md`, and
`docs/ideas-backlog.md`. No daemon/API calls.

---

## 1. Three-way agreement

Shared answer, not a soft average:

| Question | Consensus |
|----------|-----------|
| **Middle-layer shape** | **In-house daemon interpreter**, staged. Rule/grammar fast-path first; Gemini flash-lite (already-paid dependency, repo default `gemini-3.1-flash-lite`) with structured tool/function calling on miss or compound intent; execute only through the shared **command service**; selective spoken answers via existing playback/phone adapters. One daemon process — not a new runtime. |
| **Hermes** | **Wrong frame for this feature.** Hermes is task orchestration (kanban, workers, provider lanes, optional ContextDB). Conversation is I/O + cheap intent + contextual Q&A. Hermes stays a someday **downstream** actuator if ever adopted; it must not own STT, turn-taking, room auth, or “what was that URL?”. Doc itself flags 10–20s+ stacked latency and immature Claude Code worker integration. |
| **ElevenLabs Speech Engine / Agents** | **Not the control plane / not v0.** Local Whisper PTT already exists; phone audio already leaves via `/live-audio/`. Hosted conversation minutes (~$0.08/min public) + cloud mic path fight LAN ownership and replace pay-per-utterance with an open meter. Character voices already being ElevenLabs helps **existing** TTS only. Duplex/VAD/barge-in may justify a **later media-adapter spike**, not adoption of Agents as the policy brain. |
| **Memory / DB** | Mid-task Q&A = **session transcript JSONL + bounded thread/context reads** (+ optional rolling summary / ephemeral facts later). **Does not reopen SQLite** now. Rebuildable FTS only on a measured cross-session search trigger (v2 rule). Queue/locks/hook IPC stay filesystem. Room memory ≠ Claude `CLAUDE.md` / auto-memory — distinct destinations when writing. |
| **Refactor compatibility** | **v2 architecture is the right substrate; execute Phases 0–6 first.** Conversational layer is a future daemon consumer of seams already planned (command service, additive protocol, transcript hygiene, Phase 5 audio adapter). No phase reorder, no new package/app now, no Realtime SDK into `room-client`. |

Also shared: economics win = **not waking the heavy coding agent**; TTS (when spoken) usually dominates cash cost of a Q&A turn; PTT half-duplex is a feature for cost and intent signaling, not merely a temporary limitation.

---

## 2. Disagreements

### 2a. How much protocol/lifecycle insurance to bake into the refactor

- **gpt-5.6** wants versioned envelopes with `conversationId`/`turnId`/`source`/`replyTo`, explicit turn lifecycle (`accepted → … → cancelled`), and an internal `CommandPlan` (ordered steps, stop-on-failure, idempotency key).
- **fable-5** wants mainly a `source` field and additive room for `interpreter_turn` events; lands `voice.ts` behind `services/interpreter.ts` in Phase 1.
- **I** argued additive unions + `requestId`/`CommandResult` (already in Phase 0) and voice as an eventual command-service caller — avoid inventing conversational schemas now.

**Hold (mostly with gpt on substance, with myself on minimalism):** Correlation + cancellation reservation is cheap and real — PTT release / stop / target switch can otherwise leave a late spoken answer. `CommandPlan` as a **daemon-internal** concept for multi-step validated tool sequences is right for “memory then clear”; it should **not** become a Phase 0 wire schema. Fable’s “land interpreter.ts in Phase 1” is early: Phase 1 should extract the **command** service and keep grammar callable; the AI router is post-refactor Stage 1. Document voice/PTT as an intended caller; do not rename the whole pipeline to `interpreter` until Stage 1 ships.

### 2b. Phone mic “already reaches the daemon”

- **fable-5:** “phone mic reaches the daemon” and audio is bidirectional at the edges.
- **gpt-5.6 / I:** phone mic capture is a **future** Stage (mobile hold-to-talk after Vite cutover).

**Hold against fable — code-grounded:** `scripts/ptt.sh` + `voice_ptt.sh` + arcade `hid.ts` are Mac-side capture → local `whisper-cli`. `tts-server/mobile.html` has no `getUserMedia` / `MediaRecorder` / upload path. `docs/spec-live-mode-v2.md` lists “Voice streaming / push-to-talk” as **out of scope (backlog)**. Spec-ui-refactor’s “composer + PTT” under mobile surfaces is a **target shell checklist**, not present behavior. Phone today is primarily an **output** (and typed reply) client. Treating phone mic as already solved understates Stage 3 work.

### 2c. How interpreter answers should be spoken

- **fable-5:** “existing Gemini-rewrite → ElevenLabs pipeline” for acks/answers in character voice.
- **gpt-5.6 / I:** default **silent or cached/`say`** for command turns; short ElevenLabs only for true Q&A; owner TTS policy decision; do not reuse `processWithGemini` / `generateCharacterResponse` contracts.

**Hold against fable:** `gemini.ts` `processWithGemini` and `dynamic-response.ts` are written for **agent-text character rewrite / acknowledgment**, not low-temp structured routing. Running rewrite+ElevenLabs on every interpreter turn double-bills Gemini and burns the expensive meter on confirmations the owner does not need. Character voice for Q&A is a product choice, not the default pipe. gpt’s “don’t reuse those abstractions” is correct.

### 2d. Arcade / targeted PTT vs grammar

- **All** want grammar as fast-path and AI on miss.
- **Code reality** (under-emphasized by fable; gpt preserves target metadata correctly; I understated the bypass): `voice.ts` `route()` **short-circuits** when `opts.target` is set — it `execInject`s the raw transcript and **never** calls `matchGrammar`:

```588:590:tts-server/src/voice.ts
  if (opts.target) {
    return execInject(opts.target, transcript.trim(), !!opts.dryRun);
  }
```

**Hold:** Stage 1 must route **even bound arcade PTT** through normalize → grammar → (else) LLM router, using the bound session as default inject target — not as “skip interpretation.” That is the owner’s arcade waste case. Fable’s V0 “target inference” wording is unsafe; gpt’s “exact target resolution / must not guess among sessions” matches existing ambiguous-name behavior in `voice.ts` and should win.

### 2e. Context stack: rolling summary vs ephemeral fact cache

- **I / fable:** optional rolling summary file under `state/` after long sessions.
- **gpt-5.6:** prefer an **ephemeral structured fact cache** (URLs, branches, ports) derived from JSONL **before** a lossy LLM summary; summary only on measurement.

**Concede to gpt:** for “what was that remote url?”, a small extracted-fact cache with provenance/offsets is cheaper and more reliable than summarizing everything. Summary remains optional Stage 2+. Also agree with gpt (and my own Q3) that `transcriptThread` currently **skips** tool_result / `toolUseResult` lines (`mobile-http.ts` ~195) — URL recall often needs a **separate bounded tool-output projection**, not the UI thread as-is. Fable’s “transcript-service query” is directionally right but underspecifies that gap.

### 2f. How open the door is to Speech Engine later

- **I:** reject as primary; optional STT-only experiment later; barge-in in-house.
- **gpt-5.6:** Stage 4 **spike comparing** Speech Engine vs self-managed VAD/STT against the same `TurnCoordinator`.
- **fable-5:** V3 optional duplex; may never build; PTT may remain forever.

**Merge:** fable’s “may never” + gpt’s “measure then pick adapter” beats my harder line. Still: no Agents-as-brain; no SDK in the refactor dependency table; local PTT remains default.

### 2g. Durable memory deferral

- **fable:** Claude Code memory already covers durable repo facts; room durable memory defer; interpreter may read `CLAUDE.md` + auto-memory.
- **gpt / I:** room vs Claude destinations must be **explicit named tools**; no silent mutation of coding-agent instructions.

**Hold with gpt:** read-only optional background is fine; “write to memory” must not ambiguously edit Claude memory. Fable’s shared-across-models note (same project path) is plausible for Claude Code memory layout but does not make Claude memory the room’s conversational store.

### 2h. Cost sketch numbers

- Model id: repo uses `gemini-3.1-flash-lite` (`config.ts`); gpt correctly refuses to treat 2.5 Flash-Lite published rates as gospel for 3.1; my ~$0.25/$1.50 sketch was likely **too high** for a lite tier.
- gpt’s insight that **TTS dominates** spoken turns and command-only turns can be ~$0 is the useful planning number.
- Heavy-agent comparison: all agree orders-of-magnitude + interruption; gpt’s Opus list-price illustration is clearer than my “$0.10–$1+ equivalent.”

**Concede:** prefer gpt’s framing (LLM ≪ TTS ≪ waking Claude) over precise pennies until billing is read at implement time.

---

## 3. Best catches by the other two that I missed

### From gpt-5.6

1. **`CommandPlan` / ordered multi-step execution with stop-on-failure and confirmation on destructive second steps** — better than my vague “tool-call sequence” for “write to memory and clear.”
2. **Turn lifecycle + cancellation reservation** — necessary so abandoned PTT / stop / disconnect cannot speak later; `CommandResult` alone is insufficient for multi-stage turns.
3. **Separate content from delivery** — typed response with attribution/`interruptible`; audio controller chooses Mac vs phone. Prevents WebRTC/audio URLs leaking into core command schema.
4. **Do not reuse `processWithGemini` / `generateCharacterResponse` as the router abstraction** — explicit and correct.
5. **Ephemeral fact cache before rolling summary** — better URL/branch recall design.
6. **Never shell/grep from the router just because a fact is missing** — escalate to heavy agent (or a separately authorized read-only tool); protects credit guards.
7. **Interpreter answers must not masquerade as coding-agent queue items** — provenance for locks, phone grants, replay, mute, credits.
8. **Honest Gemini pricing caveat** (2.5 rates vs repo’s `gemini-3.1-flash-lite`).

### From fable-5

1. **Phase 6 anti-regret: do not delete PTT/aliases as “SwiftBar-era legacy”** — I listed voice bypass of command service as a regret, but not the cleanup-phase deletion risk. Spec Phase 6 audits scripts; this warning belongs in amendments.
2. **Framing: v2 is the enabling move, not merely “compatible”** — typed command service + additive events make the interpreter a small producer instead of another `spawnSync` island (`voice.ts` today).
3. **PTT as deliberate intent signal / cost control** — stronger product argument against rushing duplex than my “buy barge-in later.”
4. **Named future service in target structure** — one paragraph that prevents routing from landing in `room-client` (I had this; fable’s wording is crisp).
5. **Follow-up continuity** (“and the second one?”) via interpreter exchange log — I focused on session transcript; multi-turn **interpreter** continuity is a distinct tier.

---

## 4. Errors or weak recommendations in the other two

### fable-5 (challenge, not deference)

| Claim | Verdict |
|-------|---------|
| “Phone mic reaches the daemon” / audio already bidirectional | **False for phone input.** Mac PTT + phone **playback**/typed reply exist; phone mic path does not (see §2b). |
| “I found no decision we would regret” | **Too soft.** Material regrets exist: voice remaining a permanent `spawnSync` bypass; freezing envelopes without correlation/cancel; leaving transcript parse private to `mobile-http.ts`; coupling phone-audio to queue-item semantics; Phase 6 deleting PTT. Fable’s own Phase 6 warning contradicts “no regrets.” |
| Route answers through Gemini-rewrite → ElevenLabs by default | **Weak / credit-hostile.** Wrong abstractions; burns ElevenLabs on acks. Prefer silent/cached/`say` + owner TTS policy. |
| V0 “target inference” | **Unsafe.** `voice.ts` already asks “Which one?” on ambiguity; guessing sessions invites wrong injects. Prefer gpt’s exact resolution + clarify. |
| Land `services/interpreter.ts` in Phase 1 of the **UI** refactor | **Premature.** Phase 1 = command + transcript/query hygiene; AI router is Stage 1 after refactor. Grammar can feed the future service without building the LLM router during UI phases. |
| Claude memory “already covers” durable facts → defer room memory casually | **Half-right, under-specified.** Defer durable **cross-session room** store, but keep write destinations explicit; do not treat Claude auto-memory as Jarvis scratchpad. |

### gpt-5.6

| Claim | Verdict |
|-------|---------|
| Four amendments including full correlation/lifecycle field list + `CommandPlan` in Phase 1 | **Slightly heavy for “minimal amendments.”** Substance is right; wire the full conversational field set only as **reservations/comments**, implement `CommandPlan` as daemon-internal when Stage 1 lands — not as refactor blockers. |
| Stage 4 Speech Engine spike as peer of self-managed | **Acceptable** if framed as adapter A/B with ownership cost explicit. Risk: spike culture re-opens Agents SDK during Phase 5 mobile work — must stay **post-refactor, post-PTT-Jarvis**. |
| Cost table using Gemini **2.5** Flash-Lite rates | **Self-flagged correctly**; still easy to misread as repo truth. Prefer “≪1¢ LLM + TTS-dominated” until 3.1 billing is checked. |
| Split into RuleRouter / LlmRouter / ContextProvider / TurnCoordinator | **Good eventual shape**; naming four modules in the refactor spec would invent structure. One future `services/conversation/` (or interpreter) folder is enough in amendments. |

Neither report proposed live synthesis loops, SQLite-for-IPC, or merging WS+SSE — no fight there.

---

## 5. Final consensus (decisive answers to Q1–Q4)

### Q1 — Refactor compatibility

**Yes. Execute v2 first.** Bake only thin seams:

1. Domain **command service** (not UI action-string wrapper); `voice.ts` / PTT become adapters over it (grammar preserved; targeted PTT must stop raw-inject bypass).
2. **Additive** protocol: `requestId` / `CommandResult` / ignorable unknown kinds; reserve `source` + correlation/cancellation **hooks** without implementing conversational UI types.
3. **Reusable bounded transcript/context** API (extract from `mobile-http.ts`); tool-output projection for factual Q&A separate from UI thread stripping.
4. Audio **content vs delivery** split; phone-audio stays adapter-owned; no conversation SDK in `room-client`.
5. Phase 6 must **not** delete PTT/aliases/`voice.ts` as legacy.

Deliberately unbuilt: LLM router, duplex, Hermes, Agents SDK, SQLite, conversation React chrome.

### Q2 — Middle layer

**Pick staged in-house (a).** Hermes = no for this feature (downstream only). ElevenLabs Speech Engine/Agents = not primary; optional duplex **media** spike much later.

Flow:

```text
mic/text → STT adapter (local whisper first)
  → RuleRouter (voice.ts grammar/aliases/floor resolve)
  → else LlmRouter (flash-lite, structured tools, low temp, own logging)
  → TurnCoordinator validates → CommandService / CommandPlan (internal)
       or read-only ContextProvider answer
  → optional speech via playback/phone adapters (provenance ≠ agent queue)
```

**Cost sketch (planning):** STT local ≈ $0; flash-lite intent ≪ $0.01; spoken Q&A dominated by ElevenLabs characters; command-only ≈ free with cached/`say`. Same turn into Fable/Claude = full context wakeup + interrupt — the avoided cost.

### Q3 — Memory

**Filesystem + transcript tailing suffice.** Context pack: session identity + bounded transcript + **safe tool-output slice** + optional ephemeral fact cache; rolling summary later; durable room memory only on explicit remember. **SQLite door stays closed** until measured cross-session search pain. Claude memory readable optionally; writable only via explicit distinct tools.

### Q4 — Staged path + minimal `docs/spec-ui-refactor.md` amendments

| Stage | What | Notes |
|-------|------|-------|
| **0** | Refactor insurance only | Seams above; no user-facing Jarvis |
| **1** | PTT → grammar → flash intent → command service / plans | Fix targeted raw-inject; silent/cached acks |
| **2** | Contextual Q&A + fact cache + short TTS on answers | No heavy-agent wakeup |
| **3** | Mobile hold-to-talk → same pipeline | After Phase 5 Vite; LAN upload |
| **4** | Optional duplex/barge-in adapter spike | Speech Engine **or** local VAD; measure; may never ship |
| **5** | Optional Hermes escalate + FTS | Only after conversation works + measured need |

**Minimal amendments to `docs/spec-ui-refactor.md` (merge of three, cut to necessity):**

1. **Future direction (one short subsection):** conversational interpreter is an in-process daemon service calling the shared command service; UIs never own intent routing; no new package now.
2. **Phase 0 protocol:** envelopes remain additive/versioned; reserve `source` + request/correlation/cancellation fields; do not implement conversational schemas or lifecycle state machines yet.
3. **Phase 1 services:** domain commands + uniform `CommandResult`; plan for `voice.ts`/PTT as callers (migrate execute off parallel `spawnSync`); extract reusable bounded transcript/context reads (incl. future tool-output projection + caching). Daemon-internal ordered multi-command execution is allowed when the feature lands — not a new wire RPC surface in Phase 1.
4. **Phase 5:** phone-audio content/delivery-neutral; mobile PTT/duplex explicitly **future**, not refactor scope.
5. **Phase 6:** PTT / `voice.ts` / aliases are **not** SwiftBar-era deletion candidates.
6. **Future owner decisions (non-blocking):** (a) interpreter TTS policy — silent / `say` / character ElevenLabs; (b) room memory vs Claude memory as separate explicit destinations; (c) whether full duplex may send mic audio to ElevenLabs or must stay local STT.

**Explicit non-amendments:** no phase reorder; no SQLite reopen; no ElevenLabs Agents/Speech Engine in the dependency table; no transport merge; no `packages/conversation`.

---

*Reviewer: grok-4.5 · cross-review of v3-gpt56 + v3-fable · 2026-07-21*
