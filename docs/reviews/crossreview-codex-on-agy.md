### GA-1 — CONFIRM
Real. The plan says `recomputeAfterPlayback` rescans `queue/` and then atomically renames the state file, but atomic rename only protects readers from partial JSON; it does not make the scan-derive-write cycle atomic against `ingest.ts`. If a Stop hook writes the queue file and `hand_raised` state after the scan but before the recompute rename, the recompute can still publish stale `idle`.

### GA-2 — CONFIRM
Real. The plan sets `prompt-submitted` to `working` but does not purge an existing raised-hand queue item. Because end-of-playback recompute prioritizes “queue files present → `hand_raised`” over Claude busy status, a dynamic ack can immediately flip the session back to `hand_raised` for an obsolete pre-prompt update.

### GA-3 — CONFIRM
Real. The Phase 3 pseudocode explicitly says `on close/err: ... setInterval(scanAndConnect, 3000)`. If that is installed from every failed connection/error path, retry loops accumulate and can multiply connection attempts; this should be a single scheduler or `setTimeout`.

### GA-4 — PARTIAL
The failure mode is real: if the Pi UART has a login console/getty attached, JSON lines over GPIO 14/15 will be interpreted or echoed by the OS and corrupt the protocol. The finding overstates “defaults” as a universal fact, but the plan still lacks the required Pi setup step: disable serial login shell and enable serial hardware.

### GA-5 — CONFIRM
Real. The plan’s `.pending-announce` is just a flag, and the deferred handler validates by reading all current `hand_raised` state files, then speaks all names. That means a hand intentionally left raised can be re-announced whenever any later deferred announce fires.

### GA-6 — PARTIAL
The in-flight supersede race is real: planned `ingest.ts` supersedes based on `hand_raised`, while the daemon may already have claimed the file and be spending Gemini/ElevenLabs time before playback state flips to `speaking`. The “daemon crashes” part is not grounded in current code: `moveToPlayed()` catches `renameSync` failures, and `processQueueFile()` also catches errors. The actual risk is wasted synthesis and inconsistent archive/state behavior, not a guaranteed crash.

### GA-7 — PARTIAL
The hardcoded `/tmp/ptt.wav`, `.ptt-recording.pid`, and `.ptt-target` are a real concurrency hazard for direct `ptt.sh start` callers, especially multiple hardware/panel holds. For the Raycast toggle path, the wrapper checks the PID and naturally turns the second press into `stop`, so the “rapid hotkey presses” part is weaker than the multi-button/direct-call case.

### GA-8 — REFUTE
Wrong. Phase 2 explicitly says resume only “unless the routed command itself took the floor,” and the pseudocode says to resume only if “the routed action didn’t take the floor.” The mechanism needs implementation detail, but the plan does not blindly resume after pause/stop/grant commands.

## Missed

- `notify_queued.sh` announce playback is planned as direct `afplay`, but the state model says the shared playback wrapper sets `speaking` for every audible path. Those conflict unless announce phrases are routed through the wrapper or the shell script also manages lock/state.

- `clear_thread_queue.sh` currently takes a base64url grouping token, while the plan repeatedly treats it like `clear_thread_queue.sh <sessionId>`. That needs an overload or a new session-id-specific script.

- The panel WebSocket token plan says the Tauri frontend reads `~/.cursor/tts/panel_ws_token`, but a browser/WKWebView frontend cannot just read arbitrary local files without Tauri filesystem permissions or a Rust-side handoff.
