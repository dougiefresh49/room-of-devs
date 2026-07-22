# Task brief v3: The conversational layer ("dev in the room" / Jarvis state)

Final planning round. THREE reviewers this time: gpt-5.6 (codex), grok-4.5
(cursor-agent), and fable-5 (the session lead, writing its own report).
Work alone; a cross-review round follows where each reads all three.

## Required reading

1. `CLAUDE.md`, `docs/spec-ui-refactor.md` (the v2 consensus you built).
2. `docs/design-multi-agent-v2-hermes.md` — the owner's earlier Hermes
   orchestration design (2026-05-21, pre-dates the room UI).
3. `docs/spec-live-mode-v2.md` — current live call/chat mode.
4. `docs/ideas-backlog.md` — check for related entries before proposing
   "new" ideas.
5. Code: `tts-server/src/voice.ts` (existing rule-based voice-command
   parser: normalized transcript + aliases → grant/pause/replay/mute/
   inject actions), the PTT path (`scripts/ptt.sh`, `scripts/voice_ptt.sh`,
   `hid.ts` arcade PTT), `live-tail.ts` (already tails session transcript
   JSONL), `dynamic-response.ts` + `gemini.ts` (existing cheap-LLM layer),
   `mobile-http.ts` `/thread` (rolling per-session conversation view).

## The owner's vision (verbatim intent, paraphrased)

Today's mobile "live" mode is: agent speaks, owner texts a reply, owner
listens to the thought process. The target state is an actual
**conversation flow** — a "dev in the room", Tony Stark / Jarvis style.
NOT "shout into the mic and code builds itself"; rather:

- Owner says: "ok, write to memory and clear the session." That is TWO
  terminal commands to the coding agent. Something must interpret intent →
  concrete command sequence.
- The coding agent is mid-task in the terminal; owner asks "what was that
  remote url?" A lightweight middle agent should answer from conversation
  context / transcript / memory — WITHOUT the heavy model (Claude Fable)
  burning tokens on a grep, and without interrupting the working agent.
- Same applies to arcade push-to-talk: without an interpretation layer
  between speech and injected commands, spoken input wastes expensive
  agent usage.
- Economics are the driver: conversation-style interaction with a heavy
  model is not financially feasible. Heavy models do coding turns; the
  conversational layer must run on something cheap (the stack already
  pays for Gemini flash-lite; ElevenLabs is the per-character cost).

The owner explicitly asks: **is this where Hermes comes in, or is this
building an in-house version of the ElevenLabs speech engine?** (Cookbook:
https://elevenlabs.io/docs/eleven-api/guides/cookbooks/speech-engine.md —
summary below in case you cannot fetch it.)

> ElevenLabs Speech Engine cookbook summary: WebSocket-per-conversation
> orchestration. Browser mic → ElevenLabs hosted STT → transcript sent to
> YOUR server → your server calls whatever LLM it wants → response text →
> ElevenLabs hosted TTS → audio back to browser. Their SDK handles
> connection management, turn-taking, and interruption detection (an
> AbortSignal fires on user barge-in so you cancel the LLM call).
> Developer builds: the server + LLM integration + auth token endpoint.
> ElevenLabs hosts: STT, TTS, WebRTC/audio infra. Related product:
> ElevenLabs Agents / Conversational AI.

## Your deliverables (ONE markdown file, sections Q1–Q4)

### Q1 — Compatibility with the v2 refactor consensus

Does the agreed architecture (packages/protocol + room-client + ui, daemon
services, WS/SSE transports, two Tauri windows, mobile Vite app)
accommodate this conversational layer as a future addition? Identify the
seams that matter NOW — cheap insurance to bake into the refactor (e.g.
where the interpreter plugs into the command service, whether the protocol
package should reserve envelope room for conversational turns, how audio
in/out routing composes with phone streaming) — versus what stays
deliberately unbuilt. Flag anything in the current refactor plan we would
REGRET when this layer arrives.

### Q2 — What IS the middle layer? Recommend a shape.

Evaluate at least these candidates against the vision + economics:

a. **In-house interpreter service in the daemon**: STT transcript →
   cheap-LLM intent layer (Gemini flash tier, already a paid dependency)
   with tool/function-calling → existing action vocabulary
   (inject_prompt.sh, signal.ts, queue actions, memory/clear slash
   commands injected as prompts) + read access to session transcripts
   (live-tail already parses them) for contextual Q&A. Extends
   `voice.ts`'s rule-based parser into an AI router with the rules as
   fast-path.
b. **Hermes orchestration** per `docs/design-multi-agent-v2-hermes.md` —
   is Hermes the right frame for THIS feature, or is it solving a
   different problem (task orchestration / kanban delegation vs
   conversational interpretation)? Be honest about overlap and about
   whether adopting Hermes for conversation would drag in complexity the
   room doesn't need.
c. **ElevenLabs Speech Engine / Agents**: hosted STT + turn-taking +
   barge-in + TTS with our daemon as the LLM brain. What would it replace
   in the current pipeline (mic capture, STT, turn-taking, TTS
   streaming)? What does it cost (per-minute conversational pricing vs
   current per-character TTS)? What breaks the LAN/local-ownership model
   (phone mic already reaches the daemon; audio already streams to the
   phone)? Character voices are ElevenLabs voices already — does that
   help?
d. Hybrid or other shapes you consider superior.

Pick ONE recommended shape (possibly staged across the others) and defend
it. Include a concrete cost sketch per conversational turn (STT + interpreter
LLM + TTS) vs the cost of the same turn hitting a heavy coding agent.

### Q3 — Memory & context for the middle agent

What does the interpreter need to answer "what was that remote url?"
mid-task? Consider: session transcript JSONL (exists), `/thread` rolling
view (exists), a per-session rolling summary the interpreter maintains, a
durable cross-session memory store. Does THIS feature hit the "measured
trigger" that reopens the SQLite-as-derived-index door from the v2
consensus, or does filesystem + transcript tailing still suffice? Where
does Claude Code's own memory (CLAUDE.md, auto-memory dir) fit vs the
room's own memory?

### Q4 — Phased path + amendments

Cheapest viable v0 (e.g., PTT → STT → flash-tier intent parse → existing
actions, with rule fast-path) through to full duplex conversation with
barge-in. For each stage: what it unlocks, what it costs, what it needs
from the refactor. End with concrete amendments (if any) to
`docs/spec-ui-refactor.md`: new packages/services, protocol reservations,
phase adjustments, new owner decisions. If the refactor needs NO changes,
say so explicitly — do not invent work.

## Hard constraints (unchanged)

- READ-ONLY except your single output file. No daemon starts/restarts, no
  touching `~/.cursor/tts/`, NO live Gemini/ElevenLabs calls.
- pnpm, never npm. No CI/test-suite proposals.
- Filesystem IPC contract + credit guards stay.
- This is a FUTURE-direction round: the v2 refactor plan executes first;
  do not redesign it — amend it only where this feature demands seams now.
- Web research allowed if your tooling supports it (ElevenLabs pricing,
  Hermes capabilities); code claims must come from this repo.
