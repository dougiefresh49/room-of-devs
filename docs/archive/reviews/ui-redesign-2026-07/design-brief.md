# Design brief — Room of Devs UI redesign concept (blind pass)

You are one of four designers independently producing a redesign concept
board for "Room of Devs." Yours must be a genuine alternative, not a
refinement of what exists — you are deliberately NOT shown the current UI.

**Do NOT open the existing UI source** (panel/src, packages/mobile/src,
packages/ui/src) or any screenshots. This brief is your complete spec.
Do NOT make any network/API calls.

## The product

A personal macOS + phone tool that turns AI coding agents (Claude Code
sessions) into a "room of devs" with character voices. Each session
appears as a persona card; when an agent finishes a turn, its response is
rewritten into character voice and read aloud (ElevenLabs) on the Mac or
streamed to the phone. The user can reply from the phone, grant
push-to-talk, and enable a live "call" mode that narrates intermediate
progress. Family-of-one software: playful, personal, but a real daily
tool — a dev den, not a toy.

**Personas**: the TMNT cast & co. — Leonardo (blue, the leader),
Donatello (purple, the engineer), Michelangelo (orange, the wildcard),
Raphael (red, the hothead), plus occasional guests. Each has avatar art
(with mouth frames for lip-sync), a voice, and an accent color. The
characters ARE the product's personality — the design should celebrate
them without becoming a cartoon.

## Surfaces to design (mock every one)

1. **Desktop panel, main window** (~900×640, resizable): the Room. A
   grid/list of agent cards. Each card: avatar (lip-syncs while
   speaking), name (nicknamable), state, chips (hand-raised count,
   superseded count, "on phone", live badge, muted), a queued-message
   preview when hand is raised, and per-agent actions: pause/stop/replay
   speech, replay-slower, status info, focus terminal, kill (with
   confirm), swap persona. Holding a card grants push-to-talk (mic goes
   live to that agent) — design the grant affordance + active-PTT state.
   Also: a header/status strip (connection, room pause/hold, current
   mode), and a summary pane showing the most recent spoken summary
   (markdown).
2. **Desktop dock/spotlight** (small always-on-top strip, ~380×150,
   floats over other apps, must not steal focus): shows the currently
   speaking agent — avatar, caption bubble with the live summary text,
   compact transport (pause/stop/replay), and PTT. This is what the user
   glances at while working in another app. Design its collapsed +
   speaking states.
3. **Phone room** (390×720): the same room on the phone — cards with
   grant/chat/hide/replay actions, device toggle (play audio on Mac vs
   phone), hold-room, catch-up on unheard messages, toasts.
4. **Phone player**: mini-player (persistent strip) + expanded player
   sheet: play/pause/stop, playback speed, karaoke-style line
   highlighting of the transcript as audio plays.
5. **Phone chat/call**: per-agent thread view (message bubbles, replay a
   message, composer to reply to the agent) and a live "call" mode
   (think voice-call screen: large avatar, live narration captions,
   mute/hold/end). New hotness to showcase: the voice interpreter — the
   user holds PTT and says "pause the room, then replay Donnie's last
   message"; the system builds a small command plan and executes it.
   Design how an executed plan renders (steps with outcomes — think
   chain-of-thought / step list).
6. **Picker (both platforms)**: spawn a New session or Resume one:
   choose persona, project folder, model, flags (skip-permissions,
   remote), then an explicit confirm ("Start Donnie · sonnet ·
   jellyfin-streamline"). Desktop = window view; phone = sheet.

## Agent states (the core visual system)

idle · working (agent is thinking/coding) · speaking (audio playing —
lip-sync, most prominent state) · hand-raised (finished, message queued,
wants attention; shows preview) · asking (needs a decision) ·
disconnected/stale · muted. Plus room-level: paused/held, live mode on.
State must read at a glance across a wall of cards; semantic state
colors are separate from persona accent colors.

## Constraints (hard)

- Tech target: React 19 + Tailwind v4 + **shadcn/ui** (vendored into a
  shared package). Registry-first: compose from shadcn primitives
  (Button, Card, Sheet, Dialog, DropdownMenu, Popover, Tooltip, Toast/
  sonner, ToggleGroup, Tabs, Badge, Avatar, ScrollArea, Slider…) and
  shadcn **AI Elements** (Conversation, Message, PromptInput,
  ChainOfThought, Reasoning, Task) where they fit. Custom UI only where
  the domain demands it (avatars/lip-sync, PTT, karaoke). Name the
  shadcn components you're mapping to in your rationale.
- Avatar lip-sync swaps image frames ~70ms outside React — the avatar
  must remain a plain <img> that can frame-swap; design around that.
- The dock floats non-activating (interacting must not steal keyboard
  focus from the user's active app) — no text inputs there.
- Phone is used one-handed; primary actions in thumb reach.
- Dark-first (it lives in a dev's periphery all day); a light theme may
  exist but design and show dark as primary.
- Semantic state colors + per-persona accent both exist; keep them from
  fighting.

## Deliverable — one self-contained HTML file

Write EXACTLY ONE file to the output path you were given.

- Fully self-contained: inline CSS, no external requests (no CDNs, no
  webfonts, no remote images). System font stacks. Draw avatars as
  simple placeholder art (initials in persona-colored circles is fine —
  do NOT try to draw turtles in SVG).
- Static concept board (light vanilla JS allowed but not required).
  Must render correctly opened directly in a browser and on a phone
  (max-width responsive, no horizontal page scroll).
- Structure: (1) Thesis — your design's point of view in 2-3 sentences;
  (2) Tokens — palette swatches with hex + type scale + spacing/radius
  philosophy; (3) The six surfaces above as framed mockup screens at
  roughly realistic proportions, with real sample content (persona
  names, plausible dev-work summaries — never lorem ipsum); (4)
  Rationale — key decisions, the shadcn/AI-Elements mapping table, what
  you'd cut or add vs the feature list and why.
- Show at least: one card in each major state, the dock while speaking,
  the interpreter plan rendering, and the picker confirm step.
- Real copy is design material: microcopy should sound like this
  product (a dev room with personality), not like enterprise SaaS.

Be opinionated. A distinct, coherent point of view beats safe coverage.
