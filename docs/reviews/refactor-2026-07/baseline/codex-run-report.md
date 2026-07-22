# Codex baseline capture — final report (full terminal log trimmed)

eyboard hotkeys, joystick gestures, and arcade-button mappings.
+- The page is dense and vertically scrollable within the fixed 380×509 panel.
+
+## 11-speaking-room.png
+
+- Captured during the permitted cached replay; the top-left room wordmark changed to an animated/irregular speaking mark.
+- No caption text or explicit speaking badge was visible in this frame, and card state badges remained unchanged.
+
+## 12-paused.png
+
+- Clicking the transport pause control changed its accessible action to `Resume playback`.
+- The rest of the room and agent-state presentation remained stable while paused.
+
+## 13-resumed.png
+
+- Clicking resume changed the transport action back to `Pause playback`.
+- Replay resumed without changing queue counts or agent state badges.
+
+## 14-mobile-room.png
+
+- Mobile header showed output routing (`Play on Mac` / `Play on this phone`), a green connection indicator, new-session, and overflow controls.
+- Cards used explicit text buttons (`Hide`, `Read update`, `Chat`, `Reply`) and displayed waiting-message previews for raised hands.
+- Mobile used yellow `HAND RAISED` badges and blue `WORKING`; desktop relied more heavily on colored borders/dots.
+
+## 15-mobile-agent-thread.png
+
+- The thread opened as a full-height overlay for `agent-usage-bar-39`, with an `update ready` indicator, `Go live`, collapse control, message history, and cached `Play` buttons.
+- A reply textbox and send button were present but untouched; the visible composer placeholder named the agent.
+
+## 16-mobile-replay.png
+
+- The Messages list showed agent avatar/name, relative age, truncated message text, and green unread/unheard dots.
+- History sits below the agent-card stack, so reaching it requires substantial scrolling on the mobile viewport.
+
+## 17-mobile-replay-playing.png
+
+- Opening one history item started its cached audio and exposed a sticky bottom player with agent identity, message preview, progress, and a large pause control.
+- Playback was paused immediately after capture; the player then showed a play icon.
+
+## 18-mobile-menu.png
+
+- Overflow menu contained only `Catch up (16 unheard)` and `Hold room` in this state.
+- One hidden developer was indicated separately by the `1 hidden` disclosure beneath the visible cards.
+
+## Not captured
+
+- Custom desktop card menu (`03-card-menu.png`): no product-specific context/long-hover menu appeared; right-click only showed the WebKit context menu.
+- Live call view: no live session was active, and enabling Live mode would be billable.
+- Desktop caption text/clear speaking spotlight: the cached replay altered the top-left speaking mark, but no caption or explicit card spotlight was visible in the captured frame.

tokens used
133,979
Captured 17 of 18 requested screenshots and wrote [notes.md](/Users/dougiefresh49/projects/cursor-read-aloud/docs/reviews/refactor-2026-07/baseline/notes.md).

All artifacts are in [baseline/](/Users/dougiefresh49/projects/cursor-read-aloud/docs/reviews/refactor-2026-07/baseline/).

- Succeeded: `01`, `02`, and `04`–`18`.
- Not captured: `03-card-menu.png` because right-click exposed only the standard WebKit menu, not a product-specific menu.
- Live call view was not captured because no live session existed and enabling one is billable.
- No synthesis, reply, session launch, or Live controls were triggered. One permitted desktop cached replay and one mobile cached-history playback were used.

![Desktop room baseline](/Users/dougiefresh49/projects/cursor-read-aloud/docs/reviews/refactor-2026-07/baseline/01-room-full.png)

![Dock hover baseline](/Users/dougiefresh49/projects/cursor-read-aloud/docs/reviews/refactor-2026-07/baseline/05-dock-hover.png)

![Mobile agent thread](/Users/dougiefresh49/projects/cursor-read-aloud/docs/reviews/refactor-2026-07/baseline/15-mobile-agent-thread.png)

![Mobile replay playing](/Users/dougiefresh49/projects/cursor-read-aloud/docs/reviews/refactor-2026-07/baseline/17-mobile-replay-playing.png)
