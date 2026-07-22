# Behavior baseline checklist — UI refactor (captured 2026-07-22, Phase 0)

Screenshots + per-capture observations: this directory (`01-…18-….png`,
`notes.md`, captured by codex/gpt-5.6 with zero billable actions). This
checklist is the parity contract: every later refactor phase must keep each
item behaving as described, or document the deliberate change.

Legend: ☑ captured with screenshot · ◐ observed/asserted, no dedicated shot ·
✗ not captured (gap to fill when cheap/safe).

## Desktop panel (Room.app)

- ☑ **Room grid** — one card per session; states shown: hand_raised (yellow
  hand badge + queue count, blue accent), working (amber dot/border), idle.
  NOTE the color semantics here — post-refactor the owner decision flips to
  working=amber, hand_raised=blue **consistently on both platforms** with the
  mobile green accent (`#3ecf8e`).
- ☑ **Card actions** — 5 compact icon actions per card; team-only actions
  (terminal, end session) visibly dimmed on non-team agents; speak status,
  replay-last, swap character available; grant via card primary action.
- ☑ **Transport footer** — pause, stop, replay-last, hold-room.
- ☑ **Pause/resume** — pause toggles to "Resume playback", room presentation
  otherwise stable; resume flips it back; replay continues.
- ☑ **Dock mode** — collapses to bottom avatar pill (6 avatars, queue-count
  bubbles, captions toggle, expand chevron); state colors preserved on avatar
  rings; hover expands avatar with horizontal action strip (same disabled
  rules); expand chevron returns to full room.
- ☑ **Speaking state** — wordmark animates during playback (cached replay);
  card badges unchanged during replay of an idle agent's message.
- ☑ **Picker (New)** — recent folders, persona launch avatars, flags
  ("Skip permission prompts", "Remote control"), model dropdown (Default).
- ☑ **Picker (Resume)** — sessions by project + relative age + short id,
  persona avatars per row.
- ☑ **Settings** — General (default voice, playback mode, speed 1.5×, mood
  presets, listening, dynamic acks, notifications, hold room), Buttons
  (arcade mapping editor: rename, action selector, notes, color, delete),
  Help (voice/keyboard/joystick/arcade reference tables).
- ✗ **Voice-swap / nickname affordances** — exist via card action (swap) but
  no dedicated capture; no product context menu exists (right-click = WebKit
  default).
- ✗ **Grant flows (Mac + phone), optimistic 25s loading state** — billable;
  verify post-refactor with a single cheap enqueue + grant, or cached paths.
- ✗ **Stale-session error toast, spawn failure notice** — needs error
  conditions; exercise in Phase 2 (client) verification.

## Mobile room (LAN page)

- ☑ **Room view** — header: output routing ("Play on Mac"/"Play on this
  phone"), green connection dot, new-session, overflow menu. Cards: text
  buttons (Hide / Read update / Chat / Reply) + waiting-message previews on
  raised hands. State badges: yellow HAND RAISED / blue WORKING (reversed vs
  desktop — known inconsistency, resolved by owner decision in the spec).
- ☑ **Thread/chat view** — full-height overlay per agent: update-ready
  indicator, Go live button, collapse, message history with cached Play
  buttons, reply composer (placeholder names the agent).
- ☑ **Replay/history** — Messages list below cards: avatar, relative age,
  truncated text, green unheard dots; tapping an item starts cached audio
  with a sticky bottom player (identity, preview, progress, big pause).
- ☑ **Overflow menu** — "Catch up (N unheard)", "Hold room"; hidden devs
  shown via "1 hidden" disclosure.
- ✗ **Live call view (Sesame-style)** — requires an active live session;
  enabling live is billable. Capture opportunistically next time live mode
  is legitimately on. Spec reference: docs/spec-live-mode-v2.md.
- ✗ **Reply send + ack beat, grant-to-phone streaming, Mac↔phone handoff,
  speed button** — billable/interactive; parity-check these against
  docs/spec-live-mode-v2.md during the mobile cutover phase with cached
  audio.

## Cross-cutting invariants (from code, not screenshots)

- WS reconnect: fixed 2s retry loop (panel); SSE: native EventSource retry
  (mobile). Post-refactor: backoff via reconnecting-websocket, revision-aware
  SSE.
- Grant optimism duplicated: 25s pending window in both UIs independently.
- Panel snapshot arrives via WS push; mobile via SSE (bare PanelSnapshot, no
  `type` field) + `/snapshot` bootstrap.
- Session picker data: panel = WS `known_dirs`/`list_resumable` +
  hardcoded PERSONAS; mobile = aggregated `/picker`.
- Phase 0 additions (already live at capture time + deployed after): snapshot
  `rev` field, optional `requestId`/`source` accepted on commands,
  `command_result` frames on the WS path. All additive; both UIs ignore them
  today.
