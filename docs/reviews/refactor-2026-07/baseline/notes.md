# Room of Devs UI baseline — 2026-07-22

## 01-room-full.png

- Six desktop cards were visible: two hand raised (`agent-usage-bar-39`, `jellyfin`), one working (`cursor-read-aloud`), and three idle.
- Hand-raised cards showed a yellow hand badge and queue count `1`; the working card used an amber status dot/border, while raised cards used blue accents.
- Footer transport controls were pause, stop, replay-last, and hold-room.

## 02-card-actions.png

- Agent cards expose five compact icon actions; disabled actions are visibly dimmed on agents that are not team sessions.
- Accessible labels identify actions as jump to terminal/end session where available, speak status, replay last message, and swap character.

## 03-card-menu.png

- Not captured: right-click exposed only the standard WebKit context menu (`Reload`, `Inspect Element`), not a product menu for voice swap or nickname.

## 04-dock-mode.png

- Dock mode collapsed the room into a bottom pill with six avatars, two queue-count bubbles, a captions toggle, and an expand chevron.
- Avatar rings preserve state coloring (raised/working/idle) in the dock.

## 05-dock-hover.png

- Activating an avatar expanded it above the dock with a horizontal action strip.
- The expanded strip retained disabled team-only actions plus speak status, replay, and character swap.

## 06-picker-new.png

- New-session picker showed `Skip permission prompts` and `Remote control (Claude app)` enabled, plus a model selector set to `Default`.
- Recent folders were listed with persona launch avatars; no launch control was activated.

## 07-picker-resume.png

- Resume tab listed prior sessions by project, relative age, and short session ID.
- Each prior session exposed persona launch avatars; none was selected.

## 08-settings-general.png

- Default voice was Donatello v2; playback mode was Announce; speed was 1.50×.
- Listening and dynamic acknowledgements (`Always`) were enabled; notifications and Hold the Room were off.
- Mood displayed `Custom`, with the preset labels compressed tightly in one segmented row.

## 09-settings-buttons.png

- Button mapping listed joystick/USB/generic controls with editable display names, numeric button IDs, action selectors, notes, color cycling, and delete controls.
- Existing mappings included `grant_next`, `pause`, `replay`, and `cycle_mode`; several colored buttons were unassigned.

## 10-settings-help.png

- Help documented voice commands, keyboard hotkeys, joystick gestures, and arcade-button mappings.
- The page is dense and vertically scrollable within the fixed 380×509 panel.

## 11-speaking-room.png

- Captured during the permitted cached replay; the top-left room wordmark changed to an animated/irregular speaking mark.
- No caption text or explicit speaking badge was visible in this frame, and card state badges remained unchanged.

## 12-paused.png

- Clicking the transport pause control changed its accessible action to `Resume playback`.
- The rest of the room and agent-state presentation remained stable while paused.

## 13-resumed.png

- Clicking resume changed the transport action back to `Pause playback`.
- Replay resumed without changing queue counts or agent state badges.

## 14-mobile-room.png

- Mobile header showed output routing (`Play on Mac` / `Play on this phone`), a green connection indicator, new-session, and overflow controls.
- Cards used explicit text buttons (`Hide`, `Read update`, `Chat`, `Reply`) and displayed waiting-message previews for raised hands.
- Mobile used yellow `HAND RAISED` badges and blue `WORKING`; desktop relied more heavily on colored borders/dots.

## 15-mobile-agent-thread.png

- The thread opened as a full-height overlay for `agent-usage-bar-39`, with an `update ready` indicator, `Go live`, collapse control, message history, and cached `Play` buttons.
- A reply textbox and send button were present but untouched; the visible composer placeholder named the agent.

## 16-mobile-replay.png

- The Messages list showed agent avatar/name, relative age, truncated message text, and green unread/unheard dots.
- History sits below the agent-card stack, so reaching it requires substantial scrolling on the mobile viewport.

## 17-mobile-replay-playing.png

- Opening one history item started its cached audio and exposed a sticky bottom player with agent identity, message preview, progress, and a large pause control.
- Playback was paused immediately after capture; the player then showed a play icon.

## 18-mobile-menu.png

- Overflow menu contained only `Catch up (16 unheard)` and `Hold room` in this state.
- One hidden developer was indicated separately by the `1 hidden` disclosure beneath the visible cards.

## Not captured

- Custom desktop card menu (`03-card-menu.png`): no product-specific context/long-hover menu appeared; right-click only showed the WebKit context menu.
- Live call view: no live session was active, and enabling Live mode would be billable.
- Desktop caption text/clear speaking spotlight: the cached replay altered the top-left speaking mark, but no caption or explicit card spotlight was visible in the captured frame.
