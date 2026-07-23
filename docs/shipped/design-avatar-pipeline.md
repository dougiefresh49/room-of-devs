# Avatar Pipeline — 2D vs 3D Approaches

*Design doc — 2026-05-21*

---

## Constraints

- **No manual drawing or rigging** — user doesn't have the skills or time for Live2D Cubism manual rigging, character illustration, etc.
- **Prefer pay-for-service** — Meshy.ai ($20/mo), AI generation tools, marketplace purchases. A la carte, not a second job.
- **Must integrate with:** React/Electron web UI, tts-server WebSocket events, arcade button controller
- **Themes:** TMNT (primary), Halo, Titanfall (future)

---

## Option A: 2D Approach (Pre-made + AI-Generated)

### Asset Pipeline

```
Character concept (text/image prompt)
    → AI image generator (Midjourney / DALL-E / Flux)
        → Generate expression set (neutral, happy, angry, thinking, excited, talking)
        → ~6-8 images per character, consistent style
    → Crop to portrait format (transparent PNG)
    → Load into React UI as sprite sheets or individual images
```

### What You'd Buy/Generate

| Step | Tool | Cost | Time |
|------|------|------|------|
| Character portraits | Midjourney / DALL-E | ~$10-20/mo subscription | 1-2 hrs per character |
| Expression variants | Same AI tool + manual prompting | Included | 30 min per character |
| Mouth animation frames | AI or manual (open/half/closed) | Included | 15 min per character |
| Background scenes | Same AI tool | Included | 1 hr per theme |

### UI Implementation

```
┌─────────────────────────────────────────────────┐
│                                                 │
│  ┌──────────┐  ┌────────────────────────────┐   │
│  │          │  │ DONATELLO                   │   │
│  │ Character│  │ ─────────────────────────── │   │
│  │ Portrait │  │ "I refactored the auth hook │   │
│  │ (PNG)    │  │  and fixed that race        │   │
│  │          │  │  condition you mentioned..." │   │
│  │ 256x256  │  │                             │   │
│  │          │  │         ▌ (typewriter cursor)│   │
│  └──────────┘  └────────────────────────────┘   │
│                                                 │
│  [🔵 Leo: idle] [🔴 Raph: working] [🟢 Don: talking] [🟡 Mikey: idle]  │
│                                                 │
└─────────────────────────────────────────────────┘
```

**React component architecture:**
- `<AvatarOverlay>` — transparent Electron window or web overlay
- `<CharacterPortrait>` — swaps expression PNG based on agent state
- `<DialogBox>` — typewriter text effect synced to TTS audio
- `<SessionBar>` — shows all active sessions with status dots

**Expression switching driven by tts-server events:**
```
idle        → neutral.png
thinking    → thinking.png (eyes up, slight tilt)
talking     → cycle: talk_1.png ↔ talk_2.png (simple mouth open/close at ~200ms)
excited     → excited.png (when Gemini detects positive tone)
frustrated  → frustrated.png
```

**Lip-sync approach (simple):**
- No real viseme mapping — just alternate between mouth-open and mouth-closed PNGs at a fixed rate while TTS audio is playing
- Cheap but effective enough for 2D portraits

### Pros
- Fast to prototype (days, not weeks)
- AI-generated portraits are surprisingly good for this use case
- Tiny asset size (~2-5MB per character)
- Simple React implementation, no 3D libraries needed
- Easy to add new characters / themes

### Cons
- No smooth animation between expressions (just swaps)
- Lip-sync is fake (timed toggle, not audio-driven)
- Static poses — characters don't move, gesture, or interact with environment
- Needs consistent AI generation (tricky to get same character across expressions)

### Alternative 2D Approaches (from review)

**Pre-rigged Live2D models from marketplaces:**
- Buy pre-rigged Live2D models on Booth.pm or Nizima ($20-$50 each)
- Run VTube Studio (free) in the background — handles lip-sync and physics automatically
- Capture its window or use its API to embed in our UI
- Bypasses building a custom 2D renderer entirely

**Talking Head AI APIs (HeyGen, SadTalker):**
- Feed a single static Midjourney portrait + audio file → get back a video of the character speaking with real lip-sync
- Looks vastly better than mouth-open/mouth-closed toggle
- Trade-off: adds latency (API call to generate video), not real-time
- Could work for queue playback (not time-critical) but not for dynamic responses

---

## Option B: 3D Approach (Meshy.ai + React Three Fiber)

### Asset Pipeline

```
Character concept (text or reference image)
    → Meshy.ai Image-to-3D ($20/mo)
        → Generate 3D model from character art
        → Auto-rigged with skeleton
        → Export as GLB/GLTF
    → Load into React Three Fiber
    → Apply animations from Mixamo (free) or Meshy's 500+ library
    → Drive blend shapes from tts-server events
```

### What You'd Buy/Generate

| Step | Tool | Cost | Time |
|------|------|------|------|
| Character reference art | Midjourney / DALL-E | ~$10-20/mo | 30 min per character |
| Image-to-3D model | Meshy.ai | $20/mo | 5-10 min per character |
| Auto-rigging | Meshy.ai (included) | Included | Automatic |
| Animations | Mixamo (free) or Meshy library | Free / included | 30 min to pick & assign |
| Environment/scene | Meshy.ai or SketchFab | $20/mo or free models | 1-2 hrs per theme |

### UI Implementation

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│        ┌──────────────────────────┐                 │
│        │                          │                 │
│        │     3D Character         │                 │
│        │     (React Three Fiber)  │                 │
│        │                          │                 │
│        │   Donatello at his       │                 │
│        │   computer station       │                 │
│        │   in the sewer lair      │                 │
│        │                          │                 │
│        └──────────────────────────┘                 │
│                                                     │
│  ┌──────────────────────────────────────────────┐   │
│  │ DONATELLO: "I refactored the auth hook..."   │   │
│  └──────────────────────────────────────────────┘   │
│                                                     │
│  [🔵 Leo] [🔴 Raph] [🟢 Don] [🟡 Mikey]              │
└─────────────────────────────────────────────────────┘
```

**React Three Fiber component architecture:**
- `<Canvas>` — Three.js scene with camera, lighting
- `<CharacterModel>` — loaded GLB with animation mixer
- `<Environment>` — sewer lair scene (TMNT), Infinity (Halo), etc.
- `<DialogOverlay>` — HTML overlay on top of 3D canvas
- `<SessionBar>` — same as 2D

**Animation states driven by tts-server events:**
```
idle        → breathing loop, small sway, environment-specific idle (Mikey eating pizza)
thinking    → hand on chin, looking up
working     → typing at keyboard, looking at screen
talking     → viseme-driven lip-sync + speaking gesture animation
listening   → attentive pose, slight lean forward
excited     → wider stance, arms gesture
```

**Lip-sync approach (real visemes):**
- Use `lipsync` npm package or Rhubarb Lip Sync to analyze TTS audio
- Map phonemes to blend shape morph targets on the 3D model
- Requires the model to have mouth blend shapes (Meshy auto-rigged models may need manual adjustment)
- Fallback: same open/close toggle as 2D if blend shapes aren't available

### Pros
- Characters feel alive — smooth animations, real movement
- Full environment scenes (sewer lair, Halo base)
- Proper lip-sync possible with blend shapes
- Characters can interact with each other and the environment
- Much cooler demo / showcase value

### Cons
- More complex implementation (Three.js, GLTF loading, animation mixing)
- Meshy auto-rig quality is hit-or-miss — may need manual cleanup in Blender
- Heavier assets (~10-50MB per character + environment)
- Performance considerations (GPU usage, battery on laptop)
- **Meshy auto-rigging generates skeletal bones but NOT facial blendshapes** — lip-sync visemes require blendshapes that would need manual Blender work or a different tool

### Alternative 3D Approach: Ready Player Me (from review)

**Ready Player Me (RPM)** is free and solves the blendshape gap:
- Generate a character from an AI-generated image
- Exports `.glb` with **52 ARKit facial blendshapes** included
- Feed audio visemes directly into RPM model in React Three Fiber for proper lip-sync
- No Blender post-processing needed
- Trade-off: RPM characters have a specific art style (cartoon-ish humanoid). Custom TMNT turtle models would still need Meshy/Blender. But for humanoid characters (Karai, Shredder, Splinter) RPM could work great.

---

## Recommendation: Start 2D, Evolve to 3D

### Phase 1: 2D MVP (1-2 days)

Build the dialog overlay with AI-generated portraits. This gives you:
- Visual feedback that a character is talking
- Character identity reinforcement
- Something to demo immediately
- Foundation for the React UI that 3D will slot into later

### Phase 2: 3D Characters (1-2 weeks, when ready)

Replace `<CharacterPortrait>` with `<CharacterModel>` in the same React app:
- Generate models in Meshy.ai
- Load GLB in React Three Fiber
- Apply Mixamo animations
- Lip-sync if blend shapes are available, else toggle fallback

The dialog box, session bar, and WebSocket event system carry over unchanged.

---

## Physical Button Integration

### Button → Avatar Interactions

| Button Action | Avatar Response |
|--------------|----------------|
| **Hold color button** (push-to-talk) | Target character turns to face camera, "listening" pose. All other characters continue idle. |
| **Release button** (processing) | Character's expression shifts to "thinking" — hand on chin (3D) or thinking.png (2D) |
| **Response arrives** (playing) | Character animates "talking" with lip-sync. Dialog box shows text. |
| **Press 1P** (spawn session) | In 3D: new station in the lair lights up. In 2D: new empty portrait slot appears. |
| **Press 2P** (open chat) | Avatar view slides/minimizes, master chat UI takes focus |
| **2P double-tap** (replay) | Character replays last line. In 3D: "let me say that again" gesture. |
| **Coin** (assign mode) | Unassigned character slots pulse/glow. Pressing a color button assigns it. |
| **Joystick up/down** | Camera pans between characters (3D) or scrolls chat history (2D) |

### LED ↔ Avatar State Sync

The arcade button LEDs and avatar states should be in sync:

```
tts-server maintains canonical state per session:
  { sessionId, buttonColor, agentState, characterName }

Both Pi (LED) and web UI (avatar) subscribe to the same WebSocket events:
  → { event: "state-change", button: "blue", state: "talking" }
  → Pi sets blue LED to fast-blink
  → Web UI sets Leonardo model to talking animation
```

---

## Proposed Tech Stack

### 2D Path
- **Asset generation:** Midjourney or DALL-E for character portraits
- **UI framework:** React + CSS animations
- **Packaging:** Electron (transparent overlay window) or standalone web app
- **Text animation:** Custom typewriter component
- **Lip-sync:** CSS class toggle on timer (mouth-open / mouth-closed PNGs)

### 3D Path
- **Asset generation:** Midjourney (reference art) → Meshy.ai (image-to-3D) → Mixamo (animations)
- **UI framework:** React Three Fiber (@react-three/fiber + @react-three/drei)
- **Model format:** GLTF/GLB (Three.js native)
- **Animation:** Three.js AnimationMixer, driven by state machine
- **Lip-sync:** Rhubarb Lip Sync or `lipsync` npm → blend shape morph targets
- **Environment:** SketchFab free models or Meshy-generated scenes
- **Packaging:** Same Electron app, just heavier

### Shared Infrastructure
- **tts-server WebSocket:** new `/ws/avatar` endpoint broadcasts agent state events
- **State manager:** lightweight state machine per session (idle → thinking → working → talking → idle)
- **Audio replay:** saved audio files enable "say that again" button with avatar re-animation

---

## Cost Estimate

| Item | 2D Path | 3D Path |
|------|---------|---------|
| AI image generation | $10-20/mo | $10-20/mo |
| Meshy.ai | — | $20/mo |
| Mixamo | — | Free |
| SketchFab (environments) | — | Free tier |
| Total per month | ~$15 | ~$35 |
| Time to first demo | 1-2 days | 1-2 weeks |

---

## Key Links

- [Meshy.ai](https://www.meshy.ai/) — Image-to-3D, auto-rigging, animation library
- [Ready Player Me](https://readyplayer.me/) — Free 3D avatars with 52 ARKit blendshapes
- [Mixamo](https://www.mixamo.com/) — Free character animations
- [React Three Fiber](https://docs.pmnd.rs/react-three-fiber) — React renderer for Three.js
- [Rhubarb Lip Sync](https://github.com/DanielSWolf/rhubarb-lip-sync) — Audio-to-viseme mapping
- [pixi-live2d-display](https://github.com/guansss/pixi-live2d-display) — Live2D in browser
- [Booth.pm](https://booth.pm/) — Pre-rigged Live2D model marketplace
- [Nizima](https://nizima.com/) — Official Live2D model marketplace
- [VTube Studio](https://denchisoft.com/) — Free Live2D avatar app with auto lip-sync
- [Meshy + R3F tutorial](https://hack-lab-256.com/en/react-three-js-meshy-3d-model/1155/)
