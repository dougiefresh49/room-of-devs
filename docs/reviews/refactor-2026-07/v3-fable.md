# Follow-up review v3 (fable-5): the conversational layer

Written independently, before reading the other two v3 reports. Grounded in
`voice.ts`, the PTT scripts, `live-tail.ts`, `mobile-http.ts` `/thread`,
`design-multi-agent-v2-hermes.md`, and the v2 consensus spec.

## Q1 — Compatibility with the v2 refactor

**The v2 architecture is not just compatible — it's the enabling move.**
The conversational layer is a daemon-side service plus one more *participant
in the protocol we're already building*, not a third UI:

- **The command service (Phase 1b) is the interpreter's actuator.** Once
  commands are typed, validated, and centrally dispatched, an interpreter
  that emits `{type: "inject", target, message}` or two sequential commands
  for "save memory and clear the session" is a small producer on an existing
  seam. Without the refactor, the interpreter would have to shell out to
  scripts the way `voice.ts` does today — workable but untyped and
  unauditable.
- **The additive event envelope (Phase 0) is the other half.** A
  `ServerEvent` union with revisions accepts a future
  `{type: "interpreter_turn", ...}` member without breaking either client.
  The mobile call view already renders a thread; interpreter replies are
  just another message source in it.
- **Audio routing is already bidirectional at the edges.** Mic capture
  exists (arcade PTT records WAV; phone mic reaches the daemon), and
  spoken output already streams to Mac or phone. Keeping mobile audio
  behind the platform adapter (already planned in Phase 5) is exactly the
  seam a duplex path would later use.

Cheap insurance to add during the refactor (all small):

1. **Command envelopes carry a `source`** (`desktop | mobile | voice |
   interpreter`) so gating, audit, and UI attribution can distinguish a
   human tap from an interpreted utterance. One field, reserved now.
2. **Keep `voice.ts` a named seam, not a casualty.** Its normalized
   transcript → Action pipeline (aliases, Levenshtein floor-name matching,
   inject targets) is the deterministic fast-path of the future
   interpreter. In Phase 1 it should become/feed `services/interpreter.ts`
   rather than being fused into the command service or deleted as legacy.
3. **Expose transcript reading as a service API.** `live-tail.ts` and
   `/thread` already parse session JSONL; factor that into a
   `transcript-service` the interpreter can query (last N turns, grep for
   a pattern) instead of leaving it live-mode-internal.

Nothing else in the plan needs to change, and I found no decision we would
regret. The one anti-regret rule: don't let Phase 6 legacy cleanup delete
the PTT/aliases plumbing as "SwiftBar-era" — it's the input half of this
feature.

## Q2 — What is the middle layer?

**Recommendation: (a) an in-house interpreter service in the daemon,
staged. Not Hermes. Not ElevenLabs Agents as the core (possibly as stage-3
ears).**

**Why not Hermes.** The Hermes doc solves a different problem: task
orchestration — kanban decomposition, delegate_task, sub-agent lifecycle.
The room already *has* its agents (Claude Code sessions in tmux) and its
delegation model (the owner). What's missing is an **I/O and intent
problem**: speech → interpretation → existing commands, and cheap
contextual Q&A. Adopting a second agent runtime with its own memory,
provider config, and kanban to parse "save memory and clear" imports a
platform to do a service's job. The Hermes design remains a valid *someday*
doc for autonomous orchestration, but it is orthogonal to — and heavier
than — the conversational layer. If Hermes ever lands, it would sit
*behind* the interpreter (as another actuator), not replace it.

**Why not ElevenLabs Speech Engine first.** Their shape is genuinely
right — hosted STT + turn-taking + barge-in, your server as the brain, TTS
back — and we already pay ElevenLabs for the character voices. But: (1)
conversational products bill per-minute for the whole loop, which replaces
our pay-per-utterance PTT economics with an open meter; (2) the audio path
moves through their infra, where today mic + speakers stay on LAN; (3) it
wants to own exactly the parts we've already built and like (streaming
character TTS, the Gemini voice rewrite). The pieces it uniquely adds —
VAD, turn-taking, barge-in — only matter at full duplex, which is stage 3
and may never be wanted: PTT half-duplex is not a limitation, it's the
cost-control and intent-signal feature (a deliberate button press marks
"this is for you").

**The in-house shape:**

```
mic (arcade PTT wav | phone PTT)
  → STT (local whisper.cpp small model; hosted STT as fallback/upgrade)
  → interpreter service (daemon):
      1. fast path: voice.ts rules + aliases (zero cost, ~zero latency)
      2. else: Gemini flash-lite w/ function calling over the typed
         command vocabulary + a `answer(text)` tool
         context: room snapshot + thread tail + transcript-service query
  → actuator: command service (source: "interpreter")
  → voice reply: existing Gemini-rewrite → ElevenLabs pipeline (short ack
     or answer, in the character voice already assigned)
```

**Cost per conversational turn (sketch):** STT local = $0; flash-lite
intent+answer turn ≈ 1–3k tokens ≈ tenths of a cent; ElevenLabs TTS on a
one-to-two-sentence reply (~100–250 chars) — the dominant cost, same order
as today's acks/status lines, single-digit cents. Total: **pennies per
turn.** The same "what was that remote url?" hitting a Fable session means
a full-context wakeup — hundreds of times the cost, plus interrupting the
working agent's turn. The interpreter is also the guard that keeps arcade
PTT from injecting raw transcripts into expensive sessions: parse first,
inject only what's meant, answer locally what doesn't need the heavy
model.

## Q3 — Memory and context

Three tiers, only the first two needed for a long time:

1. **Session context (exists):** the JSONL transcript. "What was that
   remote url?" is a transcript-service query — tail + targeted scan of
   the working session's transcript, matched chunk fed to flash-lite. No
   store, no index; the file is right there and live-tail already parses
   it.
2. **Conversation continuity (small, filesystem):** the interpreter's own
   exchanges per thread — a rolling JSON log + optional flash-maintained
   summary under `~/.cursor/tts/state/`, matching the existing IPC style.
   This is what lets follow-ups ("and the second one?") resolve.
3. **Durable cross-session memory:** *defer.* Claude Code's own memory
   already covers durable repo facts, and the interpreter can **read**
   `CLAUDE.md` + the auto-memory dir for free answers. (Those are shared
   per project path across sessions and models — a Sonnet session and a
   Fable session on this repo read/write the same memory; nothing is
   partitioned by model.) A searchable cross-session index (SQLite FTS
   over transcripts — or ContextDB, already running for coach-mikey) is
   exactly the v2 "measured trigger" case: open that door only when
   transcript-scan Q&A demonstrably fails, and then as a rebuildable
   derived index per the v2 rule. This feature does NOT reopen the DB
   question today.

## Q4 — Phased path

- **V0 — compound voice commands (small; after refactor Phase 1, no UI
  work):** PTT WAV → whisper.cpp → interpreter (rules fast-path, flash
  fallback) → command service. Unlocks "save memory and clear the
  session" → two injects, "mute mikey for ten minutes", target inference.
  Cost: ~$0 per command turn (TTS ack via cached phrases).
- **V1 — contextual Q&A (the Jarvis feel):** add the transcript-service
  context pack + `answer` tool; replies spoken in character voice and
  appended to the mobile thread via a new event type. Unlocks "what was
  that remote url?", "what's raph working on?", "did the tests pass?"
  without waking any coding agent. Pennies per question.
- **V2 — conversational continuity:** per-thread interpreter log +
  rolling summary (tier 2 memory); multi-turn exchanges on the call view;
  push-to-talk remains the turn-taking mechanism, deliberately.
- **V3 — optional duplex:** only here do VAD/barge-in/always-listening
  matter. Decide *then* between ElevenLabs Agents (fast to adopt, per-
  minute cost, cloud audio) and home-rolled VAD + streaming STT. May
  reasonably never be built — V1/V2 deliver the "dev in the room" feel at
  PTT economics.

**Amendments to `docs/spec-ui-refactor.md`:** minimal. (1) Reserve
`source` on command envelopes in Phase 0's protocol work. (2) In Phase 1,
land `voice.ts`'s logic as/behind `services/interpreter.ts` and factor
transcript reading into a service. (3) Note the interpreter as a named
future service in the target structure. (4) New owner decisions for the
feature itself (not the refactor): STT engine (local whisper vs hosted),
interpreter wake word vs PTT-only, and which sessions the interpreter may
inject into unprompted. No phase reordering; no new packages now.

---

*Reviewer: fable-5 (session lead) · written before reading v3-gpt56 /
v3-grok45 · 2026-07-21*
