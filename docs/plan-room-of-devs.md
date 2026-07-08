# Plan: From Read-Aloud to a Room Full of Devs

*Phased plan — 2026-07-06 — rev 3 — post multi-agent review*

## End State (the vision)

A "room full of devs": each Claude Code session is a persona'd teammate. Instead of audio bombarding you as it arrives, agents **raise their hand** when they have something. You give the floor — by voice ("go ahead, Donnie"), arcade button, or click — and they deliver their update. You can pause, stop, or say "again." A small always-on-top panel shows the active agents (static avatars), their state (working / hand raised / speaking), and lets you talk to a specific one. Arcade buttons (USB encoder plugged straight into the Mac) map to agents; LED state feedback is an optional later add-on via a Pi Pico.

Claude Code-first. Hermes orchestration (docs/design-multi-agent-v2-hermes.md) stays a v2 follow-on, not part of this plan.

## Design principles

- Each phase ships something usable on its own; no phase requires the next.
- Reuse the existing pipeline (queue files, tts-server watcher, replay, character system) — extend, don't rewrite.
- Keyboard/menu first, voice second, hardware third: every interaction gets a cheap software fallback before hardware exists.
- Keep API spend flat: hand-raise announcements use cached audio; synthesis happens once, at floor-grant time (or is cached from synthesis-ahead).

## Current foundation (post-cleanup, v1)

- Queue → Gemini (character rewrite) → ElevenLabs stream → ffplay; replay/ mp3 cache; failed/ handling
- `streaming_enabled` live-gates auto-play (just landed — this is the seed of "don't bombard me")
- Per-session voices + character profiles; muted sessions; dynamic prompt acks (`dynamic_responses` flag)
- SwiftBar menu; session state from `~/.claude/sessions/`; hooks: Stop / UserPromptSubmit / AskUserQuestion

## Phase 1 — Hand-Raise Mode (software only)

**Goal:** responses stop auto-playing; agents announce they have something, you grant the floor.

- New playback mode: `playback_mode: "auto" | "announce" | "silent"` (supersedes/extends `streaming_enabled`)
- On response arrival in announce mode: play the agent's short **cached** announce phrase ("Yo, I got an update!") — free, pre-generated per voice like ack phrases; queue the item. Ask-user questions follow the same etiquette: a cached "I've got a question" phrase raises the hand instead of reading the question aloud uninvited
- **Session state file** per session: `working | hand_raised | speaking | idle` — single source of truth for menu, later UI and LEDs
- Floor-grant actions: menu click, hotkey (next raised hand), per-session grant
- Synthesis: on-grant only (see Decision 1) — a raised hand costs nothing until you grant the floor

## Phase 2 — Voice Control (STT in, commands + talk-to-agent)

**Goal:** hands-free floor control, then free-form talk to a specific agent.

- Local STT: whisper.cpp push-to-talk via hotkey (hardware button later just triggers the same path)
- Command grammar (no LLM needed): "go ahead <name>", "pause", "resume", "stop", "say again", "status", "mute <name>"
- Talk-to-agent: transcribed text routed INTO a Claude Code session (tmux send-keys or comparable injection) — the biggest new capability; needs a session-launch convention
- Ack loop: the character confirms what they heard (cached or dynamic ack)

## Phase 3 — Arcade Buttons (3a: input now · 3b: LEDs later)

**Goal:** physical floor control. Buttons work tonight; LEDs are the optional hardware project.

- **Phase 3a — Direct HID input (no Pi, no new hardware):** the Fosiya kit's USB encoder plugs straight into the Mac as a standard HID gamepad — all 8 buttons already register. A `hid.ts` module in tts-server (`node-hid`) maps HID button index → action via `arcade_buttons.json`, populated by a **learn mode** ("press the button you want to call COIN") — no fixed wiring assumptions. Button = grant floor / push-to-talk for its mapped agent; LEDs light on encoder power only (no state feedback)
- **Phase 3b — Controllable LEDs (optional, later):** a Raspberry Pi Pico (~$5, native USB serial — appears as `/dev/tty.usbmodem`) drives the LEDs over the JSON-line protocol; LED mirrors the Phase 1 session state file (blink = hand raised, solid = speaking, pulse = working). Serial listener lives in tts-server; LED updates driven by state-file changes via the shared state watcher
- docs/design-arcade-button-controller.md carries the hardware details; its Pi Model B path is a legacy appendix

## Phase 4 — Agent Panel (avatars, always-on-top)

**Goal:** see the room; click to interact.

- Small floating window: agents with static AI-generated portraits (per docs/design-avatar-pipeline.md 2D path), name, state badge, hand-raised queue count
- Click agent = grant floor; click-and-hold or button = talk to them; playback controls
- Tauri v2 with tauri-nspanel in v1 scope (Decision 7); Electron is the fallback
- Subscribes to tts-server's WebSocket (Decision 8) — same state the menu and LEDs read

## Phase 5 (later) — Orchestration

- Hermes v2 per existing design doc; ContextDB memory; Splinter routing
- Out of scope for this plan

## Detail specs

- **Phases 1-2:** [plan-details-phase1-2.md](./plan-details-phase1-2.md) (~24-28h)
- **Phases 3-4:** [plan-details-phase3-4.md](./plan-details-phase3-4.md) (3a ~3-4h · panel ~15.5-16h ≈ 19-20h shipping scope; optional 3b LEDs +5-7h + wiring)

## Decisions (resolved during fleshing-out)

1. **Synthesis strategy: synthesize-on-grant, no hybrid.** Skipped updates cost zero — that's the point of hand-raise mode. The ~2-3s grant latency is masked by a free cached lead-in phrase while synthesis starts.
2. **Talk-to-agent injection: tmux send-keys** with a `team.sh cr-<persona>` session-launch convention. Research verified `claude -p --resume` corrupts/interleaves open interactive sessions and there's no official IPC — tmux is the reliable path. Adopting tmux is an explicit Phase 2 prerequisite (it isn't installed today and current sessions run outside it); only `team.sh` sessions are addressable — pid→pane ancestry is a diagnostic aid, not a supported injection path. Injection also requires explicit intent: a verb prefix ("tell/ask/hey <name>") or a pre-bound PTT target — no bare-name fallback.
3. **Announce etiquette: `notify_queued.sh` triggers a dedicated announce helper** (cached phrase replaces the random SFX in announce mode — single integration point, no double-fire; the announce runs independent of the banner's `notifications_enabled` toggle); suppress while floor is held + **one deferred *named* announce** when it truly frees ("Two hands up: Donatello and Michelangelo" via free local `say`) — the deferral file records *which* sessions deferred, only those still-raised names are spoken, and the clear scripts remove entries. No chime stacking, no anonymous dings, no re-nagging hands you deliberately left up.
4. **State: one JSON per session** in `~/.cursor/tts/state/`, atomic writes, each transition owned by exactly one writer (ingest→hand_raised after the mute check, signal→working after purging the session's stale queue item, the shared playback wrapper→speaking via an explicit context param — sessionId, or `"meta"` for announce chimes/SFX/`say`, which never touch session state — and end-of-playback recompute→idle/hand_raised/working — re-scanning queue/ and consulting Claude Code's busy status at write time, never writing idle blind, with a post-write verify pass to close the scan→write race). Live sessions are seeded into the state dir at daemon start. Counts derived from queue/ so races self-correct. Hand-raise accounting covers Claude Code items only; Cursor/manual enqueues keep legacy behavior.
5. **Mode design:** `playback_mode: auto | announce | silent` with `streaming_enabled` kept as a legacy shim so the existing SwiftBar toggle survives. Daemon runs in all modes.
6. **STT: whisper.cpp `base.en`,** spawn-per-utterance with `--prompt` name biasing; push-to-talk via Raycast hotkey (already installed).
7. **Panel: Tauri v2** (TypeScript frontend) with `tauri-nspanel` **in v1 scope**: plain always-on-top windows steal focus on click and can't overlay fullscreen Spaces (and `skipTaskbar` is a macOS no-op), so the plain window is only the dev-milestone stepping stone. Electron is the fallback.
8. **Event flow: tts-server watches the state dir** via a standalone shared `state-watch.ts` module that fans out to LEDs (Phase 3b) + a tiny WebSocket for the panel (localhost-bound, file-token + Origin checked, commands validated against live state) — whichever consumer ships first installs the watcher, neither depends on the other; every surface (hotkey, voice, button, panel click) calls the same entry points — `grant_floor.sh` for the floor, and `scripts/ptt.sh start|stop [sessionId]` as THE stable PTT interface (press/release semantics; an optional pre-bound target bypasses name grammar and injects directly; the Raycast `voice_ptt.sh` toggle is a thin target-less wrapper). PTT also ducks: it pauses playback on start and resumes after routing.
9. **Avatars: Gemini image gen,** 4 personas × 2 states (idle/speaking), stylized homage without franchise names, kept out of public repos.
10. **Hardware correction:** Pi Model B cannot do USB gadget mode — serial would need a ~$6 USB-to-TTL adapter on the Pi's UART pins. *(Superseded by Decision 14: the Model B is retired entirely; kept for the record.)*
11. **"Status" query: template over state files** read aloud via `say` or a cached voice — no LLM call needed.
12. **Credit exposure: near-zero at runtime.** Local STT, cached chimes/acks, on-grant synthesis only (which is the product working as intended). One caveat: `dynamic_responses` defaults to `"always"`, so every injected talk-to-agent message costs one Gemini call + ~100 EL chars for the spoken ack — kept as the default deliberately (it's the charm), but it's a knob: `"cached"` makes acks free.
13. **Grant = one item; supersede on arrival.** A raised hand holds only the *latest* update — a new Stop for an already-raised session replaces the queued item (older file archived to played/; items mid-synthesis are never yanked), so repeat hand-raises never stack credits and `grant_floor.sh` plays exactly one item, never locking the floor on a backlog. Supersede stays *visible*: menu/panel show a superseded-count chip, and an explicit `drain <session>` command surfaces whenever superseded or legacy backlogs exist (legacy Cursor/manual items keep their existing behavior and don't raise hands).
14. **Buttons go encoder-direct; the Pi is out.** Plugging the Fosiya USB encoder straight into the Mac revealed it's a standard HID gamepad with all 8 buttons attached — so **direct HID input (`node-hid` in tts-server) replaces the Pi entirely for input**, shrinking Phase 3's shipping scope to a ~3-4h software task with zero new hardware. A **Raspberry Pi Pico (~$5) replaces the Model B for the future LED path** (native USB CDC serial = the JSON-line protocol as specced, none of the Model B's Linux/console/UART-adapter hazards). Button wiring is discovered by **learn mode** (press-to-name mapping in `arcade_buttons.json`) instead of fixed wiring assumptions.
