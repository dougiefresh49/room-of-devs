# Arcade Button Controller — Hardware Push-to-Talk Interface

*Design doc — 2026-05-21*

---

## Overview

Use existing Fosiya arcade buttons + Raspberry Pi Model B as a physical push-to-talk and session control interface for the multi-agent voice system. Each colored button maps to a character/session, with LED feedback showing session state.

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

**Connection:** Pi connects to Mac via USB cable. The Pi's USB port provides both power and a serial data connection. On macOS, the Pi appears as `/dev/tty.usbmodemXXXX` or `/dev/tty.usbserial-XXXX`. Communication is bidirectional JSON-line protocol over serial (115200 baud).

**Why USB over WiFi:**
- Pi Model B has no WiFi chip (would need a USB dongle, which takes the only free USB port)
- USB is simpler: one cable for power + data, no network config, no reconnection logic
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

**Pi vs USB encoder direct to Mac:**
- USB encoder: simpler (one USB cable), but no LED control, buttons always appear as gamepad
- Pi: individual LED control, network-based (wireless possible), more flexible, but adds a device to maintain

**Pi Model B (2011) limitations:**
- No built-in WiFi (needs USB dongle or Ethernet)
- 256MB RAM (plenty for this use case)
- Single-core 700MHz ARM (button polling + WebSocket is trivial)
- Only 1 hardware PWM pin (GPIO 18) — software PWM for 5 LEDs may cause flicker on single-core. **Mitigation:** use a PCA9685 I2C LED driver ($3-5 breakout board) for smooth pulse/glow effects, or simplify LED states to on/off/blink only (no smooth pulsing) for the MVP
- If it dies, a Pi Zero W ($15) is a direct upgrade with built-in WiFi + more PWM capability

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
