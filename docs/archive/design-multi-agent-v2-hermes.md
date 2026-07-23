# Multi-Agent Architecture v2 — Hermes Agent Orchestration

_Design doc — 2026-05-21_

---

## Context

**v1 (current):** Each Claude Code session is a standalone agent. The TTS server watches for responses, processes them through Gemini for character voice, and plays via ElevenLabs. Sessions are independent — no coordination, no task delegation, no shared awareness.

**v2 (this doc):** Hermes Agent becomes the orchestration layer. Each character is a Hermes agent that delegates to specialized coding tools (Claude Code, Codex CLI, agy/Gemini). A top-level orchestrator (Splinter) breaks down goals and assigns to character agents. The voice/avatar pipeline sits on top.

**Why v2:** A single agent with tools has a capability ceiling. Multi-agent orchestration with specialized tools per agent is where the real leverage is — and Hermes already solved the hard coordination problems (background tasks, kanban task breakdown, sub-agent management, memory/session search).

---

## Architecture Overview

### Important: How Hermes Actually Works (from v0.14.0 research)

Hermes agents do **NOT** communicate directly with each other. There is no peer-to-peer messaging. Coordination happens via:

1. **Shared kanban board** — SQLite DB at `~/.hermes/kanban.db` with structured handoff metadata
2. **`hermes mcp serve`** — exposes a conversation as an MCP server for other agents
3. **`delegate_task`** — spawns sub-agents (sync or parallel, max 3 concurrent by default)

This means the "Splinter orchestrates turtles" pattern works, but it's **one Hermes instance (Splinter) spawning sub-agents**, not five separate Hermes instances chatting with each other. The kanban board is the shared state.

### Architecture Option A: Single Hermes with Persona Profiles (Recommended)

agy's review flagged that running separate Hermes instances as a swarm is fighting the tool's design. The better pattern:

```
┌─────────────────────────────────────────────────────────────────┐
│                     Voice / Avatar Layer                        │
│  (TTS server, ElevenLabs, arcade buttons, avatar UI)            │
│                                                                 │
│  You ──► Arcade Button ──► STT ──► Route to Agent               │
│  Agent responses ──► Gemini (character voice) ──► ElevenLabs    │
└────────────────────────────┬────────────────────────────────────┘
                             │
               Shell hooks / Webhooks / Plugin API
                             │
┌────────────────────────────┴────────────────────────────────────┐
│              SINGLE Hermes Instance (Splinter)                  │
│                                                                 │
│  Kanban Board (SQLite)                                          │
│  ┌────────┐ ┌──────┐ ┌────────┐ ┌─────────┐ ┌──────┐            │
│  │ Triage │→│ Todo │→│ Ready  │→│ Running │→│ Done │            │
│  └────────┘ └──────┘ └────────┘ └─────────┘ └──────┘            │
│                                                                 │
│  Sub-agents spawned via delegate_task:                          │
│  ┌──────────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐     │
│  │ DONATELLO    │ │ LEONARDO  │ │ RAPHAEL   │ │ MIKEY     │     │
│  │ profile      │ │ profile   │ │ profile   │ │ profile   │     │
│  │              │ │           │ │           │ │           │     │
│  │ Tools:       │ │ Tools:    │ │ Tools:    │ │ Tools:    │     │
│  │ · Claude API │ │ · Claude  │ │ · Claude  │ │ · Codex   │     │
│  │ · agy/Gemini │ │   API     │ │   API     │ │   CLI     │     │
│  │ · Web search │ │ · Codex   │ │ · Test    │ │ · agy     │     │
│  │ · Code review│ │   CLI     │ │   runners │ │ · Scripts │     │
│  │              │ │ · Git ops │ │ · Linters │ │           │     │
│  │ Blue button  │ │ Teal btn  │ │ Red btn   │ │ Yellow btn│     │
│  └──────────────┘ └───────────┘ └───────────┘ └───────────┘     │
│                                                                 │
│  Max 3 concurrent sub-agents (configurable)                     │
│  Dispatcher loop every 60s: reclaims stale, promotes tasks      │
│  Heartbeat/zombie detection: stuck agents auto-blocked          │
└─────────────────────────────────────────────────────────────────┘
```

### Architecture Option B: Multiple Hermes Instances (Higher complexity)

If direct button-to-agent routing requires independent sessions:

```
┌─────────────────────────────────────────────────────────────────┐
│  SPLINTER (Hermes #1 — orchestrator profile)                     │
│  Owns kanban board, creates tasks, assigns to profiles            │
│  └─► delegate_task(profile="donatello", task="...")              │
│  └─► delegate_task(profile="raphael", task="...")                │
│                                                                  │
│  Shared kanban DB: ~/.hermes/kanban/boards/tmnt/kanban.db        │
│                                                                  │
│  DONATELLO (Hermes #2 — worker lane, kanban consumer)            │
│  LEONARDO  (Hermes #3 — worker lane, kanban consumer)            │
│  RAPHAEL   (Hermes #4 — worker lane, kanban consumer)            │
│  MIKEY     (Hermes #5 — worker lane, kanban consumer)            │
│                                                                  │
│  Each runs independently, claims tasks from shared kanban         │
│  Coordination via kanban_complete(summary, metadata)              │
│  MCP bridge possible: hermes mcp serve per agent                 │
└─────────────────────────────────────────────────────────────────┘
```

**Note:** Kanban worker lanes exist in Hermes but Claude Code and Codex CLI as native workers are "not yet a paved path" per the docs. Custom integration work needed.

---

## How It Differs from v1

| Aspect                    | v1 (Current)                    | v2 (Hermes)                                              |
| ------------------------- | ------------------------------- | -------------------------------------------------------- |
| **What is an "agent"**    | Claude Code session             | Hermes agent with multiple tool backends                 |
| **Task assignment**       | Manual (you pick which session) | Splinter auto-decomposes and assigns                     |
| **Tool selection**        | Claude Code only                | Per-agent: Claude Code, Codex CLI, agy, web search, etc. |
| **Background work**       | One task at a time per session  | `/background` for parallel tasks within an agent         |
| **Memory**                | Conversation context only       | Persistent session logs, searchable across days          |
| **Inter-agent awareness** | None                            | Shared kanban, inter-agent messaging                     |
| **Task tracking**         | Manual / git commits            | Auto-kanban with triage → in-progress → done             |
| **Voice interaction**     | "Read response aloud"           | "Talk to specific agent, get orchestrated response"      |

---

## Agent Roles & Specializations

### Splinter — The Orchestrator

**Personality:** Wise, patient, strategic. Sees the big picture.

**Responsibilities:**

- Receive high-level goals from the user ("refactor the auth system")
- Decompose into sub-tasks on the kanban board
- Assign tasks to the right turtle based on specialization
- Monitor progress and reassign if blocked
- Summarize status across all agents when asked

**Tools:** Kanban management, sub-agent spawning/messaging, memory search

**Voice trigger:** White arcade button or "Master Splinter, what's the status?"

### Donatello — Tech Lead / Architect

**Personality:** Analytical, thorough, loves explaining the "why."

**Specialization:** Research, architecture decisions, code review, complex refactors

**Tools:**

- Claude Code (deep reasoning, complex code changes)
- agy/Gemini (research, web search, documentation)
- Code review tools

**When Splinter assigns to Donnie:** Tasks requiring research, architectural decisions, understanding existing systems, cross-cutting refactors

### Leonardo — Lead Developer

**Personality:** Disciplined, focused, gets it done right.

**Specialization:** Core implementation, feature development, git workflow

**Tools:**

- Claude Code (primary implementation)
- Codex CLI (fast code generation for boilerplate)
- Git operations (branching, PRs, merge management)

**When Splinter assigns to Leo:** Feature implementation, clean-room builds, anything that needs to be done "by the book"

### Raphael — QA / Debugger

**Personality:** Aggressive, no-nonsense, finds problems others miss.

**Specialization:** Bug hunting, test writing, performance debugging

**Tools:**

- Claude Code (debugging, test generation)
- Test runners (jest, vitest, pytest)
- Linters and static analysis
- Performance profilers

**When Splinter assigns to Raph:** Bug reports, test coverage gaps, "this is broken and I don't know why," performance issues

### Michelangelo — Rapid Prototyper

**Personality:** Creative, fast, doesn't overthink it.

**Specialization:** Quick prototypes, scripts, UI experiments, "just make it work"

**Tools:**

- Codex CLI (fast vibe coding)
- agy/Gemini (quick scripts, one-off automation)
- UI frameworks, playground tools

**When Splinter assigns to Mikey:** Proof-of-concepts, quick scripts, "can you just whip up a..." tasks, creative UI work

---

## Workflow Examples

### Example 1: "Refactor the auth system"

```
You (voice): "Splinter, we need to refactor the auth middleware.
              Legal flagged the session token storage."

Splinter:
  1. Creates kanban goal: "Auth middleware refactor (compliance)"
  2. Assigns Donnie: "Research current auth implementation, identify compliance gaps"
  3. Assigns Leo (background): "Prepare a feature branch, set up test fixtures"

Donnie (reports back via voice):
  "I've reviewed the auth middleware. The session tokens are stored in
   plain cookies — that's the compliance issue. I recommend migrating
   to httpOnly secure cookies with encrypted payloads. Here's the plan..."

Splinter:
  4. Assigns Leo: "Implement Donnie's recommendation"
  5. Assigns Raph: "Write integration tests for the new auth flow"
  6. Assigns Mikey (background): "Update the login page UI to handle new token format"

Raph (reports back):
  "Tests are passing but I found an edge case — expired tokens aren't
   being cleared on the client side. Filing that as a sub-task."

Splinter:
  7. Assigns Leo: "Fix the token cleanup Raph found"
  8. Final status: "Auth refactor complete. 4 sub-tasks done, all tests passing."
```

### Example 2: Quick question via arcade button

```
You: [Hold BLUE button — Donatello]
     "Donnie, what's the best way to handle rate limiting on this API?"

Donatello (direct response, no orchestrator):
  Uses agy to research current best practices, checks existing codebase
  for rate limiting patterns, responds in-character via voice.

  "Okay so I looked at what we've got. The API doesn't have any rate
   limiting right now — which is, frankly, terrifying. I'd recommend
   express-rate-limit with a Redis backing store. Want me to set it up?"
```

### Example 3: Kanban-driven autonomous work

```
You open Hermes dashboard, drop into triage:
  - "Add dark mode to the settings page"
  - "Fix the flaky CI test in user.spec.ts"
  - "Upgrade React to v20"

Splinter auto-assigns:
  - Dark mode → Mikey (UI work, creative)
  - Flaky test → Raph (debugging, test expertise)
  - React upgrade → Leo (methodical, dependency management)

All three work in parallel. Each reports back via voice when done.
You work on something else the whole time.
```

---

## Voice Pipeline Integration

### Hermes has three concrete integration points for our TTS pipeline

**1. Shell lifecycle hooks (simplest, most like our current setup)**

- Hermes supports shell scripts at key agent lifecycle points
- Wire our existing ingestion script as a Hermes shell hook
- On agent response → push to `~/.cursor/tts/queue/` as JSON
- Closest to how Claude Code Stop hooks work today

**2. Plugin system (most powerful)**

- Plugins live at `~/.hermes/plugins/` (user) or `.hermes/plugins/` (project)
- Expose slash commands, tool dispatch, execution blocking, result transformation
- v0.14.0 adds `ctx.llm` for direct LLM calls from plugins and `tool_override` flags
- We could build a `speak` plugin that intercepts tool results and pushes to TTS
- Could also add a `tool_override` that transforms agent output into voice-ready text

**3. Webhooks (event-driven, good for async)**

- `hermes webhook subscribe` for event-driven activation
- Supports prompt templating and cross-platform delivery
- On task completion → webhook fires → triggers TTS pipeline
- Best for the kanban-driven autonomous workflow (Phase 4)

**4. HTTP API (for programmatic control)**

- OpenAI-compatible chat completions endpoint
- Anthropic Messages API compatible
- v0.14.0 exposes run approval events for programmatic clients
- Our tts-server could call Hermes API directly to send messages to agents

### Arcade Button → Hermes Routing

```
Button press → Pi → Mac (tts-server)
  → tts-server identifies target agent (button color → agent mapping)
  → STT transcribes user speech
  → Routes to Hermes:
      Option A: hermes CLI (hermes --conversation <agent-id> -p "message")
      Option B: Hermes HTTP API (OpenAI-compatible endpoint)
      Option C: hermes webhook trigger with prompt template
  → Hermes processes (may delegate to sub-agent or use tools)
  → Shell hook / plugin fires on response
  → Response flows through existing TTS pipeline
```

---

## Migration Path from v1

### Phase 1: Single Hermes agent (low risk)

- Install Hermes alongside existing Claude Code setup
- Run ONE character as a Hermes agent (Donatello) while others stay as Claude Code sessions
- Wire Hermes output through existing TTS pipeline
- Validate that the voice/persona experience works the same

### Phase 2: All characters as Hermes agents

- Migrate remaining characters to Hermes agents
- Each agent gets its own tool configuration (which backends it can use)
- Arcade buttons route to Hermes agents instead of Claude Code sessions
- Claude Code becomes a tool that agents use, not the agent itself

### Phase 3: Add Splinter orchestrator

- Top-level Hermes agent with kanban/task management
- Auto-decomposition of goals into sub-tasks
- Sub-agent assignment based on specialization
- Background task support for parallel work

### Phase 4: Full autonomous workflow

- Drop goals into kanban triage
- Splinter assigns and coordinates
- Agents work in parallel, report back via voice
- You intervene only when needed (questions, approvals)
- Avatar UI shows real-time status of all agents

---

## Trade-offs vs v1

### Advantages

- **Much more capable** — agents can use multiple tools, work in parallel, coordinate
- **Persistent memory** — "what did we work on yesterday?" works
- **Auto-task-management** — kanban decomposition means less manual orchestration
- **Provider-agnostic** — agents choose the best model for each sub-task
- **Built-in background tasks** — no custom implementation needed

### Risks / Concerns

- **Latency (BIGGEST RISK)** — stacking LLM round-trips: STT → Splinter routing → turtle planning → Claude Code execution → TTS. Time-to-first-audio could be 10-20s+ for complex tasks. **Must prototype a hello-world through the full chain to measure before committing.**
- **Claude Code as Hermes tool is not paved** — Claude Code has a Hermes skill file but is NOT a native kanban worker lane. Wrapping an interactive CLI into programmatic kanban task completion requires custom integration work.
- **File conflict in parallel work** — if Leo and Mikey modify the same repo concurrently, git state conflicts arise. Need git worktree isolation per agent (Claude Code Agent Teams already handles this).
- **Complexity** — more moving parts than direct Claude Code sessions
- **Hermes dependency** — tying architecture to a specific open-source project (v0.14.0, moving fast)
- **Maturity** — Hermes is new and evolving rapidly; kanban worker lanes are explicitly "not yet a paved path"
- **Cost** — running multiple model backends simultaneously

### Fallback Plan

If v2 proves too complex or Hermes doesn't meet needs:

- v1 architecture remains fully functional
- Claude Code Agent Teams (SendMessage) provides basic multi-agent without Hermes
- Hermes agents can be added incrementally — no all-or-nothing migration
- The voice pipeline, arcade buttons, and avatar UI are independent of the orchestration layer

---

## Hardware Topology (Optional: Multi-Machine)

Hermes supports treating machines as nodes in a distributed orchestration setup. Your friend's pattern: desktop as a dedicated Hermes node with kanban state centralized there, other machines connect and observe.

**Available hardware:**

| Machine | Role | Specs | Notes |
|---------|------|-------|-------|
| MacBook Pro (primary) | Development + TTS + arcade buttons | Current daily driver | Runs tts-server, ElevenLabs, whisper.cpp |
| MacBook Pro (2014/2015) | Potential worker node | 16GB RAM | Could run 1-2 Hermes sub-agents autonomously |
| MacBook Pro (2014/2015 #2) | Spare (needs battery) | 16GB RAM | Available if needed |
| Raspberry Pi Model B | Arcade button controller | 256MB RAM | GPIO + USB serial only |

**Possible topology:**

```
┌─────────────────────────────┐     ┌────────────────────────────┐
│  Primary MacBook Pro         │     │  2014 MacBook Pro (worker) │
│                              │     │                            │
│  Splinter (orchestrator)     │◄───►│  Leonardo + Raphael agents │
│  TTS pipeline                │ SSH │  Claude Code / Codex CLI   │
│  Arcade button listener      │     │  ContextDB (local BadgerDB)│
│  ContextDB (PostgreSQL)      │     │                            │
│  Kanban state (source of truth)│    └────────────────────────────┘
│                              │
└─────────────────────────────┘
```

**When this makes sense:**
- Running 3-4 concurrent Claude Code sessions on one machine gets CPU/memory heavy
- Offload long-running background agents to the older MacBook
- Kanban state stays centralized on primary machine — workers connect over LAN
- Could also just run everything on the primary MacBook and only add the second machine if resource-constrained

**For MVP:** Single machine is fine. The architecture doesn't require multi-machine — it's just an option if concurrent agents strain resources.

---

## Open Questions (Updated with Research)

1. ~~**Hermes hook system**~~ — **ANSWERED:** Yes. Shell lifecycle hooks, plugin system with `tool_override`, and `hermes webhook subscribe` all work for wiring into TTS pipeline.
2. ~~**Inter-agent messaging**~~ — **ANSWERED:** No direct peer messaging. Coordination via shared kanban DB (`kanban_complete(summary, metadata)`) or MCP bridge (`hermes mcp serve`).
3. **Concurrent agents** — default max 3 concurrent sub-agents via `delegation.max_concurrent_children`. What are the memory/CPU implications on a MacBook Pro when each sub-agent may spawn its own Claude Code or Codex CLI process?
4. ~~**Claude Code as Hermes tool**~~ — **PARTIALLY ANSWERED:** A skill file exists at `skills/autonomous-ai-agents/claude-code/SKILL.md` but Claude Code is NOT a native kanban worker lane. Custom wrapper needed.
5. ~~**Kanban API**~~ — **ANSWERED:** Kanban is a SQLite DB. Dispatcher loop runs every 60s. Workers use toolset: `kanban_show`, `kanban_complete`, `kanban_block`, `kanban_heartbeat`, `kanban_comment`. Programmatic access via SQLite directly or through Hermes CLI.
6. **NEW: Latency benchmark** — need to prototype STT → Hermes → tool execution → TTS to measure end-to-end latency before committing to this architecture.
7. **NEW: Git worktree strategy** — how do parallel agents avoid file conflicts? Need git worktree per agent or branch-per-agent strategy.

---

## Hermes Technical Details (v0.14.0, released 2026-05-16)

### Kanban Internals

- SQLite DB at `~/.hermes/kanban.db` (multi-board: `~/.hermes/kanban/boards/<slug>/kanban.db`)
- Task states: `triage → todo → ready → running → blocked → done → archived`
- Dispatcher loop every 60s: reclaims stale claims, promotes when dependencies complete
- Parent/child task chains: child becomes `ready` only when all parents are `done`
- Heartbeat/zombie detection: stuck agents auto-blocked and reclaimed
- Per-task `max_retries` with full run history

### Background Tasks

- `/background` (alias `/bg`) runs prompts in separate background sessions
- `process list/poll/wait/log/kill/write` for lifecycle management
- `watch_patterns` config for real-time stdout/stderr monitoring with notifications

### Provider Support (30+)

- Anthropic (API key or OAuth — routes as Claude Code on Max plan)
- OpenAI / Codex (`openai-codex`, `copilot`, `copilot-acp`)
- xAI / Grok (OAuth via SuperGrok/X Premium+)
- Gemini (`gemini`, `google-gemini-cli`)
- OpenRouter, Nous Portal, HuggingFace, Ollama, Bedrock, LM Studio
- Pluggable: implement `ProviderProfile` ABC, drop into `plugins/model-providers/`

### Memory

- `MEMORY.md` + `USER.md` for long-term storage (default)
- Indexed memory: monolithic file splits into sub-docs loaded on-demand
- `session_search` (FTS5 full-text with LLM summarization) for cross-session recall
- 1-hour cross-session prompt caching (system prompts + skills stay warm)
- SQLite session history with parent/child lineage tracking

### ContextDB — Epistemic Memory Provider (Recommended for v2)

**[hermes-memory-contextdb](https://github.com/antiartificial/hermes-memory-contextdb)** replaces the default file-based memory with an epistemic graph-vector database. Created by a friend of the project — direct access to the maintainer for support.

**Why ContextDB over default Hermes memory:**

- **Epistemic reasoning** — credibility scores, source tracking, confidence calibration. Agents don't just recall facts; they know how confident they are and where the knowledge came from.
- **Semantic vector search** — pgvector-backed similarity retrieval vs FTS5 keyword matching. Agents find related context even when wording differs.
- **Evidence chains** — `contextdb_explain` returns narrative explanations with source attribution. Splinter can trace *why* an agent believes something.
- **Memory decay & conflict awareness** — stale knowledge naturally deprioritizes; conflicting facts surface for resolution instead of silently overwriting.
- **Cross-agent shared memory** — all agents write to the same ContextDB namespace. Donatello's research findings are immediately available to Leonardo without explicit handoff.
- **Minimal tool surface** — only two tools (`contextdb_search` + `contextdb_explain`), keeping agent tool budgets lean.

**Setup:**

```yaml
# ~/.hermes/config.yaml
memory:
  provider: contextdb
  contextdb:
    namespace: "tmnt-agents"
    mode: "agent_memory"
```

```bash
# ~/.hermes/.env
CONTEXTDB_HOST=localhost
CONTEXTDB_PORT=5432
CONTEXTDB_USER=hermes
CONTEXTDB_PASSWORD=<password>
CONTEXTDB_DATABASE=hermes_contextdb
```

**Storage options:**
- **PostgreSQL + pgvector** (production) — run on the Mac Mini as a persistent shared store
- **Embedded BadgerDB** (dev/local) — zero-config fallback, good for single-machine prototyping

**How it fits the TMNT architecture:**
- Splinter writes task decomposition rationale → turtles recall *why* they were assigned a task
- Donatello's research findings get high credibility scores → other agents trust and reuse them
- Raphael's bug reports include evidence chains → when a similar bug appears, the context surfaces automatically
- Cross-session memory persists between conversations — "what did we learn about auth last week?" works naturally

**Installation:** Drop into `~/.hermes/plugins/contextdb/` — Hermes discovers it via the plugin system.

---

## Key Links

- [Hermes Agent GitHub](https://github.com/NousResearch/hermes-agent)
- [Hermes Agent Quickstart](https://hermes-agent.nousresearch.com/docs/getting-started/quickstart)
- [Kanban Docs](https://hermes-agent.nousresearch.com/docs/user-guide/features/kanban)
- [Kanban Worker Lanes](https://hermes-agent.nousresearch.com/docs/user-guide/features/kanban-worker-lanes)
- [AI Providers](https://hermes-agent.nousresearch.com/docs/integrations/providers)
- [Architecture](https://hermes-agent.nousresearch.com/docs/developer-guide/architecture)
- [CLI Reference](https://hermes-agent.nousresearch.com/docs/reference/cli-commands)
- [v0.14.0 Release Notes](https://github.com/NousResearch/hermes-agent/releases/tag/v2026.5.16)
- [hermes-memory-contextdb](https://github.com/antiartificial/hermes-memory-contextdb) — epistemic graph-vector memory provider
- [v1 Architecture (current)](./design-arcade-button-controller.md)
- [Avatar Pipeline](./design-avatar-pipeline.md)
- [Research Doc](./research-character-agents-vision.md)
