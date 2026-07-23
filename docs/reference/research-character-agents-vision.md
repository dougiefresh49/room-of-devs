# Character Agents Vision: Research & Ideas

*Research compiled 2026-05-20*

---

## 1. Skip Gemini for Personality — Let Claude Be the Character

### The Caveman Approach

There's a Claude Code plugin called **[caveman](https://github.com/JuliusBrussee/caveman)** by Julius Brussee that proves this pattern works. It's a SKILL.md file that injects style instructions into Claude's system prompt. Claude follows it consistently across turns without drift.

Install: `claude plugin marketplace add JuliusBrussee/caveman && claude plugin install caveman@caveman`

Key design patterns worth stealing:
- **Intensity levels** — lite, full, ultra (we could do: casual, full-character, aggressive)
- **Auto-Clarity safety valve** — automatically breaks character for security warnings, irreversible ops, ambiguous multi-step sequences, then resumes character after
- **Boundaries** — code blocks, commits, PRs stay normal; only conversational text gets the treatment

### How We Could Use This

Instead of the current pipeline:

```
Claude (generic) → Gemini (add personality) → ElevenLabs (voice)
```

We could do:

```
Claude (already in-character) → Gemini (just add audio tags) → ElevenLabs (voice)
```

Or even:

```
Claude (in-character + audio tags) → ElevenLabs (voice)
```

**Implementation:** Create per-character CLAUDE.md snippets or skill files. When a session voice is set to Donatello, inject Donatello's persona into the session context. Claude's raw output is already in-character, so Gemini only needs to:
1. Strip code blocks and markdown
2. Add ElevenLabs audio tags (`[sighs]`, `[excited]`, emphasis via CAPS)
3. Truncate to TTS length

This cuts Gemini's job from "rewrite everything in character" to "just format for TTS" — cheaper, faster, and more consistent since Claude has full conversation context that Gemini doesn't.

**Per-session skill files could live at:**
- `~/.claude/skills/characters/donatello.md`
- `~/.claude/skills/characters/raphael.md`
- `~/.claude/skills/characters/karai.md`

**Trade-off:** Claude's output in the terminal will also be in-character. If Donnie says "Technically speaking, I've already identified the race condition in the useAuth hook..." that's fun but slightly less scannable than normal output. The caveman auto-clarity pattern solves this — break character for anything safety-critical.

---

## 2. ElevenLabs Conversational AI (ElevenAgents)

### What It Is

Full pipeline voice agents: STT → LLM reasoning → TTS in a single managed service over bi-directional WebSocket. This is the "discord call with your dev team" vision.

### Key Details

| Feature | Details |
|---------|---------|
| **Latency** | Sub-100ms TTS. ~400ms end-to-end on Turbo tier |
| **Tool integration** | Server tools (webhooks) and client tools (browser-side). You define endpoints the agent can call mid-conversation |
| **Multi-agent** | Each agent is independent. Multiple concurrent sessions supported |
| **SDKs** | Python, TypeScript, Swift, Kotlin, Flutter |
| **Pricing** | ~$0.08-0.12/min depending on tier. 95% discount for silence >10s. LLM costs separate |

### How It Maps to Our Vision

The "yo Mikey, where we at with that fix?" interaction = an ElevenLabs agent with:
- Custom voice (Mikey's cloned voice)
- Server tools that wrap Claude Code CLI commands (`claude /status`, `claude /btw`, etc.)
- Persona prompt for in-character responses

**Architecture:**
```
You (mic) → ElevenLabs Agent (Mikey)
  → STT: "yo Mikey where we at with that fix"
  → LLM: determines intent = check status
  → Server Tool: calls local endpoint that runs `claude /status` on Mikey's session
  → LLM: wraps response in character
  → TTS: Mikey's voice streams back
```

**For multi-agent (Mikey + Donnie + Raph):**
- Each turtle is a separate ElevenLabs agent instance
- A router/coordinator listens for name-based attention ("yo Mikey" vs "Donnie, status?")
- Agents can also proactively speak when their session completes (Stop hook → agent speaks)

**Docs:**
- [Server tools](https://elevenlabs.io/docs/conversational-ai/customization/tools/server-tools)
- [Client tools](https://elevenlabs.io/docs/conversational-ai/customization/tools/client-tools)
- [ElevenAgents overview](https://elevenlabs.io/docs/eleven-agents/overview)

---

## 3. Gemini 3.1 Flash Live API

### What It Is

Bi-directional WebSocket streaming API for real-time multimodal interaction. Raw 16-bit PCM audio in, audio out. The model reasons directly on audio tokens — no separate STT/TTS step.

### Key Details

| Feature | Details |
|---------|---------|
| **Input** | Raw 16kHz PCM audio, video, text — simultaneously |
| **Output** | PCM audio + text, streamed |
| **Latency** | Significantly lower than STT→LLM→TTS chain. ~25 audio tokens/sec |
| **Interruptions** | Built-in mid-sentence interrupt handling and turn-taking |
| **Pricing** | Free during preview (`gemini-3.1-flash-live-preview`). GA pricing TBD, but Flash models are ~$0.045-0.15/M tokens |

### How It Compares

| | Current Pipeline | Gemini Live | ElevenLabs Agent |
|---|---|---|---|
| **Voice quality** | Best (ElevenLabs custom voices) | Lower (Gemini native) | Best (ElevenLabs custom voices) |
| **Latency** | ~1-2s (Gemini + ElevenLabs) | ~200ms | ~400ms |
| **Character consistency** | Good (Gemini prompt) | Good (system prompt) | Good (agent prompt) |
| **Cost** | Gemini tokens + ElevenLabs chars | Just Gemini tokens | ~$0.08-0.12/min + LLM |
| **Custom voices** | Yes | No (limited built-in) | Yes |

**Verdict:** Gemini Live is great for latency and cost, but lacks custom voice support. For the TMNT character experience, ElevenLabs custom voices are essential. Gemini Live would work well as the "brain" with ElevenLabs as the "mouth" — but that's essentially what ElevenLabs Conversational AI already does.

**Docs:**
- [Live API overview](https://ai.google.dev/gemini-api/docs/live-api)
- [Getting started](https://ai.google.dev/gemini-api/docs/multimodal-live)

---

## 4. Multi-Agent Voice Coordination

### LiveKit Agents (Most Promising)

Open-source WebRTC framework. Used by OpenAI for ChatGPT Voice, Meta, and Character.ai.

- **Rooms:** Multiple agents join the same "room" — natural multi-agent coordination
- **Turn detection:** Semantic transformer model detects when a user finishes speaking (not just silence threshold)
- **MCP support:** Native MCP tool support — directly relevant to Claude Code integration
- **Telephony:** Built-in SIP, no Twilio bridge needed
- [GitHub](https://github.com/livekit/agents) / [Docs](https://docs.livekit.io/agents/)

### The Discord Call Architecture

```
┌─────────────────────────────────────────────┐
│              LiveKit Room                    │
│                                              │
│  You (mic) ─────► Router Agent               │
│       ▲           │                          │
│       │     ┌─────┼──────┬──────────┐        │
│       │     ▼     ▼      ▼          ▼        │
│       │   Mikey  Donnie  Raph    Karai       │
│       │   Agent  Agent   Agent   Agent       │
│       │     │     │      │          │        │
│       │     ▼     ▼      ▼          ▼        │
│       │  Claude  Claude  Claude  Claude      │
│       │  Sess 1  Sess 2  Sess 3  Sess 4     │
│       │     │     │      │          │        │
│       └─────┴─────┴──────┴──────────┘        │
│            (audio responses)                 │
└─────────────────────────────────────────────┘
```

**How turn-taking would work:**
- **Name-based routing:** "yo Mikey" → router sends to Mikey agent
- **Proactive updates:** When a Claude session's Stop hook fires, the agent announces: "ok I got that fix, ready for me to lay it on you?"
- **Inter-agent awareness:** Agents share a state bus. Mikey knows Donnie's PR is pending. "Just waiting on Donnie to finish up that streaming update"
- **Interrupt protocol:** If you speak while an agent is talking, the router decides: is this directed at the current speaker or someone else?

**Research references:**
- [Open Voice Interoperability research paper](https://arxiv.org/pdf/2411.05828) — defines Convener Agent, Floor Manager, Floor-Shared Conversational Space
- [Murder Mystery Agents (Frontiers)](https://www.frontiersin.org/journals/artificial-intelligence/articles/10.3389/frai.2025.1582287/full) — adjacency pair model for multi-party AI turn-taking

### Vapi (Commercial Alternative)

- "Squads" feature chains multiple specialized agents with handoffs
- $0.05/min orchestration + $0.07-0.25/min with services
- More enterprise/telephony focused
- [vapi.ai/pricing](https://vapi.ai/pricing)

---

## 5. Avatar / Visual Representation

### Lightest Path: Live2D in Browser

A Live2D model rendered in a web canvas, driven by WebSocket agent state events. No game engine needed.

**[Open-LLM-VTuber](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber)** — the most complete open-source solution:
- 7+ ASR providers, 18+ TTS providers, 12+ LLM backends
- Live2D avatar with expression control and lip-sync
- MCP tool calling support
- Runs locally on macOS/Windows/Linux
- MIT licensed

### Other Options

| Tech | Type | Weight | Notes |
|------|------|--------|-------|
| **Live2D Cubism** | 2D rigged illustrations | ~2MB models | Expressions, mouth, idle states map directly to agent states |
| **Three.js + VRM** | 3D in browser | ~10-50MB | Blend shapes for emotions, visemes for lip-sync |
| **React Three Fiber** | Three.js React wrapper | Medium | Declarative state mapping is natural in React |
| **Ready Player Me** | 3D avatar generator | Medium | Generates VRM/GLB models for Three.js |
| **[TalkingHead](https://github.com/met4citizen/TalkingHead)** | JS class, 3D lip-sync | Light | Built-in browser TTS via WebGPU |
| **[Avatoon](https://github.com/khaledalam/avatoon)** | React Three Fiber | Light | Viseme lip-sync, head motion, idle animations |
| **[Persona Engine](https://github.com/fagenorn/handcrafted-persona-engine)** | Live2D + LLM + TTS | Medium | Phoneme lip-sync, emotion-triggered expressions |

### Agent State → Avatar Mapping

```
Agent State        → Avatar Behavior
─────────────────────────────────────
idle               → breathing loop, small sway
thinking           → eyes up, slight head tilt, hand on chin
working/typing     → looking at screen, hands on keyboard
talking            → viseme lip-sync from TTS audio + speaking expression
listening          → attentive expression, slight head tracking toward speaker
excited            → wider eyes, faster movements
frustrated         → furrowed brow, crossed arms
```

### The Sewer HQ Vision

An Electron or web app showing:
- A 2D/3D environment (the sewer lair)
- Each turtle at their station (Donnie at computers, Mikey on the couch, etc.)
- When an agent is working: typing animation at their station
- When speaking: character turns to camera, lip-syncs
- When idle: ambient idle animations (Mikey eating pizza, Raph punching bag)
- Audio from LiveKit room plays through the app

This is buildable with Three.js + React Three Fiber + Live2D models. The heaviest part is creating the character models and environment art, not the tech.

---

## 6. Proposed Evolution Path

### Phase 1: Claude-Native Personas (Low effort, immediate value)
- Create per-character CLAUDE.md/skill files
- Claude outputs already in-character
- Gemini role reduced to "format for TTS + add audio tags"
- Saves Gemini tokens and improves consistency

### Phase 2: Dynamic Voice Interaction (Medium effort)
- ElevenLabs Conversational AI agents per character
- Push-to-talk hotkey routes to character by name
- Agents can call Claude Code CLI via server tools
- Proactive announcements on Stop hook ("pr is up, dude!")

### Phase 3: Multi-Agent Coordination (High effort)
- LiveKit room with multiple agent participants
- Inter-agent awareness (shared state bus)
- Turn-taking and interrupt handling
- "Discord call with your dev team" experience

### Phase 4: Visual Avatars (Fun, medium effort)
- Electron/web app with Live2D or Three.js characters
- Agent state drives avatar behavior
- Environment art (sewer lair, Halo base, etc.) per theme
- Could start with simple 2D and evolve to 3D

---

## 7. Follow-Up Research (2026-05-21)

### Wispr Flow — Can We Hook Into It?

**No public API or SDK.** Wispr Flow is a closed macOS dictation app ($15/mo). It works system-wide via accessibility APIs but doesn't expose transcription output to other apps programmatically. No webhooks, no clipboard hooks, no file-based transcript access. Their developer page just lists app integrations (Cursor, VS Code, etc.) — it types into whatever app has focus, that's it.

**Local STT Alternatives (ranked for our use case):**

| Tool | Type | Push-to-Talk | Speed | Cost |
|------|------|-------------|-------|------|
| **Superwhisper** | macOS native app | Yes (Option-Space) | Real-time | $249.99 lifetime |
| **whisper.cpp** | C++ library | DIY | 7-33x real-time on Metal | Free |
| **MacWhisper** | macOS app | No (file transcription) | Batch | €59 lifetime |

**Recommendation:** Superwhisper is the best drop-in for push-to-talk dictation on macOS. For a custom integration (Phase 2/3), whisper.cpp compiled with Metal gives us full control and runs fast on Apple Silicon.

### Hermes Agent — Local Intent Router

**Hermes Agent** by NousResearch is now #1 on OpenRouter's global rankings (as of May 2026). It runs locally via Ollama and supports structured tool calling out of the box.

**Architecture for our use case:**
```
Superwhisper/whisper.cpp (STT)
    → Hermes 3 via Ollama (intent classification)
        → "yo Mikey, check that bug" → {agent: "mikey", action: "status", session: 1}
    → Route to correct Claude Code session
    → Response via ElevenLabs TTS
```

**Key details:**
- Three-tier architecture: UI → core agent logic → execution backends
- Bridges "Natural Language Space" (user intent) to "Code Entity Space" (tool execution)
- Runs locally — no cloud dependency for the routing layer
- Known issue: can hang with tool definitions on some Ollama versions (GitHub issue #25629)

**Trade-off vs ElevenLabs agents:** ElevenLabs agents bundle STT+LLM+TTS but bill by connection minute. Hermes locally is free for the routing, and we only pay ElevenLabs for TTS output — significantly cheaper for always-on scenarios.

### ElevenLabs Agent Minutes — How Billing Works

- **Wall-clock connection time** — billed from when the call starts to when it ends or the window closes
- **95% silence discount** — periods of silence longer than 10 seconds are billed at 5% of the normal rate
- **Plans:** Starter (250 min), Creator (500 min), Pro (2000 min), Scale (11k min)
- **Overages:** ~$0.07-0.12/min depending on plan tier
- **LLM costs are separate** — if using their hosted LLM, that's additional

**Verdict:** For an always-on "dev team voice channel," even with the silence discount, agent minutes add up. Better to use ElevenLabs for TTS only ($0.18/1000 chars on Starter) and handle STT + routing locally.

### What ElevenLabs Voice Agents Actually Are

Yes, they're literally STT → LLM → TTS with tool calling, but with good engineering:
- Managed WebSocket connection handling bi-directional audio
- Built-in turn detection and interruption handling
- Server tools (webhooks) and client tools (browser-side)
- Latency optimization (~400ms end-to-end)

**What we'd lose building it ourselves:** Turn detection quality, interrupt handling, and the tight latency optimization. What we'd gain: no per-minute billing, full control over routing, and the ability to use local models for intent classification.

### Voice Cloning — Open Source Options

| Model | Clone Quality | Speed | Voice Cloning | License |
|-------|-------------|-------|---------------|---------|
| **Chatterbox** (Resemble AI) | Best (MOS ~4.5) | Real-time | 1-sec reference clip | Apache 2.0 |
| **F5-TTS** | Great | 7-33x real-time | 10-sec reference | MIT |
| **Fish Speech** | Good (MOS 4.1) | Real-time | Reference audio | Apache 2.0 |
| **Kokoro** | Good | 36x real-time | No cloning (preset voices) | Apache 2.0 |
| **GPT-SoVITS** | Good | Moderate | 1-min fine-tune, 5-sec zero-shot | MIT |

**Chatterbox** is the standout — SoTA quality, Apache 2.0, zero-shot from 1 second of audio, 23 languages. Has a Turbo variant for even faster inference. If we ever want to drop ElevenLabs for cost reasons, Chatterbox running locally on Apple Silicon is the move.

### Visual Novel Dialog Style — Lightest Path

For the "character portrait + speech bubble" overlay idea:

**Best options:**
- **WebGAL** — Web-based visual novel engine, MPL-2.0, Pixi.js effects, visual editor. Could embed as an Electron overlay.
- **Tuesday JS** — Minimal JS visual novel engine, runs in browser, MIT licensed. Extremely lightweight.
- **Custom React component** — Honestly the simplest path. A `<DialogBox>` component with: character portrait (left), name plate, text area with typewriter effect, driven by WebSocket events from the TTS server.

**For Phase 4, the custom React approach wins** — we don't need branching narrative or save/load. We just need: show character portrait, animate text as it's spoken, hide when done.

### 3D Character Generation — Meshy.ai & Alternatives

| Tool | Input | Output | Quality | Pricing |
|------|-------|--------|---------|---------|
| **Meshy.ai** | Image/text → 3D | GLB/FBX/OBJ | Good | Free tier, $20/mo pro |
| **Tripo3D** | Image → 3D | GLB/FBX | Good | Free tier available |
| **Rodin AI** | Image → 3D | Various | High | API-based |
| **TRELLIS** | Image → 3D | GLB | High | Open source |

Meshy exports GLB directly compatible with Three.js / React Three Fiber. There are tutorials showing the exact Meshy → React Three Fiber pipeline (including multiple animation support). For TMNT characters, the workflow would be: character art → Meshy image-to-3D → export GLB → load in React Three Fiber → drive animations from agent state.

### Avatar Creation Pipeline

**2D (easiest):**
1. Draw character with separate layers (eyes, mouth, hair, body) in Photoshop/Clip Studio
2. Rig in Live2D Cubism (free tier or $54/year) — add deformers, physics
3. Export to VTube Studio or embed via pixi-live2d-display in browser
4. **Inochi2D** is a free open-source alternative to Live2D (less polished)

**3D:**
1. Generate in Meshy.ai from character art or use VRoid Studio (free, anime-style)
2. Export as VRM/GLB
3. Load in React Three Fiber with blend shapes for expressions
4. Drive visemes from TTS audio for lip-sync

### ContextDB — Temporal Knowledge Graph

**What:** A graph-vector database with epistemics — facts have expiration dates, source credibility (Bayesian), memory decay rates, and conflict detection.

**Interesting for us because:** Multi-agent systems need shared state that ages. "Mikey fixed the auth bug" is true now but stale next week. ContextDB tracks when facts were true vs when the system learned them.

**SDKs:** Go, Python, TypeScript (gRPC + REST). Backends: in-memory, Postgres+pgvector, Qdrant, Redis.

**Verdict:** Overkill for Phase 2-3 but worth revisiting for Phase 3's "inter-agent awareness" feature where agents need to know what other agents have done.

### Multi-Agent @ Tagging — Claude Code Already Has This

Claude Code has built-in **Agent Teams** orchestration via the `SendMessage` tool:
- Sessions can send messages to each other
- Supports orchestrator patterns (one main agent delegates to specialists)
- Uses tmux under the hood for session management

**Related projects found:**
- **AgentWire-Dev** — Self-hosted web portal for voice-controlling local and remote AI coding agents via tmux. Push-to-talk from browser, Whisper STT, Chatterbox/Qwen3 TTS. **This is the closest thing to what we're building.** `pip install agentwire-dev`
- **Agent of Empires (AoE)** — Terminal dispatch panel, runs agents in tmux sessions with git worktree isolation
- **TMAI** — Multi-agent interface for monitoring/controlling Claude Code sessions in tmux
- **Agent Deck** — Terminal session manager TUI for multiple AI coding agents

### Prior Art — Voice-Controlled AI Coding

**AgentWire-Dev** is the most direct competitor/inspiration. Key differences from our project:
- They use local TTS (Chatterbox/Qwen3), we use ElevenLabs (higher quality, cloned voices)
- They don't have character personas
- They don't have visual avatars
- They're Python-based, we're TypeScript/bash
- They have multi-machine SSH support (we don't yet)

**Our differentiators:** Character personas with custom cloned voices, the visual avatar roadmap, and the SwiftBar menu bar integration for always-on monitoring.

---

## Key Links

- [Caveman plugin](https://github.com/JuliusBrussee/caveman)
- [ElevenLabs Conversational AI](https://elevenlabs.io/conversational-ai)
- [ElevenAgents docs](https://elevenlabs.io/docs/eleven-agents/overview)
- [Gemini Live API](https://ai.google.dev/gemini-api/docs/live-api)
- [LiveKit Agents](https://github.com/livekit/agents)
- [Open-LLM-VTuber](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber)
- [TalkingHead](https://github.com/met4citizen/TalkingHead)
- [Persona Engine](https://github.com/fagenorn/handcrafted-persona-engine)
- [AgentWire-Dev](https://github.com/dotdevdotdev/agentwire-dev) — closest prior art for voice-controlled multi-agent coding
- [Hermes Agent](https://github.com/NousResearch/hermes-agent) — local intent routing
- [Chatterbox TTS](https://github.com/resemble-ai/chatterbox) — SoTA open-source voice cloning
- [ContextDB](https://github.com/antiartificial/contextdb) — temporal knowledge graph for agent memory
- [WebGAL](https://github.com/OpenWebGAL/WebGAL) — web visual novel engine
- [Meshy.ai](https://www.meshy.ai/) — AI image-to-3D generation
- [Superwhisper](https://superwhisper.com/) — macOS push-to-talk STT
