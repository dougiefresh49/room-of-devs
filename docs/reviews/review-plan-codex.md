# Plan Review — gpt-5.x (codex)
## Verdict
The plan is directionally sound and mostly consistent, but it under-specifies the state machine around non-queue audio and clear/skip flows. Biggest risk: the hand-raise UX depends on state files being truthful, yet several current paths can leave stale `hand_raised` state, skip announces, or still speak immediately.

## Findings
### CX-1: AskUserQuestion bypasses hand-raise mode
- **Severity:** major
- **Doc:** docs/plan-details-phase1-2.md, Phase 1 state/announce flow
- **Problem:** The plan focuses on Stop-hook queue items, but `signal.ts ask-user` currently calls `handleAskUser()` directly, waiting for the audio lock and then making Gemini + ElevenLabs calls. In announce/silent mode, an agent question can still audio-bomb the user and burn credits without a floor grant. This is also likely in daily use because Claude Code asks permission/questions outside normal Stop responses.
- **Fix:** Decide whether AskUserQuestion is exempt or must become a raised-hand item. If it should respect hand-raise mode, route it through the same queue/state/grant path with a distinct item type and no synthesis before grant.

### CX-2: Announce audio is accidentally gated by notifications
- **Severity:** major
- **Doc:** docs/plan-details-phase1-2.md, §3 Announce flow
- **Problem:** The plan says `notify_queued.sh` is the announce trigger, but the current script exits immediately unless `notifications_enabled` is true. `notifications_enabled` defaults false in `config.ts`, so announce mode can become silent by default even though the mode promises a cached spoken raise-hand cue. The doc also says the banner notification gating stays unchanged, which conflicts with using the same early gate for announce playback.
- **Fix:** Split announce playback from banner notification gating. `notify_queued.sh` can still be the integration point, but the announce branch must run based on `playback_mode=announce`, before or independent of `notifications_enabled`.

### CX-3: Clear/skip leaves stale hand-raised state
- **Severity:** major
- **Doc:** docs/plan-details-phase1-2.md, §3 Chime etiquette and §4 Floor-grant
- **Problem:** The docs say `clear_queue.sh` and `clear_thread_queue.sh` remove `.pending-announce`, but they do not say they recompute or update per-session state. In the current repo, those scripts only move queue files to `played/`. A skipped session can remain `hand_raised` forever until some unrelated playback-end recompute happens, causing bad menu badges, LEDs, panel state, and deferred announces.
- **Fix:** Make clear/skip scripts call a state recompute for affected sessions after moving files. For global clear, recompute every state file or derive affected session IDs before moving.

### CX-4: “Playback wrapper owns speaking” lacks enough context
- **Severity:** major
- **Doc:** docs/plan-details-phase1-2.md, §2 Session state file
- **Problem:** The plan assigns `speaking` transitions to a shared wrapper in `audio.ts`, but current audio functions do not consistently know which session they are speaking for. `playFile()` handles replay with only an mp3 path, `playMp3Buffer()` handles cached phrases with only a buffer, and announce phrases may be meta-audio rather than the agent actually taking the floor. A generic wrapper can easily set the wrong session to `speaking`, fail to set any session, or clobber `hand_raised` state after a short ack.
- **Fix:** Add an explicit playback context parameter for session-bound audio, and distinguish `agent_speaking` from global/meta sounds or leave meta sounds out of session state entirely. Do not infer session state from low-level audio calls without metadata.

### CX-5: Active sessions are not seeded into state
- **Severity:** major
- **Doc:** docs/plan-details-phase1-2.md, §2 Hygiene; docs/plan-details-phase3-4.md, §4.6 Data flow
- **Problem:** The plan deletes state files for dead sessions on daemon start, but does not create state files for live sessions from `~/.claude/sessions`. That means the menu, panel, and LEDs can omit already-running agents until they submit a prompt or produce a Stop-hook response. In a concrete daily flow, attaching to four existing Claude sessions would show an incomplete “room” at startup.
- **Fix:** On daemon start, scan `~/.claude/sessions` and seed/update state files as `working` or `idle` unless a queue file implies `hand_raised`.

### CX-6: PTT ducking uses a non-idempotent pause toggle
- **Severity:** major
- **Doc:** docs/plan-details-phase1-2.md, §6 Local STT + hotkey
- **Problem:** The plan says `ptt.sh start` pauses current playback and `stop` resumes it, but the existing `pause.sh` is a toggle. If playback was already paused, PTT start would resume it into the microphone; if routing runs `pause`/`stop`/`grant`, the final resume logic can undo the user’s intended state. Stale `.ptt-recording.pid` files after ffmpeg failure would also make the Raycast toggle invert behavior.
- **Fix:** Add explicit `pause-if-playing` / `resume-if-ducked` semantics, probably by storing a `.ptt-ducked` flag only when PTT itself paused playback. Clean stale recording PIDs by validating the process before deciding start vs stop.

### CX-7: ffmpeg avfoundation command is too optimistic
- **Severity:** major
- **Doc:** docs/plan-details-phase1-2.md, §6 Capture
- **Problem:** `ffmpeg -f avfoundation -i ":default"` is not a safe macOS assumption. AVFoundation capture commonly needs a listed device index or name such as `:0`, and first-run TCC microphone permission can fail silently depending on which host process launches ffmpeg. This will bite quickly because PTT is a core Phase 2 workflow.
- **Fix:** Add setup/discovery: run `ffmpeg -f avfoundation -list_devices true -i ""`, persist a `mic_device` config, and document the macOS microphone permission path for Raycast or the shell host.

### CX-8: Team tmux mapping is underspecified after launch
- **Severity:** major
- **Doc:** docs/plan-details-phase1-2.md, §8 Talk-to-agent
- **Problem:** The plan says `team.sh <persona>` names the tmux target as `cr-<persona>` and can assign the persona’s voice once the session file appears. But Claude Code session files are discovered asynchronously and may not encode the persona name, while multiple sessions can share cwd/name. If the wrong session gets the voice mapping, later character-button and voice routing will inject into or grant the wrong agent.
- **Fix:** Make `team.sh` write an explicit runtime mapping file from persona → tmux target → Claude `sessionId` after detecting the new session, with timeout/error handling. Use that mapping for injection instead of relying only on reverse voice lookup.

### CX-9: Phase 4 depends on Phase 3 internals
- **Severity:** major
- **Doc:** docs/plan-details-phase3-4.md, §4.6 Data flow
- **Problem:** The panel spec says the WebSocket should reuse the chokidar watcher that Phase 3 “already added” for serial LEDs. That breaks the “each phase independently shippable” principle if the owner wants the panel before hardware or skips serial entirely. The panel would need hidden Phase 3 infrastructure despite being a separate phase.
- **Fix:** Move state watching/snapshot building into a Phase 1 shared module or make it part of Phase 4 explicitly. Serial and panel should both subscribe to that module, but neither should require the other phase.

### CX-10: Button hardware omits UART electrical/setup hazards
- **Severity:** major
- **Doc:** docs/plan-details-phase3-4.md, §3.1 Serial listener
- **Problem:** The Pi Model B USB-gadget correction is right, but the plan does not call out 3.3V TTL requirements or disabling the Pi serial console. A 5V USB-TTL adapter or adapter TX wired directly into Pi RX can damage the board, and a login console on UART will corrupt the JSON-line protocol.
- **Fix:** Specify a 3.3V FTDI adapter, connect GND/TX/RX only, cross TX/RX, and disable the Linux serial console while leaving UART enabled.

### CX-11: Supersede-on-arrival can erase useful history too aggressively
- **Severity:** minor
- **Doc:** docs/plan-room-of-devs.md, Decision 13; docs/plan-details-phase1-2.md, §4 Floor-grant
- **Problem:** “Latest only” is good for credit control, but it treats all Stop-hook outputs as progress updates. If an agent finishes task A, raises a hand, then later finishes task B before the user grants the floor, task A is silently archived to `played/` without ever being synthesized. That can make the daily room feel like agents drop work.
- **Fix:** Keep supersede, but add a visible “superseded count” or archive note in the menu/panel, and make `drain <session>` discoverable when superseded items exist.

### CX-12: Notification click bypasses the new floor entry point
- **Severity:** minor
- **Doc:** docs/plan-details-phase1-2.md, §3 Announce flow; docs/plan-details-phase3-4.md, §4.9 shared entry points
- **Problem:** Current `notify_queued.sh` sets terminal-notifier `-execute` to `play_node.sh <file>`. In announce mode, clicking the notification would bypass `grant_floor.sh`, FIFO selection, and any floor-grant lead-in behavior. It will probably still synthesize only one item, but it becomes a separate interaction path with separate state edge cases.
- **Fix:** Change notification execution in announce mode to call `grant_floor.sh <sessionId>` or a file-specific grant helper that performs the same state transitions.

### CX-13: Panel WebSocket command surface needs command validation
- **Severity:** minor
- **Doc:** docs/plan-details-phase3-4.md, §4.6 and §4.9
- **Problem:** The token and Origin checks are good, but the command handler is described as spawning scripts from panel-supplied JSON. Without schema validation and active-session checks, malformed or stale `sessionId` values can trigger confusing no-ops or route commands to dead sessions. This is local-only, but it will show up as flaky clicks after daemon restarts or session churn.
- **Fix:** Validate message shape, reject unknown command fields, and resolve `sessionId` against current active state before spawning. Send an error event back to the panel so it can grey out stale cards.

### CX-14: Announce implementation effort is underestimated
- **Severity:** nit
- **Doc:** docs/plan-details-phase1-2.md, §3 Announce flow
- **Problem:** The doc calls the `notify_queued.sh` announce branch a small diff, but the current script is a Python-heavy notification builder with random SFX played outside the audio lock. Making it lock-aware, mode-aware, notification-gate-independent, voice-aware, and deferred-announce-aware is more than a 15-line change. Underestimating this increases the chance of a half-integrated announce path.
- **Fix:** Treat announce as a small dedicated helper script or TypeScript command called by `notify_queued.sh`, with tests/dry-runs for lock busy, notifications off, missing phrases, and muted sessions.

## Residual risks
- TUI injection through tmux remains inherently fragile around permission prompts and half-typed drafts.
- `tauri-nspanel` is a reasonable choice, but it adds Rust/plugin maintenance to a project owned by a Swift/Rust-weak solo dev.
- Character-to-session routing via voice assignments is convenient but can be ambiguous when multiple sessions share the same persona voice.
- Local `say` feedback is cheap and sensible, but it will sound unlike the character voices; that is acceptable if treated as “system PA” audio.
