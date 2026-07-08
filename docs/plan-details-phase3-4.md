# Plan Details — Phases 3-4 (Arcade Buttons + Agent Panel)

*Implementation spec — 2026-07-06 — rev 3 — post multi-agent review — companion to docs/plan-room-of-devs.md. Personal dev tool; simple beats robust.*

Assumes Phase 1 shipped: session state files at `~/.cursor/tts/state/<sessionId>.json` with `{ "state": "working" | "hand_raised" | "speaking" | "idle" }`, a floor-grant entry point `scripts/grant_floor.sh <sessionId>`, and Phase 2 shipped THE stable PTT entry point `scripts/ptt.sh start|stop [sessionId]` (press/release semantics; passing a sessionId pre-binds the target, so the transcript bypasses name-resolution and injects directly — exactly what hardware buttons and panel holds want). If Phase 1/2 land with different names/paths, substitute — nothing below depends on the exact shape beyond "a JSON file per session" and "a script per action".

---

## Phase 3 — Arcade Buttons

Phase 3 splits in two, because the hardware turned out friendlier than the original design doc assumed: **the Fosiya kit's USB encoder plugs straight into the Mac and enumerates as a standard HID gamepad** ("Generic USB Joystick" in Game Controllers — verified on this machine). All 8 buttons are attached to it (4 color + coin + 1P + 2P, plus the joystick). That makes button *input* a pure-software feature — no Pi, no serial adapter, no wiring, buildable immediately. Only *controllable LEDs* need a microcontroller, and that becomes the optional later half:

- **Phase 3a — Direct HID input (ships first):** encoder → Mac USB → new `hid.ts` module in tts-server. In 3a the LEDs are dumb — encoder-powered, they light on their own — so no state feedback yet; the menu bar and (later) panel carry state.
- **Phase 3b — Controllable LEDs (optional, later):** a Raspberry Pi Pico (~$5) drives the LEDs over its native USB serial, replacing the retired 2011 Pi Model B. The JSON-line serial spec below applies unchanged; buttons stay on HID either way.

The hardware design doc (docs/design-arcade-button-controller.md) carries a dated architecture-update note reflecting this split; its Pi Model B instructions are a legacy appendix.

### 3.1 Phase 3a — HID button input (`hid.ts`)

**Decision: a new module inside the existing tts-server process** (`tts-server/src/hid.ts`), not a separate daemon.

Why:
- tts-server is already the one long-running daemon with restart tooling (`tts-server.sh restart` syncs + relaunches). A second daemon means a second PID file, second log, second thing to forget to restart.
- The button dispatcher needs exactly what tts-server already has in memory: config, session→voice→character resolution (`resolveVoiceId` + `getCharacter`), and `stopCurrent()` for audio ducking.
- The cost of cohabiting is that a HID bug can take down TTS — and `tts-server.sh` does **not** auto-restart on crash, so a dead daemon stays dead until you notice the silence. So the module is failure-isolated by construction, not by hope: every device and data callback is wrapped in try/catch; malformed reports are logged and dropped, never thrown; a top-level `uncaughtException` logger is the last line of defense. Acceptance: unplug/replug the encoder mid-session and mash buttons — audio playback must keep working throughout.

**npm package: `node-hid` (v3.x).** Verified current (July 2026): v3.3.0, actively maintained under the node-hid org, prebuilt binaries (no node-gyp pain, works under tsx), async API since 3.0, 350+ dependents. The encoder is a plain HID gamepad: its input reports carry the button states as a bitmask, `node-hid` hands us raw report buffers, and diffing consecutive reports tells us exactly which button went down or up — no gamepad framework needed for 8 buttons.

**Reading the encoder** (all in `hid.ts`, ~150 lines incl. learn mode):

```
findDevice(): HID.devices() → match vendorId/productId recorded in
              arcade_buttons.json by learn mode
              (fallback: product string /joystick|gamepad/i)
on("data"):   diff report bytes vs. previous report → button index down/up
              down…up < 500ms            → press(idx)
              down held ≥ 500ms          → holdStart(idx); holdEnd(idx) on up
on("error"):  close device, log — reconnect is the scheduler's job
reconnect:    ONE persistent 3s scheduler, installed once at startHid(),
              that no-ops while the device is open. Error/close handlers
              never install timers themselves — no interval stacking.
              Unplugged encoder = silent no-op forever; that's correct.
```

Wire-up in `index.ts`: `if (loadConfig().arcade_enabled) startHid()` at boot, `stopHid()` in the SIGTERM/SIGINT handlers. New config key `arcade_enabled: boolean` (default `false`) in `config.ts` so the feature is inert until enabled.

### 3.2 Mapping config + learn mode

**New file `~/.cursor/tts/arcade_buttons.json`** — keyed by **HID button index**, each with a friendly name. Nobody knows which physical button is wired to which encoder input (and it doesn't matter — learn mode discovers it):

```json
{
  "device": { "vendorId": 121, "productId": 6 },
  "port_hint": "usbmodem",
  "buttons": {
    "0": { "name": "blue",   "character": "leonardo" },
    "1": { "name": "red",    "character": "raphael" },
    "2": { "name": "teal",   "character": "donatello" },
    "3": { "name": "yellow", "character": "michelangelo" },
    "4": { "name": "white",  "action": "grant_next" },
    "5": { "name": "1p",     "action": "replay" },
    "6": { "name": "2p",     "action": "stop" },
    "7": { "name": "coin",   "action": "toggle_mode" }
  }
}
```

(`device` + `buttons` serve 3a; `port_hint` is only read by 3b's serial module. The friendly `name` doubles as the LED id on the 3b wire.)

**Learn mode is how this file gets written** — `pnpm exec tsx src/hid.ts learn`: opens the encoder, prompts *"press the button you want to call COIN"*, records the HID index of the next button that fires, and walks through every name (4 colors, white, 1P, 2P, coin), then writes `arcade_buttons.json` including the device's vendor/product IDs. Rerun it any time buttons get rewired; there are no fixed wiring assumptions anywhere in the system.

Key design point: **buttons map to characters, not session IDs.** Sessions are ephemeral; the button box is permanent. Resolution at press time: character → voice (from `characters.json`) → session whose `session_voices.json` entry uses that voice → newest active session wins if several. This reuses the existing session→voice→character chain in reverse and means zero "assign mode" — start a session, give it the Donatello voice (already a menu action), and the teal button just works. An optional `"session_id"` field per button pins it explicitly if ever needed. (Talk-to-agent *injection* still requires the session to be in `team_map.json` per phase1-2 §8 — a button hold on a session that isn't team-launched gets the spoken "can't reach" error, same as voice.)

Loader lives in `config.ts` (`loadArcadeButtons()`, same mtime-cache pattern as `loadConfig`).

### 3.3 Button dispatch (in `hid.ts`, each action ≤5 lines)

- `press` on a character button → `spawn(grant_floor.sh <resolvedSessionId>)`. If that agent is currently speaking → call `stopCurrent()` instead ("I heard enough", per the design doc's ducking rule).
- `holdStart`/`holdEnd` on a character button → `spawn(ptt.sh start|stop <resolvedSessionId>)`. The pre-bound sessionId means the transcript injects straight into that agent — no name grammar — and each hold is its own PTT invocation (per-invocation files, phase1-2 §6), so two buttons held at once don't collide. Ducking is `ptt.sh`'s own job (pause-if-playing / resume-if-ducked) — no extra call here.
- `press` white → grant the oldest raised hand (same code path as the Phase 1 "next raised hand" hotkey).
- `press` 1p → `signal.ts replay "" 1`; 2p → `stop.sh`; coin → cycle `playback_mode`.

This dispatch table is deliberately transport-agnostic — it keys on the friendly button name, so if a future all-microcontroller build ever sends button events over serial instead, the same table serves both.

### 3.4 Phase 3b — Controllable LEDs via Raspberry Pi Pico (optional, later)

**Microcontroller: Raspberry Pi Pico (~$5), replacing the 2011 Pi Model B.** The Pico's USB port is native CDC serial — plug it into the Mac and it appears as `/dev/tty.usbmodem*`, one cable for power *and* data, which is exactly the JSON-line transport this spec wants. What retiring the Model B deletes: the Linux/SD-card/boot maintenance, the UART login-console pitfall (the Model B's getty answers JSON lines with login-prompt garbage unless disabled), the ~$6 USB-TTL adapter, and the 3.3V/5V electrical hazard on the Mac link. The remaining electrical care is the Pico's own LED wiring (arcade LEDs may want more current than a GPIO supplies — transistor or driver board per the hardware doc). Firmware is a ~100-line **MicroPython/CircuitPython** script (GPIO out for LEDs + a `usb_cdc` read-line loop + blink timers) instead of RPi.GPIO-on-Linux.

**npm package: `serialport` (v13.x).** Verified current: v13.0.0, community-maintained (governance model, 5k+ dependents), prebuilt macOS binaries since v10, works under tsx. Use `@serialport/parser-readline` (bundled) for newline-delimited JSON framing.

**Connection + hotplug logic** (all in `serial.ts`, ~100 lines):

```
findPort():   SerialPort.list() → first port whose path matches
              config port_hint (default: /usbmodem|usbserial/)
connect():    open at 115200, pipe through ReadlineParser("\n"),
              JSON.parse each line (log + drop parse failures — never throw),
              on open → send LED snapshot (below)
scheduler:    ONE persistent setInterval(scanAndConnect, 3000), installed
              once at startSerial(), that no-ops while a port is open.
              close/error handlers only log and mark the port closed —
              they NEVER install intervals themselves, so failures can't
              stack timers. No backoff, no max retries: an unplugged
              Pico = one cheap no-op poll every 3s, forever; that's correct.
writeLine():  if port open, write JSON + "\n"; else drop silently
```

Same failure-isolation rules and wire-up pattern as `hid.ts` (`arcade_enabled` gates both; `startSerial()` only runs if a `port_hint` match exists). Acceptance includes the garbage-input smoke test: pipe binary noise, truncated JSON, and absurdly long lines at the port and confirm audio playback keeps working.

**State file → LED flow:** `serial.ts` subscribes to the shared `state-watch.ts` module (speced in §4.6 — whichever of 3b/4 ships first installs it; neither depends on the other):

```
state-watch event: (sessionId, state)
  → sessionId → voice → character → button name (reverse of press-time lookup)
  → writeLine({ t: "led", btn, mode: stateToLed(state) })

stateToLed: hand_raised → "blink" | speaking → "on" |
            working → "blink_slow" | idle → "off"
```

On (re)connect, iterate current state files and send one `led` line per mapped button — that's the whole resync story. No diffing, no queue of missed updates; LEDs are idempotent.

**The JSON-line message set** — newline-delimited JSON, 115200 baud, debuggable with `screen /dev/tty.usbmodem-XXXX 115200`:

| Pico → Mac | Meaning |
|---|---|
| `{"t":"hello","fw":"1"}` | Pico booted / reconnected — Mac replies with LED snapshot |
| `{"t":"press","btn":"blue"}` / `{"t":"down","btn":"blue"}` / `{"t":"up","btn":"blue"}` | *reserved* — buttons stay on HID in this build; kept in the protocol so a future all-Pico box needs no protocol change |

| Mac → Pico | Meaning |
|---|---|
| `{"t":"led","btn":"blue","mode":"off"\|"on"\|"blink"\|"blink_slow"}` | set one LED (Pico owns blink timing) |
| `{"t":"hello"}` | ack, nice for Pico-side logging |

Everything from the design doc's richer event set (`assign-mode`, `assign`, `spawn-session`, per-flow LED choreography) is either deferred or emerges from these primitives: the "recording → processing → playing" LED sequence is just the Mac sending successive `led` lines as the state files change.

**Legacy appendix — the Pi Model B path (kept for the record, not recommended):** if the Model B is ever pressed into service instead of a Pico, two things WILL bite: (1) **disable the serial login console first** — `sudo raspi-config` → Interface Options → Serial Port → login shell **No**, serial hardware **Yes** (on a 2011-era image the getty on the UART is on by default and will answer JSON lines with login garbage); (2) **the Mac link is 3.3V logic** — use an FTDI-based USB-TTL adapter (or one with its voltage jumper set to 3.3V; a 5V adapter TX into the Pi's 3.3V RX can permanently kill the SoC), connect **GND, TX, RX only**, with **TX↔RX crossed** (adapter TX → Pi RX GPIO15, adapter RX → Pi TX GPIO14), and power the Pi separately over micro-USB (its USB ports are host-only — no gadget mode). All of which is the argument for the Pico.

### 3.5 What the design doc's phases collapse to, given Phases 1-2 + HID

The design doc predates Phases 1-2 and the encoder discovery, so its Phase A/B carried transport experiments, recording logic, and session management. Now:

| Design doc item | Now |
|---|---|
| Pi reads GPIO buttons; Phase A: HTTP POST transport, Phase B: +SSE, Phase C: WebSocket | **Button input needs no transport at all** — the encoder is a HID gamepad the Mac reads directly (3a). The only remaining wire protocol is LED-bound serial JSON-lines (3b). |
| Mac starts/stops mic recording, whisper.cpp wiring | Exists (Phase 2). Buttons shell to `ptt.sh` — zero new audio code. |
| Route transcription to session, TTS response | Exists (Phase 2). Nothing to build. |
| Spawn/assign sessions (1P/Coin flows) | Stays deferred, and the character-based mapping in 3.2 makes it *permanently* optional — assignment happens by giving a session a voice, which the menu already does. |
| LED choreography per PTT step | Falls out of the Phase 1 state files; no bespoke sequences. |
| Hardcode 4 buttons to 4 auto-started sessions | Softened twice over: buttons resolve to whatever session wears the character's voice, and learn mode discovers the physical wiring instead of assuming it. |

Net: 3a is one new module plus one learn-mode-generated config file; 3b, when it happens, is one serial module plus a ~100-line Pico script.

### Phase 3 file changes

| File | Change |
|---|---|
| `tts-server/src/hid.ts` | **new (3a)** — device open/reconnect, report diffing, press/hold detection, learn mode, button→action dispatch (~150 lines) |
| `tts-server/src/config.ts` | add `arcade_enabled` to `Config` + `loadArcadeButtons()` + `ARCADE_BUTTONS_PATH` |
| `tts-server/src/index.ts` | 4 lines: start/stop hid (and serial, in 3b) when enabled |
| `tts-server/package.json` | add `node-hid` (3a); `serialport` (3b, when it happens) |
| `~/.cursor/tts/arcade_buttons.json` | **new (3a)** runtime config, written by `hid.ts learn` |
| `tts-server/src/serial.ts` | **new (3b)** — port scan + persistent-scheduler reconnect, line codec, LED writer subscribed to `state-watch.ts` (~100 lines) |
| `tts-server/src/state-watch.ts` | shared module speced in §4.6 — 3b consumes it; whichever of 3b/Phase 4 ships first installs it |
| `pico/leds.py` | **new (3b)** — MicroPython/CircuitPython firmware: LED GPIO + blink timers + `usb_cdc` JSON-line loop (~100 lines) |

**Effort — Phase 3a: ~3-4h** (1h report-diff + press/hold detection, 1h learn mode, 0.5h dispatch wiring, 0.5-1h reconnect + failure isolation + live test with the encoder — zero API spend, zero extra hardware). **Phase 3b (optional, later): ~5-7h** — 2h `serial.ts` incl. scheduler + garbage-input smoke test, 1h LED writer on `state-watch.ts`, 1.5-2h Pico firmware, 1h wiring/bring-up slop. Plus enclosure/wiring per the hardware doc.

Testing: 3a needs no fake hardware — the encoder is already on the desk and presses are free. For 3b without a Pico in hand: `socat -d -d pty,raw,echo=0 pty,raw,echo=0` gives two linked fake ttys; point `port_hint` at one, `cat`/`echo` JSON lines on the other. Worth the 10 minutes.

---

## Phase 4 — Agent Panel

### 4.5 Tech choice: **Tauri v2** (with Electron as the pre-approved fallback)

| | Always-on-top small window | macOS look/feel | File-watch / WS updates | Effort for TS-strong / Swift-weak solo dev |
|---|---|---|---|---|
| **(a) SwiftUI** | Perfect — `NSPanel` is native, non-activating for free | Perfect | Needs Swift `DispatchSource`/`URLSessionWebSocketTask` | **High** — you'd be learning Swift on the critical path; every avatar/layout tweak fights the weak skill |
| **(b) Tauri v2** | Plain `alwaysOnTop: true` window activates on click and won't float over fullscreen-Space apps; **`tauri-nspanel` plugin** gives a true non-activating NSPanel + `visibleOnAllWorkspaces` — that combination is the actual requirement | Good (real WKWebView; vibrancy available) | Frontend is a browser — plain `WebSocket` client, trivial | **Medium-low** — UI is 100% TS/HTML/CSS; Rust footprint is scaffold + one ~20-line plugin registration |
| **(c) Electron** | `alwaysOnTop` + `setVisibleOnAllWorkspaces` — works, activates on click | OK | Node in-process — could even `fs.watch` directly | **Low** — zero new tools, but ~150MB RSS for a widget that runs all day, ~250MB app |
| **(d) Menubar-anchored web view** (SwiftBar can't; would be Hammerspoon `hs.webview` or an `NSPopover` wrapper) | Popover ≠ always-on-top (dismisses on click-away) — fails the core requirement unless you go Hammerspoon, which is a debugging desert | Fine | Awkward | Low to start, painful to grow |

**Recommendation: Tauri v2.** Verified current state (July 2026): Tauri v2 supports `alwaysOnTop` natively in the window config, and the [`tauri-nspanel`](https://github.com/ahkohd/tauri-nspanel) plugin (actively maintained, v2.1 branch, used in production by Cap and Screenpipe) converts a Tauri window into a real macOS `NSPanel` — including **non-activating** style, so clicking an agent card does *not* steal focus from Cursor/your editor. That focus behavior is the one thing that genuinely matters for this tool (you'll click "go ahead, Donnie" mid-keystroke), and it's the thing Electron can't do cleanly.

Sequencing: **`tauri-nspanel` is in v1 scope, not a follow-up.** Two macOS realities make a plain always-on-top window unacceptable as the shipping target: it does not appear over apps in fullscreen Spaces, and it *activates on every click* — stealing focus from Cursor is precisely the failure mode this panel exists to avoid. (Also note: `skipTaskbar` is Windows/Linux-only and a no-op on macOS — don't lean on it.) The plain `"alwaysOnTop": true, "decorations": false` window remains the right **dev-milestone stepping stone**: scaffold, cards, and the WS client get built and verified against it with zero Rust, then the nspanel conversion (~20 lines of well-documented Rust) lands before daily use begins. Electron remains the escape hatch if the Rust toolchain ever fights back, since the frontend (the actual work) ports over unchanged.

Frontend: vanilla Vite + TS or Preact — 4 cards and 3 buttons don't justify React tooling, but use whatever's fastest for you; it's ~200 lines either way.

### 4.6 Data flow: shared state watcher + tts-server WebSocket, panel is a dumb client

**Shared module `tts-server/src/state-watch.ts` (standalone — speced here, owned by no phase):** one chokidar watcher on `~/.cursor/tts/state/` (add/change/unlink), a tiny subscriber API, no consumers baked in:

```ts
// ~40 lines. Debounces rapid rewrites (50ms), parses the JSON, never throws to subscribers.
startStateWatch(): void            // idempotent — safe for any consumer to call
onStateChange(cb: (sessionId: string, state: SessionState | null) => void): void
snapshotStates(): Map<string, SessionState>   // for connect-time resyncs
```

Both fan-out targets subscribe to it: `serial.ts` (Phase 3b LED lines) and `panel-ws.ts` (snapshots below). **Whichever phase ships first installs the module; neither depends on the other** — building the panel before any button hardware (or vice versa) works by construction, keeping every phase independently shippable.

Recommendation for the panel itself: **tts-server exposes a tiny WebSocket** rather than the panel watching state files itself.

Why:
- One code path computes "session → character → display state" for every surface — `state-watch.ts` events in, LED lines and panel snapshots out.
- The panel needs *resolved* data (character name, avatar key, raised-hand count from `queue/`), and that resolution logic lives in tts-server TypeScript. fs.watch in the panel would mean reimplementing session→voice→character joins in the frontend and watching 3 directories (`state/`, `queue/`, `session_voices.json`) instead of one socket.
- Commands ride the same socket back, avoiding Tauri shell-plugin permission ceremony entirely (see 4.9).

**New module `tts-server/src/panel-ws.ts`** using the `ws` package (zero-dep, boring), gated by config `panel_port` (default `4780`, `0` = disabled):

```
Server → panel:
  on connect:            { type: "snapshot", agents: [AgentView...] }
  on any state change:   { type: "snapshot", agents: [...] }   // full snapshot every time —
                                                               // 4 agents, no delta protocol
  on rejected command:   { type: "error", code: "stale_session" | "bad_message", sessionId? }
AgentView = { sessionId, character, name, state, raisedCount, supersededCount, muted }
  (raisedCount = queue/ files for that session; supersededCount from the queue item's
   supersede counter, phase1-2 §4; reuse getActiveSessions + resolveVoiceId)

Panel → server:
  { type: "grant", sessionId }
  { type: "ptt", phase: "start" | "stop", sessionId }
  { type: "replay" } | { type: "stop" } | { type: "pause" }
```

**Command validation (the panel is a client, not a trusted caller):** every inbound message is checked before anything is spawned — `type` against the whitelist above, fields against the expected shape (strings, no extras), and any `sessionId` **resolved against the live state files at dispatch time**. Unknown type / malformed shape → log + `{type:"error",code:"bad_message"}`. A sessionId with no live state file (panel showing pre-restart data) → `{type:"error",code:"stale_session",sessionId}`, and the panel greys that card until the next snapshot replaces it — a stale click is visible feedback, never a silent no-op or a spawn with a garbage argument.

Full-snapshot-on-every-change is deliberate: no client state reconciliation, reconnect logic is "reconnect and wait for snapshot" (same idempotent philosophy as the LED resync). Panel reconnects on a 2s timer when the socket drops (tts-server restarted) and greys out until it's back.

**Hardening (localhost is not private — any webpage you have open can reach it):** three cheap measures, ~15 lines total. (1) Bind `127.0.0.1` explicitly, never `0.0.0.0`. (2) On start, write a random token to a file in `~/.cursor/tts/` (e.g. `panel_ws_token`); the panel presents the token on connect (`?token=...`), and connections without it are dropped at upgrade. (3) Reject upgrades with an unexpected `Origin` header — only the Tauri app's origin (or absent) is allowed, which shuts down drive-by WebSocket attempts from browser pages.

**Token handoff (WKWebView can't read `~/.cursor/tts/` from JS):** the frontend gets the token from a ~5-line Tauri Rust command — `#[tauri::command] fn ws_token() -> Result<String, String> { std::fs::read_to_string(dirs::home_dir()...join(".cursor/tts/panel_ws_token")).map(|s| s.trim().into()).map_err(|e| e.to_string()) }` — invoked once at startup (`await invoke("ws_token")`) before opening the socket. Without this the token scheme dies on first contact: a WKWebView frontend has no filesystem access, and granting Tauri fs-plugin permissions for one file is more ceremony than one command.

### 4.7 Panel v1 scope

One window, ~360×200px, always-on-top, draggable via `-webkit-app-region: drag` on the background.

**Agent card ×4 (one per active persona'd session):**
- Avatar PNG (64px) — swaps `idle.png` ↔ `speaking.png` on state (that's the *only* "animation")
- Character name
- State badge: colored dot + word (`working` amber / `hand raised` blue pulse-CSS / `speaking` green / `idle` grey), `muted` strikethrough variant
- Raised-hand count chip (queued items for that session; hidden when 0), plus a superseded-count chip when the pending item replaced earlier ones (`supersededCount` from the snapshot — mirrors the menu chip, phase1-2 §4)
- **Click** = grant floor · **press-and-hold** = PTT (mousedown/mouseup → `ptt start/stop`)

**Global strip (bottom):**
- Pause/resume · Stop · Replay-last buttons
- Tiny connection dot (WS up/down)

**Explicitly OUT of v1:** animation/tweening, lip-sync (even the mouth-toggle from the avatar doc — the idle/speaking swap is it), chat history / transcript / dialog box / typewriter text, 3D anything, session spawn/assign UI, volume/speed controls, per-agent mute toggles (menu already has them), multi-theme switching (folder convention keeps the door open, see 4.8).

### 4.8 Static avatars: generation workflow

**Tool: Gemini image generation** (`gemini-2.5-flash-image` / "Nano Banana" lineage) — you already have `GEMINI_API_KEY` and a billing relationship, and its image *editing* mode is the strongest available for character consistency: generate one hero portrait per persona, then edit it ("same character, mouth open mid-sentence, slightly brighter eyes") for the speaking variant, instead of re-rolling and praying for consistency. Fallback if quality disappoints: ChatGPT image gen or Midjourney via existing subscriptions — this is a one-afternoon manual task either way; do **not** build a generation pipeline.

**Variants: start with exactly 2 states — `idle` + `speaking`** — per character (8 images total). The avatar doc's 6-8 expression sets are a v2 luxury; state-badge + LED already communicate working/hand-raised, so extra expressions add generation pain (consistency across 6 images is the hard part) for marginal signal. Add `hand_raised` (hand up, grinning) as the first expansion if the panel feels flat.

**Prompt approach** (style-lock template, one per character with substitutions):

> "Bust portrait of an original anthropomorphic turtle software developer character — [BLUE] bandana, [katana strapped to back / bo staff / sai / nunchaku], wearing headphones and a hoodie, warm workshop lighting, flat illustration style with bold outlines, solid dark teal background, facing viewer, calm neutral expression. Original character design, stylized homage — not Nickelodeon/Paramount's TMNT."

Then per character: edit pass → "same exact character and framing, mouth open as if speaking enthusiastically". Export 512×512 PNG; keep the solid background (cards have their own bg — transparency post-processing is not worth it; crop to a rounded square in CSS).

**File layout** (theme-ready without building themes):

```
panel/public/avatars/tmnt/leonardo/idle.png
panel/public/avatars/tmnt/leonardo/speaking.png
... (raphael, donatello, michelangelo)
```

Panel resolves `avatars/${theme}/${character}/${state}.png` with `idle.png` fallback. Character key comes over the WS `AgentView` and matches `characters.json` names.

**License/IP note:** these are AI-generated stylized homages (original turtle-dev characters, no logos, no canonical costume art), used in a private personal tool — effectively zero risk. Keep it that way: don't prompt for "TMNT", "Ninja Turtles", or character likenesses by franchise name in the final assets, and don't ship the images in a public repo or public screenshots. If this ever goes public, swap the theme folder for a fully original crew (the folder convention makes that a file drop).

### 4.9 Click → shared floor-grant / PTT entry points

Uniformity rule established in Phase 1-3 and kept here: **every surface funnels into the same scripts.**

```
SwiftBar menu ─────┐
Phase 1 hotkey ────┤
Arcade button ─────┼──► scripts/grant_floor.sh <sessionId>   (floor grant)
Panel card click ──┘        scripts/ptt.sh start|stop <sid>  (talk)
                            src/signal.ts replay / stop.sh    (globals)
```

Concretely for the panel: card click → WS `{type:"grant",sessionId}` (validated per §4.6) → `panel-ws.ts` handler does `spawn("bash", [GRANT_SCRIPT, sessionId])` — the *identical* invocation the HID `press` handler makes in Phase 3a. The panel itself never touches scripts, files, or Tauri shell permissions; tts-server is the single choke point, so muting rules, dedup, and logging apply automatically no matter which surface triggered the action. (Direct in-process function calls instead of `spawn` would save ~50ms; skip that — one code path with the menu beats the optimization.)

### Phase 4 file changes

| File | Change |
|---|---|
| `tts-server/src/state-watch.ts` | **new shared module** (§4.6) — chokidar on `state/`, debounce, subscriber API, snapshot helper (~40 lines); installed by whichever of 3b/4 ships first |
| `tts-server/src/panel-ws.ts` | **new** — `ws` server (127.0.0.1 bind, token + Origin checks), snapshot builder on `state-watch.ts` events, command validation (shape + live-session resolve + error events), dispatch (~140 lines) |
| `tts-server/src/config.ts` | add `panel_port` to `Config` |
| `tts-server/package.json` | add `ws` |
| `panel/` | **new top-level dir** — Tauri v2 app: `panel/src-tauri/tauri.conf.json` (alwaysOnTop, 360×200, decorations off), generated Rust scaffold + ~20-line `tauri-nspanel` registration (non-activating panel, all Spaces) + the ~5-line `ws_token` command (§4.6), `panel/src/main.ts` + `index.html` + `style.css` (~250 lines total), `panel/public/avatars/tmnt/...` |
| `scripts/panel.sh` | **new** — `pnpm tauri dev` wrapper / open-built-app, so SwiftBar's 2P-equivalent menu item can launch it |
| `scripts/setup.sh` | symlink/copy built panel app if present (optional nicety) |

**Effort: ~15.5-16h**
- `state-watch.ts` + WS module in tts-server + command validation/error events + token/Origin hardening: 3-3.5h
- Tauri scaffold + dev-milestone always-on-top window + `ws_token` command (incl. Rust toolchain install): 2h
- `tauri-nspanel` conversion (non-activating panel, visible on all Spaces): ~2h
- Panel UI (cards, strip, WS client, reconnect + stale-card greying): 4-5h
- Avatar generation afternoon (8 images, prompting + cropping): 2-3h
- Wiring click/hold → scripts end-to-end + polish: 1-2h

---

## Implementation order (phases 3-4 combined)

Phase 3a needs no hardware beyond the encoder already on the desk; Phase 4's software half has zero hardware dependencies; Phase 3b happens whenever a Pico shows up. Suggested order — each checkpoint independently usable:

- [ ] **3a.1** `arcade_buttons.json` schema + `loadArcadeButtons()` in config.ts; `arcade_enabled` flag
- [ ] **3a.2** `hid.ts` learn mode → generate the real mapping from the physical box (`pnpm exec tsx src/hid.ts learn`)
- [ ] **3a.3** `hid.ts` runtime: report diffing, press/hold detection, dispatch → `grant_floor.sh` / `ptt.sh` / `signal.ts replay` / `stop.sh`
- [ ] **3a.4** Persistent-scheduler reconnect + failure isolation — unplug/replug + button-mash while audio plays (daemon must survive)
- [ ] **4.1** `state-watch.ts` (shared module, §4.6) + `panel-ws.ts` with validation/token/Origin + `panel_port` config; verify with `websocat ws://localhost:4780`
- [ ] **4.2** Tauri scaffold: plain always-on-top chromeless window showing hardcoded fake agents (dev milestone only — not the shipping window); `ws_token` command
- [ ] **4.3** WS client + live cards (state badges, counts, reconnect grey-out, stale-card error handling)
- [ ] **4.4** Avatar generation afternoon → drop PNGs into `panel/public/avatars/tmnt/`
- [ ] **4.5** Click = grant, hold = PTT, global strip — full end-to-end with a real session
- [ ] **4.6** `tauri-nspanel` conversion (non-activating, all Spaces) — required before daily use; plain alwaysOnTop steals focus and can't overlay fullscreen Spaces
- [ ] **3b (optional, whenever the Pico arrives)** `serial.ts` on `state-watch.ts` (socat fake-tty + garbage-input smoke test first) → Pico firmware → LED bring-up
- [ ] Verification gate throughout: `pnpm exec tsc --noEmit` clean; pipeline checks via `enqueue_manual.sh` short text + `signal.ts replay` (no extra API spend)

**Total estimate: Phase 3a ~3-4h · Phase 4 ~15.5-16h · shipping scope (3a + 4) ≈ 19-20h** of software work; **Phase 3b adds ~5-7h** (plus wiring/enclosure per the hardware doc) if/when the LED path happens.

### Sources

- [node-hid on npm](https://www.npmjs.com/package/node-hid) · [node-hid GitHub](https://github.com/node-hid/node-hid)
- [serialport on npm](https://www.npmjs.com/package/serialport) · [node-serialport GitHub](https://github.com/serialport/node-serialport) · [install docs (prebuilt binaries)](https://serialport.io/docs/guide-installation/)
- [Raspberry Pi Pico](https://www.raspberrypi.com/products/raspberry-pi-pico/) · [CircuitPython usb_cdc](https://docs.circuitpython.org/en/latest/shared-bindings/usb_cdc/)
- [Tauri v2 window customization](https://v2.tauri.app/learn/window-customization/) · [tauri-nspanel plugin](https://github.com/ahkohd/tauri-nspanel) · [NSPanel feature discussion](https://github.com/tauri-apps/tauri/issues/13034) · [Tauri v2 overlay field report (2026)](https://blog.manasight.gg/why-i-chose-tauri-v2-for-a-desktop-overlay/)
