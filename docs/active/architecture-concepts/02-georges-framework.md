# George's framework, simplified

His stack, distilled to the same altitude as
[01-current-state.md](01-current-state.md) so the two can be compared
(issue #73, deliverable 2). Source: the framework exchange distilled in
[agentic-workflow-notes](../../reference/agentic-workflow-notes.md) plus
the stack summary in #73 — not a spec of his system, a sketch of its
load-bearing ideas.

```mermaid
flowchart TB
  classDef owner fill:#f5c542,stroke:#8a6d1a,color:#1a1a1a
  classDef orch fill:#60a5fa,stroke:#1d4ed8,color:#1a1a1a
  classDef worker fill:#5eead4,stroke:#0f766e,color:#1a1a1a,stroke-dasharray:5 4
  classDef memory fill:#86efac,stroke:#15803d,color:#1a1a1a
  classDef plumbing fill:#d4d4d8,stroke:#71717a,color:#1a1a1a

  G["🧑 George (text/chat — no voice layer)"]:::owner

  subgraph Models["models = interchangeable compute, routed by cost"]
    Frontier["🧠 frontier LLM<br/>(judgment, planning)"]:::orch
    Local["⚡ local LLM offload<br/>(mechanical work ≈ $0)"]:::worker
  end

  Vault["🗂 Obsidian vault — ACE-style memory<br/>notes, decisions, specs, embedded diagrams<br/>THE MIND LIVES HERE, not in any context window"]:::memory
  MCP["MCP connectors → tools, repos, services"]:::plumbing
  Gates["deterministic gates (Ptheory)<br/>~50 hook scripts that hard-block,<br/>immune to context rot"]:::plumbing

  G <--> Frontier
  Frontier <--> Vault
  Local <--> Vault
  Frontier --> Local
  Frontier <--> MCP
  Gates -.enforce.- Frontier & Local

  subgraph VizLoop["visualization loop (his whiteboard)"]
    Draw["manual rough sketch"]:::plumbing
    Src["LLM → Mermaid source"]:::plumbing
    Render["render + embed in vault"]:::plumbing
    Draw --> Src --> Render -- "annotate / question" --> Src
  end
  G --- VizLoop
  Render -.-> Vault
```

## The three load-bearing properties

1. **Nothing important lives in a context window.** The vault is the
   mind; sessions are disposable compute over it. Any model can pick up
   where any other left off, and "session death" costs nothing. This is
   the property our Option A (Mikey-as-orchestrator) lacks and Option B
   is built on — see [03-candidate-layerings.md](03-candidate-layerings.md).
2. **Work is routed by cost.** Local models take the mechanical load;
   the frontier model is reserved for judgment. Our flash-lite
   interpreter and composer/grok delegation are the same instinct,
   already live.
3. **The whiteboard is a file loop, not ink.** Diagram = text artifact
   (Mermaid) that renders, gets annotated, and re-generates. Git/vault
   versions it. Identical to the over-the-shoulder board's
   "whiteboard as file + anchors, not ink" — and to what this very
   document set is doing.

## Same-altitude mapping

| George | Room of Devs |
| --- | --- |
| Obsidian vault / ACE memory | `docs/` + GH issues + `~/.cursor/tts/state` + git (exists, but the room's *plan* mostly still lives in session contexts) |
| Local LLM offload | flash-lite interpreter, composer/grok delegates (live) |
| MCP connectors | hooks, `team.sh`, `inject_prompt.sh`, file IPC (live) |
| Deterministic gates | promotion ladder in agentic-workflow-notes (partially adopted) |
| Manual-draw → Mermaid → embed loop | issue #73's artifact loop (this folder is the seed) |
| **no voice layer** | **the entire point of this product** |

The trade is symmetric: he has the mind-outside-the-model discipline and
no voice; we have the voice and (today) minds that die at `/clear`. The
target layering should steal his property 1 wholesale.
