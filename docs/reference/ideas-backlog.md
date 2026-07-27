# Ideas backlog

Things the owner wants to explore later — not scheduled, just don't lose them.

- **cmux vs tmux** (noted 2026-07-18): owner is committing to a terminal multiplexer for team sessions (replies/injection require it) but isn't attached to tmux specifically. Evaluate cmux as an alternative before building more tmux-coupled tooling. Today's coupling points: `team.sh` (tmux new-session), `inject_prompt.sh` (tmux send-keys), `team_map.json` (tmux target names), `panel-ws.ts` focus/kill actions.
- **Android wrapper app for the mobile page** (noted 2026-07-18): a thin WebView wrapper around the Room of Devs mobile page so it can use Android 17's floating-bubble multitasking ("turn your apps into floating bubbles over your main screen"). Would give a persistent floating room widget instead of a pinned Chrome tab. Needs: WebView + the mobile token baked into the start URL (Tailscale hostname), maybe notification integration for hand-raised events later.
- **Mobile lip-sync in expanded player** (noted 2026-07-18): drive the avatar's mouth frames from the karaoke alignment during phone playback, like the desktop panel's frame-swap lip-sync (docs/shipped/design-avatar-lipsync.md). Assets already exist per character (mouth-mid.png).
- **Donnie avatar art cleanup** (noted 2026-07-19): Donnie's current avatar image reads like he has a bird's beak — the nose/mouth area is drawn as a pointed yellow wedge that dominates the face. Regenerate or retouch the portrait so the face reads as a turtle (flatter snout, less pronounced point), keeping the purple mask, headphones, hoodie, and bo staff composition.
- **Cross-persona spawn race** (noted 2026-07-19, from gpt-5.6 code review): two different personas spawned near-simultaneously can both bind to the same new `~/.claude/sessions` file — `team.sh` picks "first new registry file since launch" with no pane↔session association. The v2.3 pending-persona set serializes same-persona spawns only. Fix direction: serialize the launch-to-bind phase globally (lock file), or match the registry entry's pid to the tmux pane's process tree.
- **Subagent-finish fires the room announce** (noted 2026-07-18, owner: "log for now"): when a Claude subagent completes, the Mac plays the "updates over here" notification — the afterAgentResponse hook doesn't distinguish subagent responses from main-loop ones. Investigate whether it also raises a hand. Fix direction: filter subagent events in the hook/ingest path.
- **Clicky-style screen awareness** (noted 2026-07-25, long-term): open
  source "clicky" (https://github.com/farzaa/clicky; see also the
  contextdb friend's fork branch
  https://github.com/antiartificial/clicky/tree/agent/windows-clicky) —
  an AI helper that follows the mouse and explains what's on screen.
  Goal: move beyond mic-only interaction to screen context without
  manual screenshots — "hey Mikey, what am I looking at here, is this
  what I'm supposed to do?" Research the fork's updates when picked up.
- **Whiteboard mode: agent visualization** (noted 2026-07-25, stretch):
  agents only ever answer in text across all 12 concept boards. Idea:
  agents can draw — shadcn canvas component, or mermaid for quick
  diagrams — for "I don't understand, let's draw it out on the
  whiteboard." Moves the product from app-that-codes to teammate.
  (Distinct from attachments/typed input — that's an input-parity gap,
  tracked in spec-ui-consolidation-round2.md as a target requirement.)
- **Character packs** (noted 2026-07-25, solid future): personas as
  swappable packs — TMNT today; a friend installs and wants Star Wars.
  The tool ships a generation prompt describing every asset a pack
  needs (avatar art, mouth frames for lip-sync, accent color, persona
  blurb) + a config slot for an ElevenLabs voice id per character;
  packs rotate in and out. Also enables multiple owner packs.
- **Postplan hub-and-spokes** (noted 2026-07-24, owner thinking on it):
  `docs:publish` currently renders STATUS + all of `docs/active/` into ONE
  ever-growing draft (single stable URL was the original goal; single file
  is script path-dependence). Proposed shape: stable draft becomes
  STATUS-only (the index), each substantial spec publishes as its own post
  linked from it; script tracks a `doc → draft ID` map in
  `docs/.postplan-draft` instead of one ID so republishing updates
  in place. ~30 min in `scripts/` publish tooling. Revisit when the owner
  decides.
- **t3code borrowings** (noted 2026-07-23, from recon of
  https://github.com/pingdotgg/t3code — MIT, code legally borrowable; owner
  flagged it as "worth peeking"). t3code = open-source Node WS server
  wrapping local agent CLIs (Codex/Claude/Cursor/Grok) with React web +
  Electron + Expo mobile clients. No voice/audio anywhere — nobody else is
  doing our concept. Items, roughly by when they'd matter:
  - **Now-ish (Tailscale security round)**: their pairing-token auth —
    5-min single-use bootstrap token delivered in the URL *hash* (QR),
    exchanged for a session credential — beats our static token-in-URL
    forever. Also `packages/tailscale/src/tailscale.ts`: clean wrappers for
    `tailscale status --json` (MagicDNS/CGNAT-IP harvesting) and
    `tailscale serve` for HTTPS in front of the local port. HTTPS matters
    doubly: getUserMedia (phone push-to-talk mic, conversational-layer
    Stage 4) requires a secure context, and it enables PWA install.
  - **Conversational layer Stage 1**: their `CanonicalItemType` pattern —
    normalize all provider events into a small closed vocabulary
    (assistant_message / reasoning / plan / tool lifecycle / approval /
    error) and route on type. Good shape for the rule-router's event
    classification (never narrate `reasoning`, always surface approvals).
  - **Spike-worthy**: they drive Claude via `@anthropic-ai/claude-agent-sdk`
    `query()` with resume/interrupt/canUseTool — no tmux, no transcript
    scraping (`apps/server/src/provider/Layers/ClaudeAdapter.ts`). Quiet
    argument that our tmux layer is the legacy path for non-interactive
    asks; feeds the cmux-vs-tmux question above.
  - **Later**: git-ref checkpoints per turn ("undo what the agent did"
    from the phone); APNs Live Activities via a thin hosted relay
    (lock-screen agent status); ACP (`packages/effect-acp`) for driving
    Cursor/Grok as sessions if non-Claude agents join the room; their
    reconnect state machine docs (`docs/architecture/connection-runtime.md`)
    as a checklist to diff room-client against.
- **Multi-agent call / conference mode** (noted 2026-07-21): bring multiple
  agents onto the live call as named participants (e.g. Mikey = session
  lead, Donnie = gpt, Raph = grok) so the owner can address them by name
  ("Raph, how does your plan compare with Donnie's?") and agents respond in
  their character voices — including reacting to *each other*. Most plumbing
  already exists: per-persona voices, call view + threads, reply injection
  into named tmux sessions, spoken-name floor resolution in `voice.ts`, and
  the serialized audio floor (natural turn-taking primitive). Missing
  pieces: a cross-agent fan-out policy in the daemon (inject "[Raph]: …"
  summaries — never full transcripts — into other agents' sessions with
  attribution) and the interpreter routing who's addressed
  (≈ "Stage 2.5" of `docs/active/design-conversational-layer.md`). Sweet spot is
  hybrid: heavy work stays in background review rounds; the call is the
  sync point where agents present, disagree, and take live steering.
  Docs > voice for deep review rigor; voice wins for steering/debate.
- **Operator gates spoken by the room** (noted 2026-07-27, from the
  Ptheory framework exchange — see
  `reference/agentic-workflow-notes.md`): when a build round runs with
  review gates (operator-style contract review, blocked waves, decisions
  needing ratification), those structured findings are the ideal payload
  for the voice layer — spoken interrupts ("Operator blocked wave 3:
  test evidence doesn't reproduce — send it back?") with signoff
  collected by PTT/interpreter. The room becomes the ambient surfacing
  layer above the build loop; pairs with ceremony-mode work if the
  contract-gig lane firms up.
