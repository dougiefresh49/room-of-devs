# Voicebox MCP study — what to steal for room-of-devs (2026-08-20)

Companion to [voice-lab-local-tts-postmortem.md](voice-lab-local-tts-postmortem.md).
Researched from jamiepine/voicebox source + docs (opus subagent, sources at
bottom). Voicebox's local TTS lost the audio bake-off, but its
agent-integration design is worth mining. Verdict in one line: **keep our
hook-push as the primary path (their pull design has zero coverage
guarantees and zero spend gates), but several mechanisms are directly
liftable.**

## How theirs works

- FastMCP mounted at `/mcp` on the same server (port 17493, loopback, no
  auth), Streamable HTTP; an 18MB PyInstaller stdio shim proxies
  stdio-only clients.
- Tools: `voicebox.speak(text, profile?, engine?, personality?, …)` →
  fire-and-forget `{generation_id, poll_url}`; `voicebox.transcribe`
  (with `audio_path` gated to loopback callers via request-context check);
  `voicebox.list_profiles()` incl. `has_personality`; `list_captures`.
- **Client identity**: client self-declares `X-Voicebox-Client-Id` in its
  own MCP config; middleware auto-creates a binding row on first sight and
  stamps `last_seen_at` off the response path. Binding = client_id →
  profile + default engine + personality on/off, CRUD + copy-paste install
  snippets + live "connected" indicator in Settings.
- **Resolution precedence**: explicit arg → per-client binding → global
  default → **hard error** (explicit-but-not-found never silently falls
  back). Same chain for engine/personality.
- **Personas**: ≤2000-char free text; one shared local Qwen3 does
  `compose` (no input, temp 0.9, fresh in-character line) and `rewrite`
  (temp 0.3, "restate every idea, add nothing, drop nothing, don't reply
  to the text"). Short framing block on purpose (small models degrade on
  long system prompts): never break character, **no stage directions /
  action tags / quotes / code fences** (TTS reads them literally), match
  register (curt → curt, swears → swear).
- Serial GPU queue with **cancel-at-dequeue** (cancelled ids checked when
  a job pops; coroutine closed before it starts).
- No lifecycle hooks at all — if the agent doesn't call the tool, silence.
  Trust surface is a native "speaking pill" fed by an in-memory pub/sub →
  SSE → Rust monitor; invariants: last-speak-wins teardown keyed on
  generation id, 60s watchdog, server end-event advisory while
  `audio.ended` is authoritative.

## Steal list (ranked value/effort)

1. **Self-declared client-id header + auto-registered bindings with
   `last_seen_at`** — gives a panel table of "agents that have spoken to
   me + when" that doubles as install verification. Debounce the stamp
   write; path-boundary check on which routes stamp.
2. **Strict resolution chain** (explicit → binding → default → hard
   error): lift verbatim for persona resolution; silent fallback to the
   wrong persona is worse than failing.
3. **`POST /speak` REST mirror on the same code path as the MCP tool** —
   how codex/cursor-agent/CI get a voice with zero client support.
   Must share ingest dedup + mute gates with the queue watcher. Strictly
   more useful than `enqueue_manual.sh`.
4. **Two-temperature persona modes + speech-only framing** for
   `gemini.ts`/`dynamic-response.ts`: split cold *rewrite* ("restate
   every idea, add nothing, drop nothing, do not reply to the text") from
   hot *compose* (zero-input in-character line — unlocks idle barks);
   explicit anti-stage-direction rule; register matching; keep framing
   short.
5. **`room_speak` MCP tool as a SUPPLEMENT to hooks** (underscore name —
   dotted `voicebox.speak` broke Claude Desktop's tool-name regex, their
   #790). All existing spend gates run in front (dedup, mute, claim
   markers, per-client rate cap). Credible replacement for live-tail
   transcript scraping on cooperating agents: deliberate narration
   instead of scraped intermediates + hold-one buffer. Put billing
   guidance in the tool description itself.
6. **Cancel-at-dequeue**: mute/stop should mark queued items so they drop
   at dequeue BEFORE Gemini — retroactive refund of pending spend.
7. **Playback invariants** for mobile `controller.ts` / panel:
   last-speak-wins keyed on generation id (guard late `ended` from the
   previous clip), hard watchdog, server end-event advisory vs element
   `ended` authoritative.
8. **`room_list_personas` discovery tool** (debug flow: list first, then
   speak).
9. **Pre-clean text before the LLM** (collapse repetitive artifacts).
10. **Loopback-gate dangerous args via request address, deny-on-unknown**
    (relevant to the open Tailscale/den-WS item; their #778 is a
    DNS-rebinding/Host-header exposure on a local API — check our daemon's
    Host validation).
11. **Copy-paste MCP install snippets in the panel** with client-id
    pre-filled.

## Anti-steal (we're already better — don't regress)

- Push beats pull for coverage: hooks can't be forgotten by the model.
  MCP is additive, never a replacement.
- They have zero dedup/rate-limit/auth — fine for free local inference,
  fatal for an ElevenLabs bill. Never expose a bare speak primitive.
- Playback stays in the daemon (`ffplay`/`afplay`), not a UI window —
  theirs depends on the desktop app being up + autoplay policy.
- Our multi-destination routing (speaker-gate/phone/handoff) and the
  two-way reply loop (`inject_prompt.sh`, call mode) have no equivalent.
- Cautionary tale (their #637): frontend guarded autoplay on
  `source ∈ {mcp,rest}` but the backend never wrote that value — writer
  and consumer of a new state field must land in the same change (applies
  to any origin field we add to `.now-playing.json`/replay sidecars).

Sources: voicebox `docs/content/docs/overview/{mcp-server,voice-personalities}.mdx`,
`docs/plans/MCP_SERVER.md`, `backend/mcp_server/*`, `backend/routes/{speak,mcp_bindings,generations}.py`,
`backend/services/{personality,task_queue,generation}.py`,
`app/src/components/DictateWindow/DictateWindow.tsx`; issues #637, #778, #790.
