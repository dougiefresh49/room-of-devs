# Design: The Conversational Layer ("dev in the room")

Status: **future direction, consensus v1** — 2026-07-21. Produced by a
three-model review (gpt-5.6, grok-4.5, fable-5: independent reports + full
cross-exam; see `docs/reviews/refactor-2026-07/v3-*.md`). This feature is
built AFTER the UI refactor (`docs/spec-ui-refactor.md`); that spec carries
the small "insurance" seams this design depends on.

## The vision

Today's live mode is "agent speaks, owner texts a reply." The target is a
real conversation flow: the owner talks to the room and a **lightweight
middle agent** interprets — so "write to memory and clear the session"
becomes an ordered two-command plan, and "what was that remote url?" is
answered from the session transcript in the character's voice, without
waking the heavy coding model or interrupting its turn. Jarvis as *dev in
the room*, not voice-to-code.

**The economic core:** the win is not free voice — it is *not waking the
coding agent*. Local STT ≈ $0, a flash-lite routing call is well under a
cent, a short ElevenLabs answer is plan-dependent pennies (and the dominant
cash cost when spoken); a heavy-model wakeup for the same question is
orders of magnitude more, plus the interruption. PTT half-duplex is a
**feature**: a deliberate button press is the intent signal, the privacy
boundary, and the cost control. Full duplex may reasonably never be built.

## Consensus verdicts

- **Shape: in-house interpreter service, in the daemon.** Not a new
  process, package, or runtime. Rules first, cheap LLM on miss, shared
  command service as the only actuator.
- **Hermes: not this feature.** The Hermes design
  (`design-multi-agent-v2-hermes.md`) solves task orchestration — kanban
  decomposition, worker delegation, provider lanes. Conversation is I/O +
  intent + cheap Q&A. If Hermes is ever adopted, it sits *downstream* as
  one more actuator/context source behind the interpreter; it never owns
  STT, turn-taking, authorization, or "what was that URL?".
- **ElevenLabs Speech Engine / Agents: not the control plane, not v0.**
  Hosted STT/turn-taking/barge-in routes mic audio through their cloud,
  replaces pay-per-utterance with a ~$0.08/min meter, and duplicates paths
  we own (local whisper PTT, `/live-audio/` phone streaming). Its unique
  value (VAD, barge-in, connection management) only matters at full
  duplex — Stage 5's measured adapter spike, never the policy brain, and
  never an SDK in `room-client`.
- **Memory/DB: filesystem + transcript tailing suffice.** No SQLite; the
  v2 measured-trigger rule stands. Claude Code memory is read-only
  opportunistic context, never the room's conversational store.

## Architecture

```
mic/text input (arcade PTT · Raycast PTT · future phone hold-to-talk)
  → STT adapter            local whisper-cli (exists in ptt.sh); hosted STT
                           only as a later quality upgrade, still daemon-routed
  → RuleRouter             voice.ts grammar/aliases/Levenshtein floor+target
                           resolution — zero-cost fast path. Bound-target PTT
                           goes THROUGH this too (today route() short-circuits
                           on opts.target and raw-injects the transcript —
                           that bypass is the arcade-waste bug; the bound
                           session becomes the default target, not a skip).
  → LlmRouter (on miss)    Gemini flash-lite, low temp, structured tool
                           calling over a REGISTERED vocabulary: existing
                           commands, slash-command plans, answer_from_context.
                           NOT processWithGemini/generateCharacterResponse —
                           those are spoken-rewrite contracts; the router
                           gets its own client config, caps, timeout,
                           cancellation, and usage logging.
  → TurnCoordinator        validates every tool call; enforces source
                           capabilities + exact target resolution (clarify on
                           ambiguity — never guess a session); executes via
                           the shared command service; multi-step intents run
                           as a daemon-internal CommandPlan (ordered steps,
                           per-step results, stop-on-failure, idempotency
                           key, confirmation on destructive/terminal steps).
  → reply policy           silent > cached phrase/say > short ElevenLabs
                           character answer (real Q&A only). Interpreter
                           speech carries its own provenance — it never
                           masquerades as a coding-agent queue item, so
                           locks/grants/replay/mute/credit guards stay honest.
                           NOTE: no Gemini-rewrite hop for interpreter turns —
                           the routing call already speaks in character (persona
                           style in the router prompt), so the path is ONE
                           flash call + TTS. TTS itself is an adapter:
                           ElevenLabs character voices now; a local low-latency
                           engine (Kokoro/Piper-class) can later take
                           interpreter turns while agent turn-finals keep
                           ElevenLabs — swapping parts, not architecture.
  → ContextProvider        read-only: session identity + room snapshot +
                           bounded transcript projection + ephemeral fact
                           cache. Never runs grep/shell as a fallback — a
                           missing fact escalates to the heavy agent instead.
```

### Why the "two commands" example needs a plan, not two injects

`inject_prompt.sh` keeps ONE global latest-write-wins
`ptt/pending-inject.json` — two sequential injects can clobber each other
before either commits. And "clear" is overloaded: `voice.ts`'s `clear`
action runs `clear_session_queue.sh` (queue hygiene), which is not Claude's
`/clear`. "Write to memory and clear the session" therefore needs the
coordinator: resolve what "clear" means, order memory-write before session
rotation, serialize the injects, confirm the terminal step.

### Context: answering "what was that remote url?"

1. **Session transcript JSONL** is the source of truth — but `/thread`'s
   `transcriptThread()` deliberately strips tool_use/tool_result entries,
   and URLs usually live in command output. The transcript service (built
   in refactor Phase 1) exposes two projections: the UI thread, and a
   bounded, redacted **tool-output projection** for factual Q&A.
2. **Ephemeral fact cache** (before any rolling summary): URLs, branches,
   file paths, ports extracted incrementally from the JSONL tail with
   source offsets. Cheaper and more reliable than LLM summaries.
3. **Interpreter turn log** (per thread, small JSON under
   `~/.cursor/tts/state/`) for follow-ups ("and the second one?").
4. **Rolling LLM summary** only on measured need (long sessions where
   bounded retrieval demonstrably loses context).
5. **Durable memory**: room memory and Claude memory are **separate,
   explicitly named write destinations** — "remember that" must never
   ambiguously mutate CLAUDE.md/auto-memory via a cheap router. (Claude
   Code memory is shared per project path across sessions and models, so
   it's useful *read-only* context — CLAUDE.md especially; auto-memory
   opportunistically, never authoritatively.)
6. **When durable recall arrives (Stage 6), ContextDB
   (github.com/antiartificial/contextdb) is the leading candidate** over
   SQLite FTS: cross-session "what did we decide last week?" is a
   wording-divergent semantic problem, and its credibility/decay/evidence
   chains fit "the room remembers conclusions." Owner-adjacent project
   (maintainer access; already running as coach-mikey's memory,
   BadgerDB embedded mode — no Postgres needed). Goes BEHIND the
   ContextProvider/memory-tool seam as a rebuildable derived store;
   transcripts stay source of truth. Known integration surface (from
   coach-mikey, see that repo's spec-memory-v1.md): server mode has no
   embedder — daemon owns Gemini embeddings (batchEmbedContents, 768d,
   task types); namespace mode pins on first touch; label sources before
   first write; per-query score overrides; refute-not-delete; and an
   upstream bug (unreported as of 2026-07-15) where refutes don't affect
   vector-path ranking — report/fix before the room depends on feedback.
   Still gated on the measured trigger — not before Stage 6.

## Staged path (all post-refactor)

| Stage | What | Unlocks | Cost/turn |
|---|---|---|---|
| **0 — insurance** | Landed inside the refactor (see spec amendments): domain command service, additive correlated envelopes + `source`, transcript service with tool-output projection, grammar preserved | Clean attachment later | — |
| **1 — PTT intent** | Mac/arcade PTT → whisper → RuleRouter → LlmRouter → command service; CommandPlan for compounds; fix the bound-target raw-inject bypass; silent/cached acks | Compound commands, paraphrases, arcade PTT stops wasting injects | ≈ $0 (LLM sub-cent, no TTS) |
| **2 — contextual Q&A** | `answer_from_context` + fact cache + tool-output projection; short character-voice answers | "What was that URL?", "what's Raph doing?", "did tests pass?" without waking Claude | pennies (TTS-dominated) |
| **3 — continuity** | Interpreter turn log; rolling summary only if measured | Follow-ups, longer exchanges | occasional flash calls |
| **4 — mobile hold-to-talk** | Phone mic capture (does NOT exist today — phone is output + typed reply only) → authenticated bounded upload to daemon → same pipeline; lifecycle text in call view; replies via phone audio adapter | Jarvis on the phone | same + upload latency |
| **5 — optional duplex spike** | A/B the same TurnCoordinator behind ElevenLabs Speech Engine vs self-managed VAD/streaming STT; measure latency, barge-in correctness, failure modes, $/active-hour; abort propagation + generation IDs so late output never speaks | Hands-free, barge-in | $0.08/min-class if hosted |
| **6 — optional orchestration/history** | Hermes escalation for genuine multi-agent goals; SQLite FTS as rebuildable index only on measured cross-session search pain | Conversational entry into orchestration; durable recall | per Hermes design |

## Owner decisions (when the feature is scheduled — none block the refactor)

1. **Interpreter reply policy** — silent / cached phrase / `say` /
   ElevenLabs character voice, per turn type (this is where the pennies go).
2. **Memory destinations** — room memory vs Claude memory as separate
   explicit tools (recommended: yes, both, never ambiguous).
3. **Duplex privacy line** — may a future duplex spike send mic audio to
   ElevenLabs, or must STT stay local?
4. **Wake model** — PTT-only (recommended, deliberate-intent economics) vs
   wake word later.

## Non-goals

No always-listening mic, no Agents-as-brain, no new daemon process, no
conversation state in React/`room-client`, no SQLite now, no voice-to-code
autonomy. The room stays a place where *you* talk to devs — the middle
agent just makes talking cheap.
