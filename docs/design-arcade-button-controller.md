# Arcade Button Controller — Hardware Push-to-Talk Interface

*Design doc — 2026-05-21 · architecture updated 2026-07-07*

---

## Architecture update (2026-07-07)

The architecture below evolved after a hands-on test. **Read this first — the Pi Model B path is retired.**

- **Button input ships encoder-direct, no Pi at all.** The Fosiya kit's USB encoder plugged straight into the Mac enumerates as a standard HID gamepad ("Generic USB Joystick" in Game Controllers), with all 8 buttons attached (4 color + coin + 1P + 2P, plus joystick). tts-server reads it directly via `node-hid`; button-index→action mapping is discovered by a **learn mode** (press-to-name), so physical wiring never matters. This is **Phase 3a** in docs/plan-details-phase3-4.md — pure software, buildable immediately. In this mode the LEDs are encoder-powered and light on their own (no state feedback).
- **The Raspberry Pi Model B (2011) is retired.** For the future controllable-LED phase (**Phase 3b**), a **Raspberry Pi Pico (~$5)** takes its place: native USB CDC serial (`/dev/tty.usbmodem*`, one cable for power + data — exactly the JSON-line protocol below), no Linux/SD card, no boot-time serial console to disable, no UART adapter, no 3.3V/5V hazard on the Mac link. The firmware becomes a ~100-line MicroPython/CircuitPython script instead of RPi.GPIO on Linux. Buttons stay on HID; the Pico only drives LEDs.
- **If you follow the legacy Model B path anyway**, two things the original doc omitted will bite (details inline below at the Connection section): the UART login console must be disabled (`raspi-config`) or it garbles the JSON protocol, and the USB-TTL adapter must be 3.3V logic with GND/TX/RX only, TX↔RX crossed — a 5V TX into the Pi's RX can kill the SoC.

Sections below are kept as originally written except where marked; treat Pi-specific setup as legacy reference.

---

## Overview

Use existing Fosiya arcade buttons as a physical push-to-talk and session control interface for the multi-agent voice system — the USB encoder connects directly to the Mac as a HID gamepad (see architecture update above; the original Raspberry Pi Model B design is legacy). Each colored button maps to a character/session, with LED feedback showing session state reserved for the Pico-based Phase 3b.

---

## Hardware Inventory (Already Owned)

- **Fosiya 2-Player Arcade Kit** — 20x LED illuminated push buttons (mixed colors), 2x USB encoders, 2x joysticks
- **Raspberry Pi Model B** (2011, rev 1) — GPIO header, Ethernet, USB, 3.5mm audio out
- **DIY cardboard housing** (GooseZ box prototype) — functional but needs a proper 3D-printed enclosure

---

## Button Mapping (TMNT Theme)

| Button | Color | Hold-to-Talk Target | LED Behavior |
|--------|-------|-------------------|--------------|
| Center/White | White | Orchestrator (Master Splinter) | Solid = listening, pulse = processing |
| Top-Left | Blue | Leonardo session | Blink = session working, solid = idle/ready |
| Bottom-Left | Red | Raphael session | Same pattern |
| Top-Right | Teal/Purple | Donatello session | Same pattern |
| Bottom-Right | Yellow/Orange | Michelangelo session | Same pattern |
| 1P | — | Spawn new Claude Code session | Flash all buttons during "assign mode" |
| 2P | — | Open master chat UI (Electron/web) | Quick press = open, long press = close |
| Coin | — | Link/assign a new session to a color button | LED of target button flashes to confirm |
| Joystick | — | Volume control (up/down) or scroll sessions | Could also navigate chat history |

### Button Interaction Patterns

**Push-to-talk (color buttons + white):**
- **Hold** = mic open, recording via whisper.cpp on Mac
- **Release** = stop recording, STT transcribes, routes to target session
- **LED solid** while held (recording indicator)
- **LED pulse** while waiting for response
- **LED blink fast** = session is actively generating

**Session management (1P / Coin / 2P):**
- **1P press** = spawn a new Claude Code session (tmux). All unassigned color buttons flash. Press a color button to assign.
- **Coin press** = enter "link mode". Next color button pressed gets linked to a running but unassigned session.
- **2P quick press** = open/focus the master chat web UI
- **2P long press (2s)** = stop all audio / mute toggle
- **2P double-tap** = "say that again" (replay last audio message)

---

## Architecture

```
┌──────────────────────────┐          ┌──────────────────────────────┐
│   Arcade Button Box      │          │         MacBook              │
│   (Raspberry Pi inside)  │          │                              │
│                          │   USB    │                              │
│  GPIO ←→ Buttons + LEDs  │◄────────►│  tts-server (Node.js)       │
│  Python script            │  Serial  │   ├─ Serial listener        │
│   ├─ Read button GPIO    │          │   ├─ whisper.cpp (STT)       │
│   ├─ Control LED GPIO    │          │   ├─ Route to Claude session │
│   ├─ Serial over USB     │          │   ├─ ElevenLabs TTS          │
│   └─ LED state machine   │          │   └─ LED state events back   │
│                          │          │                              │
└──────────────────────────┘          └──────────────────────────────┘
```

**Connection (legacy — Model B path; see architecture update):** Pi connects to Mac via a USB-to-TTL serial adapter (~$6) wired to the Pi's UART pins (GPIO 14 TX / GPIO 15 RX + GND). **Correction (2026-07-06):** the Pi Model B cannot do USB gadget mode (its USB ports are host-only), so its USB port alone can't carry data to the Mac — the UART adapter is the data path, and a separate USB cable powers the Pi. On macOS the adapter appears as `/dev/tty.usbserial-XXXX`. Communication is bidirectional JSON-line protocol over serial (115200 baud). **Two mandatory safety/setup steps the legacy path requires:** (1) **3.3V logic only** — buy an FTDI-based adapter (driverless on macOS) or set the adapter's voltage jumper to 3.3V; a 5V adapter TX into the Pi's 3.3V RX can permanently damage the SoC. Wire **GND, TX, RX only**, with **TX↔RX crossed** (adapter TX → Pi RX GPIO15, adapter RX → Pi TX GPIO14) — never the 5V pin. (2) **Disable the serial login console** before first use: `sudo raspi-config` → Interface Options → Serial Port → login shell **No**, serial hardware **Yes**. On 2011-era Raspbian images the UART runs a getty by default, which answers JSON lines with login-prompt garbage. Verify with `ls /dev/tty.usb*` on the Mac before touching software. *(The Pico replacement makes all of this moot — its own USB is the serial port.)*

**Why USB serial over WiFi:**
- Pi Model B has no WiFi chip (would need a USB dongle, which takes the only free USB port)
- Serial is simpler: no network config, no reconnection logic (two cables — power + UART adapter — but zero moving parts in software)
- Serial is lower latency than WiFi WebSocket (~1ms vs ~5-20ms)
- More reliable — no dropped connections from WiFi interference
- If upgrading to Pi Zero W later, can switch to WiFi without changing the message protocol

### Data Flow: Push-to-Talk

```
1. User holds BLUE button (Leonardo)
2. Pi → WebSocket → Mac: { event: "button-down", button: "blue", target: "leonardo" }
3. Mac: starts mic recording (whisper.cpp)
4. Mac → Pi: { event: "led", button: "blue", state: "solid" }
5. User releases BLUE button
6. Pi → WebSocket → Mac: { event: "button-up", button: "blue" }
7. Mac: stops recording, runs whisper.cpp STT
8. Mac → Pi: { event: "led", button: "blue", state: "pulse" }
9. Mac: sends transcribed text to Leonardo's Claude Code session
10. Mac: receives Claude response → Gemini processing → ElevenLabs TTS
11. Mac → Pi: { event: "led", button: "blue", state: "blink-fast" }
12. Mac: plays audio response
13. Mac → Pi: { event: "led", button: "blue", state: "idle" }
```

### Data Flow: Spawn + Assign Session

```
1. User presses 1P button
2. Pi → Mac: { event: "button-press", button: "1p", action: "spawn-session" }
3. Mac: spawns new Claude Code tmux session
4. Mac → Pi: { event: "assign-mode", unassigned_buttons: ["teal", "yellow"] }
5. Pi: flashes teal + yellow LEDs
6. User presses TEAL button
7. Pi → Mac: { event: "assign", button: "teal", session_id: "<new-session>" }
8. Mac: links teal button to new session, sets voice to Donatello
9. Mac → Pi: { event: "led", button: "teal", state: "idle" }  (solid = assigned & ready)
```

---

## Raspberry Pi Setup

### GPIO Pin Layout (Pi Model B)

The Pi Model B has 26 GPIO pins. We need:
- 5 button inputs (white, blue, red, teal, yellow) + 3 utility (1P, 2P, Coin) = 8 inputs
- 5 LED outputs (one per color button) = 5 outputs
- Total: 13 GPIO pins (fits within the 17 usable GPIO pins on Model B)

### Python Script (button_controller.py)

Dependencies: `RPi.GPIO`, `websockets`, `asyncio`

Core responsibilities:
- Poll GPIO pins for button state (press/release/hold)
- Debounce button inputs (~20ms)
- Drive LED states (off, solid, blink, pulse, fast-blink) via PWM
- Maintain WebSocket connection to Mac's tts-server
- Reconnect on disconnect with exponential backoff

### LED State Machine

```
States: off → idle (dim solid) → recording (bright solid) → processing (pulse) → playing (fast blink) → off
```

Each button has independent LED state. The Pi runs a simple async loop:
- Check WebSocket for LED commands from Mac
- Update GPIO PWM duty cycle per button
- Blink/pulse patterns via timer-based toggle

---

## 3D Printed Enclosure Ideas

### TMNT Sewer Theme
- Manhole cover shape (round, with cross-pattern grill)
- Buttons visible through "grate" openings
- Sewer pipe texture on sides
- Green/gray PLA filament
- Splinter (white) button in center, four turtle colors at compass points

### Minimal/Clean
- Simple rectangular box with beveled edges
- Each button in a recessed well with its character name laser-etched
- Matte black with colored button accent rings

### Dimensions
- ~200mm x 150mm x 60mm (small enough for desk, big enough for comfortable button spacing)
- USB-C breakout for Pi power
- Ethernet port accessible (or WiFi dongle internal)
- Optional: small OLED screen (128x64) showing current session names

---

## Trade-offs & Alternatives

**Pi vs USB encoder direct to Mac:** *(resolved 2026-07-07 — the encoder won; see architecture update)*
- USB encoder: simpler (one USB cable), no LED control, buttons appear as gamepad — **"appears as gamepad" turned out to be a feature, not a limitation: `node-hid` reads it directly, and learn mode makes the wiring order irrelevant.** This is the shipped input path.
- Pi: individual LED control, more flexible, but adds a device to maintain — retired for input; a Pi **Pico** covers the LED-control half only (Phase 3b)

**Pi Model B (2011) limitations:** *(legacy — these limitations are why the Pico replaced it for Phase 3b)*
- No built-in WiFi (needs USB dongle or Ethernet)
- 256MB RAM (plenty for this use case)
- Single-core 700MHz ARM (button polling + WebSocket is trivial)
- Only 1 hardware PWM pin (GPIO 18) — software PWM for 5 LEDs may cause flicker on single-core. **Mitigation:** use a PCA9685 I2C LED driver ($3-5 breakout board) for smooth pulse/glow effects, or simplify LED states to on/off/blink only (no smooth pulsing) for the MVP
- If it dies, a Pi Zero W ($15) was the planned upgrade — moot now: the Raspberry Pi Pico (~$5) is the chosen LED controller (native USB serial, PWM on every pin, no OS)

**Project Mirage / Dune comparison:**
- Dune is a 3-button USB-C context-aware keypad for macOS ($TBD, early bird shipping May 2026). Calendar-aware, AI agent triggers, mic/camera toggles.
- Our build is more powerful: per-button LED feedback, push-to-TALK (not just push-to-trigger), multiple buttons for multi-agent routing, character identity per button
- But Dune's form factor is inspirational — clean, minimal, desk-friendly

**Hold-to-talk vs Tap-to-toggle:**
- Hold-to-talk is intuitive (like a walkie-talkie) but causes hand fatigue for long messages (45+ seconds)
- **Alternative: tap-to-start, tap-to-stop** with LED solid while recording. More ergonomic for complex explanations.
- Could support both: short press (<500ms) = tap-toggle mode, hold (>500ms) = push-to-talk mode

**Microphone placement:**
- Design assumes Mac's built-in mic for recording. If the button box is across the desk, audio quality drops.
- **Options:** (1) use Mac mic (simplest, good if box is near Mac), (2) plug a USB mic into the Pi and stream audio over network (more complex but location-independent), (3) use a desk mic positioned between you and the Mac
- MVP: Mac mic. Revisit if audio quality is a problem.

**Audio interruption / ducking:**
- If Leonardo is speaking and you press Raphael's button: immediately stop Leo's TTS playback, start recording for Raph
- If same character's button pressed while they're speaking: stop current playback (acts as "skip" / "I heard enough")
- The tts-server already has `stopCurrent()` — wire it into button-down events

---

## Implementation Phases

*(Superseded 2026-07-07: current phasing lives in docs/plan-details-phase3-4.md — Phase 3a = encoder-direct HID input, Phase 3b = Pico-driven LEDs. Phases A-D below are the original Pi plan, kept for reference; the transport experiments in A/B are unnecessary on both current paths.)*

### Phase A: Proof of Concept (1-2 hours)
- Wire 2 buttons to Pi GPIO (one color + white)
- Python script reads button press/release
- HTTP POST to Mac on button events (simpler than WebSocket for MVP)
- Mac starts/stops mic recording on events
- No LED control yet, no STT — just prove the button → Mac pipeline

### Phase B: Full Button Box (half day)
- Wire all 8 buttons + 5 LEDs
- HTTP POST for button events, SSE (Server-Sent Events) for LED updates from Mac
- Simple LED states: on/off/blink (no smooth pulse — avoids software PWM issues on Pi Model B)
- **Hardcode 4 color buttons to 4 fixed TMNT sessions** that auto-start with the server (skip dynamic assign for MVP)
- 1P = replay last message, 2P = open master chat, Coin = stop all audio
- 3D print enclosure

### Phase C: Voice Integration (depends on Phase 2 of main project)
- whisper.cpp integration on Mac side
- STT → intent routing → Claude session
- Response via ElevenLabs → audio playback
- Full LED feedback loop
- Upgrade to WebSocket for lower latency

### Phase D: Dynamic Session Management (later)
- 1P spawns new sessions, Coin enters assign mode
- PCA9685 I2C LED driver for smooth pulse/glow effects
- Optional: USB mic on Pi for location-independent recording

---

## Key Links

- [Fosiya Arcade Kit (Amazon)](https://www.amazon.com/dp/B07WNNVVXY)
- [RPi.GPIO docs](https://sourceforge.net/projects/raspberry-gpio-python/)
- [Project Mirage](https://www.projectmirage.ai/) — inspiration for form factor
