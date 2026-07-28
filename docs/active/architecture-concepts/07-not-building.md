# What we are NOT building

Issue #73, deliverable 5. The anti-goals, so future design rounds can
be checked against them at a glance.

1. **A voice+KB chatbot.** "Voice + LLM + knowledge base" is
   ElevenLabs' product ("give your agent a voice"). Ours is a voice
   **above** an orchestration layer — the voice's value is what it
   fronts, not what it knows.
2. **Multi-voice debate theater.** No three-voice huddles, no group
   calls, no agents talking to each other in audio. Voices only ever
   talk to the owner; disagreement ships as a synthesized, attributed
   memo (06, scenario 5). The only second voice is a checked-out 1:1
   (04) — purposeful, mortal.
3. **Real-time ink / stroke-timed whiteboards.** The whiteboard is a
   versioned text artifact (Mermaid) in a render-annotate-revise loop.
   No stroke lists, no clause-anchored ink timing, no canvas replay
   engine — the final-4 review already called this "a subsystem
   presented as motion budget."
4. **Lipsync escalation.** Stage lipsync/blink stays the cosmetic rAF
   loop it is; it never becomes a driver for ink, gesture, or
   "presence" subsystems.
5. **Always-listening mic / default full duplex.** PTT is the intent
   signal, privacy boundary, and cost control. Duplex remains, at
   most, the Stage 5 measured spike from the conversational-layer
   design — never the default posture.
6. **A resident orchestrator brain.** No long-lived frontier session
   that "is" the room's mind (Option A, rejected on measured cost +
   mortality). Everything with a context window is mortal; the spine
   is the mind.
7. **A new orchestrator runtime.** No Hermes-style process/kanban
   engine before the tracker-plus-threads model measurably fails. The
   task manager IS the orchestration substrate.
8. **Conversation state in clients.** No dialogue state in
   `room-client`, the panel, or the mobile SPA — clients render
   snapshots and route input (standing rule from the refactor).
9. **A database for room state.** Filesystem + tracker + transcripts
   until a measured trigger says otherwise; ContextDB only at the
   durable-recall stage (Stage 6), as a rebuildable derived store.
10. **Silent capability growth.** Saved verbs (05) are always offered
    and named by the owner, never auto-installed by a model on its own
    judgment.
