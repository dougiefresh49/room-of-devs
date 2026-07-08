# Plan Review — gemini (agy CLI)

## Verdict
Overall, the phased implementation plan is exceptionally solid, successfully reusing existing state machinery to achieve a multi-agent floor-control experience without excessive API spend. The decision to use per-session JSON state files and a shared playback wrapper elegantly solves most of the system's synchronization requirements. The biggest risk lies in subtle race conditions between the decoupled filesystem writers (the ingest hooks and the daemon), and state-desynchronization that occurs when bypassing the queue via direct prompt injection.

## Findings

### GA-1: TOCTOU race in end-of-playback state recompute
- **Severity:** blocker
- **Doc:** docs/plan-details-phase1-2.md (Phase 1, Section 2)
- **Problem:** `recomputeAfterPlayback` scans `queue/` and then updates the state file using `renameSync` in two separate steps. Since `ingest.ts` runs in a separate process, a race condition exists: if `ingest.ts` creates a queue file and writes a `hand_raised` state in the window between the daemon's read and write, `recomputeAfterPlayback` will overwrite the fresh `hand_raised` state with `idle`. The queue file will be present, but the visual notification will be lost.
- **Fix:** Use a file lock (e.g., `flock` in bash and `proper-lockfile` in Node, or a simple `.lock` file) that both processes must acquire before reading the queue and writing the state, ensuring the read-derive-write cycle is truly atomic.

### GA-2: Stale queue files break state after prompt injection
- **Severity:** major
- **Doc:** docs/plan-details-phase1-2.md (Phase 2, Sections 8-9)
- **Problem:** When injecting a prompt via `ptt.sh` into a session that already has a `hand_raised` update waiting, `signal.ts` flips the state to `working`. However, the old unread queue file remains in `queue/`. When the dynamic ack ("On it!") finishes playing, `recomputeAfterPlayback` sees the stale queue file and immediately flips the state back to `hand_raised` while the agent is busy. The user will grant the floor expecting a new update but will hear the obsolete, pre-injection message instead.
- **Fix:** Update the `prompt-submitted` hook logic in `signal.ts` to call `scripts/clear_thread_queue.sh <sessionId>` to purge stale updates before changing the state to `working`.

### GA-3: Serial connection error handler leaks intervals exponentially
- **Severity:** major
- **Doc:** docs/plan-details-phase3-4.md (Phase 3, Section 3.1)
- **Problem:** The proposed serial hotplug logic calls `setInterval(scanAndConnect, 3000)` inside the `error` and `close` event handlers. Because `setInterval` repeats infinitely, a disconnected Pi or failing adapter will spawn a new concurrent interval every 3 seconds for every failed attempt. This leads to an exponential cascade of polling intervals that will quickly max out CPU and crash the Node process.
- **Fix:** Use `setTimeout(scanAndConnect, 3000)` for a single delayed retry, or maintain a single global interval that only attempts to connect if `!port.isOpen`.

### GA-4: Raspberry Pi serial console breaks JSON protocol
- **Severity:** major
- **Doc:** docs/plan-details-phase3-4.md (Phase 3, Section 3.1)
- **Problem:** The Raspberry Pi Model B's primary UART (GPIO 14/15) defaults to running a `getty` login shell. If connected directly to the Mac and sent JSON lines, the Pi's OS will intercept them as login attempts and echo login error prompts back over the serial line, completely corrupting the JSON protocol.
- **Fix:** Add an explicit setup step to run `sudo raspi-config` on the Pi (Interfacing Options -> Serial) to disable the login shell over serial while keeping the serial hardware port enabled.

### GA-5: Deferred announce re-reads all stale raised hands
- **Severity:** major
- **Doc:** docs/plan-details-phase1-2.md (Phase 1, Section 3)
- **Problem:** The `.pending-announce` flag does not store which specific agent raised their hand. When the floor frees, the wrapper reads *all* state files and announces every session that is currently `hand_raised`. If a user intentionally leaves an agent's hand raised to handle later, they will be redundantly nagged about it every time any other agent finishes speaking, violating the "don't bombard me" principle.
- **Fix:** Instead of touching a boolean flag file, append the `sessionId` to `.pending-announce` when deferring. At playback end, read the IDs from the file, filter against current `hand_raised` states, announce only those specific names, and delete the file.

### GA-6: Daemon crashes on in-flight queue file supersede
- **Severity:** major
- **Doc:** docs/plan-details-phase1-2.md (Phase 1, Section 4)
- **Problem:** `ingest.ts` supersedes an item by moving the older queue file to `played/`. If `tts-server` has already picked up the file but hasn't yet transitioned the state to `speaking` (e.g., during the 1-3 seconds while Gemini/ElevenLabs API calls are in flight), `ingest.ts` will still see `hand_raised` and move the file out from under the daemon. When the daemon finishes synthesis and attempts to `renameSync` the file itself, it will throw an `ENOENT` error and crash.
- **Fix:** `ingest.ts` must check for the processing lock file (or the daemon's internal `claimProcessing` marker) before superseding. If the file is locked, skip the supersede move as it is already being synthesized.

### GA-7: Rapid PTT presses corrupt transcript and audio files
- **Severity:** minor
- **Doc:** docs/plan-details-phase1-2.md (Phase 2, Section 6)
- **Problem:** `ptt.sh` hardcodes the paths `/tmp/ptt.wav` and `.ptt-recording.pid`. Rapid successive presses of the hotkey, or pressing multiple arcade buttons simultaneously, will cause multiple `ffmpeg` instances to fight over the same WAV file and overwrite the PID file, leading to orphaned recording processes and mangled command transcriptions.
- **Fix:** Generate a unique ID for each PTT invocation (e.g., `PTT_ID=$$`), use `/tmp/ptt-${PTT_ID}.wav` and a matching PID file, and pass the ID to the `stop` command so it reads the exact file it captured.

### GA-8: Blind ducking-resume undoes voice floor commands
- **Severity:** minor
- **Doc:** docs/plan-details-phase1-2.md (Phase 2, Section 6)
- **Problem:** `ptt.sh` blindly pauses current playback on `start` and resumes it on `stop` (if it was ducked). If the user uses PTT to issue a floor-control command like "stop" or "pause", `ptt.sh` will route the command to take effect, but then immediately resume the playback it just ducked, completely negating the user's intended action.
- **Fix:** `voice.ts route` must communicate back to `ptt.sh` whether resuming is safe (e.g., via exit codes), or `ptt.sh stop` must skip the resume step if the matched transcription was `pause` or `stop`.

## Residual risks
- **Tauri v2 Plugin Stability:** While `tauri-nspanel` handles the macOS focus rules perfectly, relying on third-party plugins in the Tauri v2 ecosystem during its early release cycle may require manual version pinning or minor Rust patching if upstream breaking changes occur.
- **TMUX Permission Prompts:** Injecting text blindly via `tmux send-keys` works well for prompts, but if the Claude Code session is unexpectedly sitting on an interactive permission dialog (e.g., tool approval), the injected text will answer the dialog instead, leading to accidental approvals or rejections.
- **Hardware Logic Levels:** Ensure the USB-to-TTL adapter used operates at 3.3V logic levels on its TX pin (or has a jumper set to 3.3V). Connecting a 5V TX pin to the Raspberry Pi's RX pin will permanently damage the Pi's SoC.
