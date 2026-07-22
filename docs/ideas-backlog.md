# Ideas backlog

Things the owner wants to explore later — not scheduled, just don't lose them.

- **cmux vs tmux** (noted 2026-07-18): owner is committing to a terminal multiplexer for team sessions (replies/injection require it) but isn't attached to tmux specifically. Evaluate cmux as an alternative before building more tmux-coupled tooling. Today's coupling points: `team.sh` (tmux new-session), `inject_prompt.sh` (tmux send-keys), `team_map.json` (tmux target names), `panel-ws.ts` focus/kill actions.
- **Android wrapper app for the mobile page** (noted 2026-07-18): a thin WebView wrapper around the Room of Devs mobile page so it can use Android 17's floating-bubble multitasking ("turn your apps into floating bubbles over your main screen"). Would give a persistent floating room widget instead of a pinned Chrome tab. Needs: WebView + the mobile token baked into the start URL (Tailscale hostname), maybe notification integration for hand-raised events later.
- **Mobile lip-sync in expanded player** (noted 2026-07-18): drive the avatar's mouth frames from the karaoke alignment during phone playback, like the desktop panel's frame-swap lip-sync (docs/design-avatar-lipsync.md). Assets already exist per character (mouth-mid.png).
- **Donnie avatar art cleanup** (noted 2026-07-19): Donnie's current avatar image reads like he has a bird's beak — the nose/mouth area is drawn as a pointed yellow wedge that dominates the face. Regenerate or retouch the portrait so the face reads as a turtle (flatter snout, less pronounced point), keeping the purple mask, headphones, hoodie, and bo staff composition.
- **Cross-persona spawn race** (noted 2026-07-19, from gpt-5.6 code review): two different personas spawned near-simultaneously can both bind to the same new `~/.claude/sessions` file — `team.sh` picks "first new registry file since launch" with no pane↔session association. The v2.3 pending-persona set serializes same-persona spawns only. Fix direction: serialize the launch-to-bind phase globally (lock file), or match the registry entry's pid to the tmux pane's process tree.
- **Subagent-finish fires the room announce** (noted 2026-07-18, owner: "log for now"): when a Claude subagent completes, the Mac plays the "updates over here" notification — the afterAgentResponse hook doesn't distinguish subagent responses from main-loop ones. Investigate whether it also raises a hand. Fix direction: filter subagent events in the hook/ingest path.
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
  (≈ "Stage 2.5" of `docs/design-conversational-layer.md`). Sweet spot is
  hybrid: heavy work stays in background review rounds; the call is the
  sync point where agents present, disagree, and take live steering.
  Docs > voice for deep review rigor; voice wins for steering/debate.
