# Dock/room speaking polish, round 2 (panel/ only)

Owner feedback batch on the speaker spotlight. `panel/src/main.ts` +
`panel/src/style.css` ONLY — a parallel branch is changing tts-server/, do not
touch it. The two WS messages you may send that don't exist yet
(`{type:"replay_slower"}`) will exist by merge time; `{type:"replay"}` exists.

## 1. Contextual action sets — kill the disabled-button noise

One rule applied to ALL action clusters (dock spotlight row, dock hover
cluster, full-room hover cluster):

- **Agent currently speaking** (nowPlaying live for that session): show ONLY
  `pause ⏸ / stop ⏹ / restart ↻`. No jump/kill/status/swap, no disabled
  placeholders, no divider.
- **Not speaking**: today's set (jump / kill / status / swap), no live buttons.
- **Spotlight row while summary lingers** (endedAt set, bubble showing): this
  row is about the last message → show `replay` (send `{type:"replay"}`),
  `again slower` (send `{type:"replay_slower"}`, tooltip "Replay slower"; use a
  turtle-ish slow icon, e.g. the replay glyph with a small "0.8x" — your call),
  and `jump to terminal` (if team). No kill/status/swap here either.

## 2. Speaker pops OUT of the pill

While the spotlight is live (speaking), the speaker's small avatar is REMOVED
from the pill (filter them out of the pill's agent list) — one Mikey on stage,
not two flapping in parallel. When speech ends they rejoin the pill in their
usual position and the bubble lingers above as it does now. Don't leave an
empty gap element; the pill just re-flows (its width already recomputes).

## 3. Grant feedback — loading ring + stage entrance

Clicking an avatar (grant) takes seconds before audio starts (server-side
synthesis). Add optimistic UI:

- Module state: `pendingGrantSessionId` + timestamp, set when the user clicks
  a dock avatar or full-mode card (the existing grant click paths).
- Dock: the spotlight row appears IMMEDIATELY in loading mode — big avatar
  (idle frame), no bubble, no action row, and a **loading sweep** on the ring:
  a conic-gradient arc starting at 12 o'clock sweeping clockwise (CSS
  animation, ~1.2s loop, green tint). The window resizes via the existing
  dockSpotlight()/dockHeight() plumbing — extend dockSpotlight() to also
  return a spotlight for the pending session.
- Full room: the clicked card's avatar ring gets the same sweep.
- Entrance: animate `.spotlight-col` in (translateY(26px) scale(0.55) →
  identity, ~240ms ease-out) so the avatar reads as "stepping onto the stage".
- Clear `pendingGrantSessionId` when: nowPlaying arrives for that session, a
  DIFFERENT session starts speaking, or a 25s timeout expires (fallback so a
  failed grant can't strand the loading state).
- Muted/no-queue clicks may never produce audio — the timeout covers it.

## 4. Full-room summary pane

- New header button (next to the dock/settings buttons; reuse the CC icon)
  toggling a right-side summary pane in full mode. Persist in localStorage
  (`roomSummaryPane`).
- Pane: fixed ~190px column to the right of the cards grid (flex row: cards
  grow, pane fixed). Contents mirror the dock bubble: speaker name, markdown
  summary (expanded rendering, scrollable), per-message dismiss ✕ (same
  dockSummaryDismissedKey), dimmed when endedAt. Empty state: subtle "Nothing
  spoken yet".
- The cards grid must stay usable at the default 380px window width — when the
  pane is open it's fine for cards to reflow to a single column.

## 5. Full-room speaking card grows

While an agent is speaking (or pending grant), their card:
- gets `grid-column: span 2` when the grid currently has ≥ 2 columns (guard:
  don't span in a 1-column layout — check via container width or a resize
  observer, simplest correct approach wins),
- avatar box grows to 64px (transform-free size change is fine here; keep
  layout shift smooth with a transition on the avatar container),
- hover cluster follows rule #1.

## 6. Lip-sync loop

Keep targeting every `[data-avatar-session]` img (pill, spotlight, cards, and
the new pane if you render an avatar there). No changes to the timing engine.

## Gates

`cd panel && pnpm build` clean. Commit:
`feat(panel): contextual speaker actions, pop-out spotlight, grant loading, room summary pane`.
Print design decisions + any spec deviations.
