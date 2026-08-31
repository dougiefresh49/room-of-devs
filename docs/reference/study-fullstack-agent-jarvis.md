# Study: jaredrhod/fullstack-agent ("Jarvis") — what Room of Devs can borrow

_2026-08-22. Source: https://github.com/jaredrhod/fullstack-agent plus its four
component repos (`ai-memory-vault`, `backtalk`, `ai-visualizer`, `barehands`),
all read at their 2026-08-21 commits. Four independent Opus read-throughs
(one per repo) synthesized here; file:line references are to those repos.
Postplan: https://lm5jn9krrvxq.postplan.dev (draft `lm5jn9krrvxq`; re-upload with
`postplan upload <html> --draft lm5jn9krrvxq`). License: **AGPL-3.0-or-later** — borrow the ideas, re-implement in our own
code; don't paste._

## TL;DR

`fullstack-agent` is not a codebase — it is a **conductor prompt** (155-line
markdown wizard + a 60-line `start.sh`) that clones four small, independent
repos and wires them together with config paths. The four pieces total
~7k lines of hand-written code (Python + single-file HTML/canvas), no build
step, no tests, no framework. It is one person's tuned instrument, built
for a single user, a single agent, a single machine — the opposite shape
from Room of Devs (many personas, daemon + two UIs, phone, hooks, credit
discipline).

So **nothing ports wholesale**, and our daemon / snapshot bus / mobile
stream are strictly better infrastructure than anything in there. But the
repo is dense with *mechanisms* that were clearly earned in the field, and
five of them fill real gaps we have:

| # | Borrow | From | Effort | Why it matters to us |
| --- | --- | --- | --- | --- |
| 1 | **Spoken permission gate** — the agent asks out loud "may I run X?", spoken/phone yes-no/"details", deny-with-reason | backtalk | L | Our biggest missing conversational primitive; lands on the interpreter + reply plumbing we already have |
| 2 | **`present` verb + read-back** — an agent pushes an image/card/diff onto the panel & phone, spotlighted; and can *read back* what's on screen | barehands | S/M | The one thing in "the hand demo" that isn't about hands; agents currently cannot show us anything |
| 3 | **Eased state-fade grammar + amplitude envelope on the wire** | ai-visualizer | S + M | The cheapest route to the "futuristic, animated" feel the RIG target demands; we have no amplitude anywhere today |
| 4 | **Vault-style doc structure** (frontmatter, wikilinks, folder indexes, Jobs notes) over `docs/` + memory; Obsidian as a free viewer | ai-memory-vault | S/M | Postplan is overrun because it's a render surface, not an organizing layer — this is the organizing layer |
| 5 | **Sentence-chunk "first alone, then 2-batch" TTS + flush-at-tool-call** | backtalk | M | Cuts time-to-first-audio in live mode AND reduces ElevenLabs request count |

Plus a set of S-size hygiene wins (barge-in without closing the stream,
relative/debounced ducking, greeting-over-warmup, the demo/shot harness,
threshold-comment discipline). Full ranked list in §6.

---

## 1. What the repo actually is

```
~/my-agent/                      ← "home"; the person's CLAUDE.md (identity) lives here
  fullstack-agent/               ← the conductor: wizard .md + start.sh/update.sh
  ai-memory-vault/               ← "mind": Obsidian vault + CLAUDE.md templates (prose only)
  backtalk/                      ← "mouth": Python PTT → whisper → Claude Agent SDK → Kokoro/EL
  ai-visualizer/                 ← "face": Python static server + core.js + 4 canvas faces
  barehands/                     ← "hands": Python server + one 3110-line HTML (MediaPipe + three.js)
```

**The installer is a prompt.** `claude "set me up"` reads `CLAUDE.md`, which
routes to `fullstack-agent.md`: a six-phase wizard (find home / menu /
one interview / clone + run each piece's own wizard with answers
pre-filled / wire config paths / first spoken hello / desktop launchers).
Rules that make it work: one question at a time; never delete/move
anything the person built ("adoption" over creation); the conductor
decides *answers and order*, each leaf wizard owns *how*. It also carries
an unprompted marketing-skills upsell and Discord/YouTube funnel in Phase
6 — strip that mentally when judging the pattern.

**The wiring is a file bus.** backtalk writes four dotfiles
(`.voice_state` = one word, `.voice_waveform` = `{ts, samples[64]}` at
15 Hz, `.voice_loading_pid`, `.backtalk_session`); ai-visualizer's server
re-reads them on every 120 ms poll from the browser; barehands gets a
mirrored copy in its own dialect. No atomic writes, no schema, no
versioning. Our `~/.cursor/tts/` JSON + `PanelSnapshot` (epoch, rev)-gated
WS/SSE is the same idea done properly.

**Process model:** `start.sh` backgrounds two Python static servers and
runs backtalk in the foreground; Ctrl-C kills everything. That's the whole
supervisor.

---

## 2. backtalk — the voice (the most borrowable piece)

One Python process, asyncio + executor threads. Pipeline:

1. **Mic**: `sounddevice` 16 kHz int16, 30 ms frames. PTT = record while
   key held + ~180 ms tail, 250 ms minimum to swallow taps. **The button
   is the VAD** — no endpointing in PTT mode. Open-mic uses `webrtcvad(2)`
   with an 8-frame pre-roll ring, opens after ~120 ms of speech, closes
   after 480 ms silence, 30 s cap.
2. **STT**: `faster-whisper` `small.en` int8, in-process. (Same family as
   our `whisper-cli` PTT path — no news here.)
3. **Claude**: **not** the CLI — the **Agent SDK**, one long-lived
   `ClaudeSDKClient` per session, `system_prompt={"preset":"claude_code",
   "append": DISCIPLINE}`, `include_partial_messages=True`,
   `can_use_tool=…`, `resume=<id>`. Personality comes from the home
   folder's CLAUDE.md, deliberately; the appended prompt is spoken-delivery
   discipline only.
4. **Parse**: streams `text_delta`s, yields on sentence boundaries
   `(?<=[.!?])\s`, and **flushes the buffer on `content_block_stop`** so
   pre-tool filler ("On it — let me grab that") plays immediately instead
   of sitting silent through the tool run and then gluing onto the answer.
5. **TTS**: Kokoro (`bm_lewis`, local, ~200 ms to first audio) by default;
   ElevenLabs optional — `/v1/text-to-speech/{id}/stream`,
   `eleven_turbo_v2_5`, mp3 → ffmpeg stdin → raw PCM. Any EL failure falls
   back to Kokoro mid-sentence: **"degrade, never mute."**
6. **Playback**: one `sd.OutputStream` kept open for the process lifetime.

### Mechanisms worth stealing

- **The spoken permission gate** (`main.py:205-283`). `can_use_tool` is
  wired in *every* mode. The callback builds the ask **in code, never by
  the model** — `_human_what()` turns `Write{file_path}` into "create or
  change a file called X", `Bash` into "run a git command in the terminal,
  with several chained parts" if `&& || ; | $(` appear. It speaks the ask,
  then awaits a future the *next utterance* resolves. Approval is an exact
  normalized match against a `_YES` set — "yesterday" and "yes, but don't
  overwrite" both deny, and the denial text goes back to the model as the
  reason, so "no, put it in drafts" steers it. "details" reads the literal
  command and re-arms the 75 s clock; silence → spoken deny.
- **`spoke_from` ask-ownership** (`main.py:840-852`): if the utterance
  *started before* the ask was posed, it's an interrupt, not an answer —
  the ask denies silently and the words fall through as a new turn. We'll
  need exactly this the day replies and approvals share a channel.
- **Live auto-approve is a local flag, not an SDK flip** — the CLI refuses
  a live switch *into* `bypassPermissions`; only the safe direction is
  flipped for real.
- **`reset_turn()` drain** (`brain.py:207-254`): the SDK has one shared
  message stream; a cancelled turn leaves a stale `ResultMessage` and every
  later answer is off by one forever. Fix: interrupt, drain to the stale
  result, and rebuild the session if the drain times out. Irrelevant while
  we inject via tmux; mandatory if we ever adopt the SDK (the backlog
  already flags that spike).
- **Chunking for prosody** (`main.py:564-594`): sentence 1 ships alone for
  fast first audio; then **2 sentences per TTS request** because "single
  short sentences come out flat." Fewer EL requests, livelier output.
- **Barge-in that never closes the stream** (`mouth.py:341-352`): write
  three blocks of zeros instead of `abort()` — aborting re-triggers the
  onset blip on Bluetooth/USB. Stop is re-checked after every blocking
  write so a barge-in can't let the waveform feeder re-assert "speaking".
- **Ducking** (`ducking.py`): *relative* duck (only if Spotify > 30, to
  `max(30, cur*0.6)`), 0.5 s debounced restore so inter-chunk gaps don't
  cause volume seasickness, synchronous `restore_now()` on every exit
  path, and ducks on **PTT press** for the user's own voice.
- **Thinking sound as a killable subprocess** with a pid file; the mouth
  kills it the instant real speech dequeues; the visualizer defers to it
  via the same pid file (one flag file solves double-audio across two
  processes).
- **Greeting-over-warmup**: greeting plays while whisper loads and a hidden
  "Warmup ping" pays the prompt-cache toll; counters zeroed so plumbing
  isn't billed to the user's "usage report". A brain-connect failure
  *speaks the diagnosis* instead of dying silent.
- **Voice console**: exact phrases only, matched *alone* after
  normalization ("go hands free", "usage report" spoken as a plain-numerals
  CFO brief); writes its own config back, never clobbers an unparsable one.
- **pynput PTT gotchas**: `_held` flag filters OS key-repeat (else every
  repeat cancels the reply); alias map because pynput says `alt_r` not
  `right_alt`. macOS needs Input Monitoring for the hosting terminal.
- **`TROUBLESHOOTING.md` "land mines with warning signs"** — a five-item
  list of things future contributors must not "simplify away". A doc
  pattern our `docs/reference/` should copy.

### Where it's worse than ours

Single user/agent/machine; only speaks turns *it* originated (an agent in
another terminal is invisible); **no cost discipline** (no caps, no phrase
cache, no dedup, no mute-before-API — every chunk is a fresh billed
request); torn-read-prone bus; Kokoro/espeak install fragility; Spotify-only
ducking via AppleScript; a 75 s blocking await inside `can_use_tool` with
no queue. Our daemon already has the dedup hash, mute-before-API, phrase
cache, processing locks, and the phone path — keep all of it.

---

## 3. ai-visualizer — the face

`server.py` (stdlib, 127.0.0.1:8790) serves static files + `/state` +
`/config`; the browser polls `/state` every 120 ms. **Smartest line in the
server**: `if waveform age < 0.6s: state = "speaking"` — *a fresh waveform
IS speech, whatever the state file says*. Evidence beats declaration.
`--mock <state>` swaps the bus for a sine generator so every face performs
with no voice line.

`core.js` (377 lines) is the whole face SDK — the contract is tiny:

```
AV.state    "idle" | "listening" | "thinking" | "speaking"
AV.level    0..1 raw loudness        AV.env   0..1 smoothed envelope (USE THIS)
AV.samples  Float32Array(64) 0..1    AV.alert bool   AV.micLevel   AV.name/label/badge
```

A face = include the script, `AV.init()`, own rAF loop, call `AV.tick(dt)`
first, read the fields. Three modes: live (poll), demo (`?demo=1`, a
scripted 22 s idle→listening→thinking→speaking loop with synthesized
samples), and **shot** (`?shot=speaking&t=5000` renders a deterministic
frame burst then sets `document.title="ready"`) — a free screenshot
harness. Faces are registered by folder convention (`faces/<id>/index.html`
+ optional `face.json {title, tagline}`; `id` forced to the folder name so
metadata can't lie).

All four faces are **canvas 2D, zero dependencies**:

- **Board** (1066 lines, the flagship): procedurally routed PCB (45°-only
  traces, occupancy set), 34 components, a center chip carrying the
  agent's name. Idle = slow outward pulses; **listening reverses the flow**
  (pulses converge inward, cool cyan); thinking = traffic storm + the chip
  label **matrix-scrambles per glyph**; speaking = prismatic wash, chip
  scales with level, sound rings ripple off the die. Space = 25 s
  cinematic flythrough with a CSS `perspective() rotateX(16deg)` tilt.
- **Radial**: hand-rolled 32-bin DFT over the 64 samples, 80-bar
  starburst, 6200-grain particle orb in an ImageData buffer; syllables
  "detonate" the core. Heaviest.
- **Rain**: Matrix rain off a pre-rendered glyph atlas; when speaking, a
  portrait surfaces *inside* the rain (luminance-cropped, glyph-gridded,
  `lighter` composite). Cheapest impressive trick.
- **Neural**: seeded constellation brain, one field canvas, **whole-field
  bloom** (two downscale taps composited `lighter`) — per-element bloom
  "reads as pencil lines". A warped clock accelerates the whole scene's
  parallax while thinking.

### Mechanisms worth stealing

- **The envelope is the product** (`core.js:156-159`): adaptive
  normalization against a decaying peak, then 50 ms attack / 350 ms
  release. The 64-sample ring is rectified, peak-normalized, blended
  45/55 toward the newest frame, decays to zero when samples stop. At
  120 ms polling this smoothing *is* the interpolation — visuals never
  expose the poll rate.
- **Every state transition is an eased scalar, never a boolean**:
  `listenS/thinkS/speakS` fades with asymmetric taus (think eases in at
  380 ms, resolves at 160 ms) drive color, speed, geometry. This is why
  nothing jump-cuts. A noise gate with hysteresis learns the ambient floor
  in the first 3 s.
- **Semantic state mapping** (the board): input *reverses* flow, the name
  *melts* into a waveform, glyphs *scramble* while working. The PCB is
  decoration; the semantics are the part to copy.
- **Cheap futurism recipe**: near-black bg, one accent + one secondary
  hue, 0.3–0.6em letter-spacing on uppercase mono, thin corner brackets,
  fake instrument readouts (clock, FPS, "RECEIVING · LIVE"), cached
  radial-gradient glow sprites, soft-light film-grain tile scrolled in
  integer steps, vignette. `U.Descrambler` (20 lines) — text resolving out
  of glyph noise left-to-right — carries most of the "booting" feel.

### Load-bearing gap on our side

**Room of Devs has no amplitude anywhere.** `NowPlaying` carries
word-level ElevenLabs alignment tuples and the stage engine drives lipsync
off that karaoke timeline; Mac audio goes out through ffplay/afplay so the
panel WebView never sees a sample. Anything amplitude-driven on the panel
needs a daemon-side envelope first (§6 #3). On the **phone** it's free:
`<audio>` + an `AnalyserNode` in `src/audio/controller.ts`.

Weaknesses: polling (8 req/s/client), torn reads, full world rebuild on
resize, four 400–1100-line single files with zero shared chrome, DPR
clamped/unhandled on three of four faces.

---

## 4. barehands — how "the hand thing" actually works

Everything runs **in the browser**; Python never sees pixels. The page
imports MediaPipe **Tasks Vision** `HandLandmarker` from jsdelivr (WASM +
GPU delegate), loads Google's `hand_landmarker.task` model, and runs
`detectForVideo` on every *new camera frame* (gated on
`video.currentTime` changing) while physics/render run at display rate.
21 3-D landmarks per hand, two hands, detection confidence raised to 0.7
because busy backgrounds hallucinate hands.

**Camera → screen**: cover-fit the 1080p frame to the window, mirror X
(`1 - lm.x`, selfie), never flip Y. The cursor is the **midpoint of thumb
tip (4) and index tip (8)**, smoothed with a 0.45 EMA, with a 10-sample
history ring for velocity.

**The trick that makes it distance-proof**: `span` = wrist(0) →
middle-MCP(9) length. Every threshold is a *ratio against the hand's own
geometry*, so nothing retunes when you lean back.

**Pinch** is the core grab and is heavily engineered because a pinch and a
fist look alike in raw thumb–index gap:

- *The contrast law*: per-finger arch `|tip−wrist| / |mcp−wrist|`; a real
  OK-sign curls the index in while middle/ring/pinky arch out. A second
  regime handles profile views. `aspect > 6` is geometrically impossible →
  tracker hallucinating → hand muted.
- EMA (0.7/0.3, fire > 0.55) plus a 2-consecutive-clean-frame instant path.
- Enter/exit hysteresis with a **speed-aware release bar** (0.70 when the
  hand moves > 800 px/s, else 0.55) — motion blur inflates the gap mid-drag
  and was firing phantom throws.
- 400 ms probation (a pinch whose signature dies for 4 frames is dropped)
  and a **birth-speed ghost gate** (a pinch born > 900 px/s can't grab;
  heals when the hand slows below 500).

**Vocabulary**: pinch-drag (bbox hit-test + 24 px slop); tap (release
< 300 ms, < 24 px travel — opens/closes); hold-still ~1 s while carrying →
3-D rotate mode; two hands → scale (0.12–12×); **flick/throw** (peak
velocity over the last 220 ms > 1300 px/s *and* ≥ 40% retained at release
— a follow-through test); **clap** ("the prayer law": both wrists and MCP
rows within ~0.1 W, both hands open and provably apart within 800 ms, plus
a "vanish read" for when two palms merge into one detection); an empty
pinch dragged sideways scrubs a model's exploded view.

**The claw / force-pull** (the showpiece): pose detection uses **segment
dot products** (`(mcp→pip)·(dip→tip)` ≈ +0.9 straight, ≈ 0 bent) because
monocular depth can't tell a hook from a foreshortened straight finger.
Nine simultaneous conditions with two-band hysteresis — including the
counter-intuitive "pinky stays straight in a real claw" — and a transition
law (hooks must form from an open hand within 900 ms) so a relaxed arched
hand never arms it. Aim is the normal to the thumb-tip↔index-tip line,
cast as a cone (reject `perp > proj*0.25`, nothing closer than 160 px).
The target shakes, amplitude ramping 4 → 44 px over 4 s; only a **snap**
(gap ratio < 0.34, or a fast plunge) after ≥ 2 s of strain fires the pull.

**Rendering**: glass cards are plain DOM under `perspective: 1200px`, one
`transform` per frame; the **ring** is a 100-line 2-D canvas (inward
pulses listening, radar sweep thinking, band burning to hot white on an
RMS+peak auto-gain envelope when speaking; phases off `Date.now()` so two
pages animate in lockstep with no sync traffic); GLB models get a
per-item three.js renderer with a custom fresnel "holo" shader and a
hand-rolled bloom (Unreal bloom rejected — it stomps alpha). A
`?role=render` twin page receives all coordinates as window fractions for
OBS compositing (un-mirroring X; yaw/roll negate under the mirror, pitch
doesn't).

**The board and the agent's hands**: items are a flat array (card / img /
fx / model / panel / browser / orb / widget); **no layout persistence** —
reload = empty ring. The agent acts via `bin/board.sh` → POST `/cmd` with
one of **twelve allow-listed verbs**; `src` is resolved *only* inside
`./media/` (the "airlock"), with a unique-basename self-heal for wrong
folder guesses. **`present`** = find-or-create, fly to center in 0.45 s,
scale to ~55% of the short axis, `.dimmed` everything else (opacity 0.22,
desaturated); the spotlight self-cancels on grab, on exit, or on the next
present. `bin/board-state.sh` pretty-prints the scene into zones ("card
'THE PLAN' @ center [IN THE USER'S HAND]") so the agent can **look before
it talks**.

**Transport is inverted and clever**: the tracker POSTs its whole scene to
`/state` at ~45 Hz and **the response body of that POST is the command
queue** — one request serves both directions.

**Honest assessment**: the gesture gates are *robust* — every threshold
carries a comment naming the sample corpus it was fitted from, the
impostor pose it separates, and the failed theory it replaced;
`TROUBLESHOOTING.md` ships the tuning protocol ("sample the correct pose,
sample the impostor, find the canyon, cut mid-canyon") and a `P` sampler
that prints min/median/max of every metric. Better instrumentation than
most commercial gesture work. Everything around them is *demo-grade*: one
3110-line file of module-level `let`s, no tests/types/build, bbox
hit-test on every item every frame, fuzzy-title item lookup (an agent's
`yank` can hit the wrong card), zero auth on `/cmd` (fine on 127.0.0.1,
fatal if ever bound wider), CDN-dependent boot. It is one person's
instrument, fitted to one hand over weeks — excellent at being that, not a
component.

**Is it useful day-to-day for dev work?** No. Hands are on the keyboard;
a HID button or hotkey beats holding a pinch. The non-trick case is
*hands-full* moments (eating, across the room, on a call). Minimum viable
version if we ever want it: a low-res `HandLandmarker` in a hidden panel
window running **one** gesture — open palm held ≥ 600 ms toggles the PTT
grant — as just another dispatch source into `usePttGrant` / the
grant-guard belt. ~80 borrowed lines. Real cost is continuous webcam + GPU,
a camera-in-use indicator, and TCC prompts.

---

## 5. ai-memory-vault — the mind (the structure is the value, not the app)

_Revised 2026-08-22 after a direct re-read; the first pass undersold this._

Prose only: an 848-line wizard + four templates. **Obsidian does nothing at
runtime**: no plugins, no Dataview/Bases/Canvas, no graph instructions, and
Obsidian Sync is "NOT needed for anything in this system"
(`ai-memory-vault.md:78`). The agent reads and writes plain markdown on
disk. Obsidian's role is (a) the human's *viewer* — "A folder of markdown
the person never looks at is not the product" — and (b) a
convention-enforcer: `[[wikilinks]]`, YAML frontmatter
(`type: index|reference|guide|plan|log`, `status`, `project`), and
"rename inside the app so links auto-repair." Nobody hand-edits notes.

What *is* unique — and better than default Claude Code memory — is the
**structure**:

1. **External, unbounded memory with index-directed retrieval**: root
   index → folder index → note → wikilinks. The agent's rule is "know a
   thing exists, retrieve it in one step; hold only the current job"
   (`templates/CLAUDE.md` "What you are"). Default Claude memory is one
   flat `MEMORY.md` loaded whole every session — ours is 37 lines and
   already where a flat list stops scaling.
2. **Jobs notes**: one master note per recurring task listing exactly the
   context that task needs and nothing else ("read one note, have the
   whole job").
3. **Daily logs**: an append-only record across all sessions and tools,
   with a micro-index per day.
4. **Checkpoint discipline**: write as you go; update the folder index in
   the same pass; read back to verify. "Document the moment it ships, not
   the moment it's blessed."
5. **Compaction-aware boot split**: identity + can't-lapse rules in
   `CLAUDE.md` (survives compaction), everything else re-read from the
   index after compaction.
6. Claude Code's own `MEMORY.md` becomes a **pointer** into the vault so
   there is one memory layer, not two (`templates/MEMORY.md`).

Anti-sycophancy is encoded well too: "Push back when my ideas don't add
up, even when I'm the one having them", "Close the loop — when you ask me
a question, STOP", and a useful self-model: "You're not remembering those
sessions; you're made of them."

Limits: no pruning or verification (daily notes grow forever; index
accuracy is a promise the agent keeps, not a check — a 50-line
`vault-doctor` for orphans/drift/broken links is the obvious missing
piece); rules are prose and occasionally conflict ("full reads, no
skimming" vs "hold the job, load the rest just-in-time"); renaming via
shell `mv` silently breaks the link graph.

**What this means for us.** The real problem on our side is that Postplan
is overrun — and Postplan is a *publish/render* surface (no folders, no
search, no inter-draft links, 512 KB page cap, grouping is a hack on repo
metadata), not an organizing layer. His vault is exactly an organizing
layer. So:

- **Adopt the structure, not a second tree**: frontmatter + wikilinks +
  folder-index notes applied to `docs/` and the memory dir; a `Jobs/` set
  for recurring flows; the STATUS → thin-index + topic-docs rework already
  in the inbox *is* the folder-index pattern.
- **Obsidian as the viewer is free to try**: point a vault at `~/projects`
  so it spans repos — graph, backlinks, search, and a mobile app reading
  the same folder (Android; sync via the git plugin / Syncthing / paid
  Sync). It could take over the *reading* job from Postplan with no
  publish step and no size cap. Postplan stays for rendered deliverables.
- Keep Claude Code memory as-is for now; the pointer trick earns its
  place only if memory outgrows the flat index.

---

## 6. Ranked borrow list

Effort S/M/L; layer = daemon / panel / mobile / hooks / `packages/ui` /
docs. Cross-referenced to existing plans so nothing here is "new" where
it isn't.

1. **Spoken permission gate** — **L** — daemon + hooks + mobile.
   Today Claude Code's `AskUserQuestion`/permission prompts reach us only
   as text in the session. Target: a persona says "Raph here — I want to
   edit `tmnt.ts`. Yes, no, or details?", and the answer comes from PTT
   (interpreter routes it), a phone tap, or the HID button. Mechanism to
   copy: the ask is composed **in code** from the tool call (their
   `_human_what`/`_full_detail`), exact-match yes set, deny-with-reason
   passed back to the agent, "details" reads the literal command and
   re-arms the clock, silence → deny. Our substrate: the existing
   AskUserQuestion hook path, the interpreter's reply policy, the mobile
   `/action` endpoint. This is the "operator gates spoken by the room"
   backlog item made concrete, and Stage 2-ish of
   `design-conversational-layer.md`. Prereq: decide whether our Claude
   Code sessions expose tool-permission decisions to a hook at all (the
   PreToolUse hook can deny; a spoken *approve* needs the hook to block
   on the daemon — a bounded await like their 75 s).
2. **`spoke_from` ask-ownership** — **S** — daemon. Timestamp every
   inbound reply/intent; an utterance that *started* before the ask was
   posed is never an approval. Do this with #1, not after.
3. **`present` verb + read-back** — **S/M** — daemon + `packages/ui` +
   panel + mobile. New command kind (`~/.cursor/tts/` file drop, carried
   on `PanelSnapshot` — we already have WS+SSE, better than their
   piggybacked POST): `{kind: card|image|diff|note, title, body, src}`.
   One `PresentedCard` leaf renders on both UIs. Copy the **allowlist +
   media jail** (an agent may only stage files under one blessed dir; the
   unique-basename self-heal is a kind affordance for LLM callers), the
   **spotlight semantics** (one item center, rest dimmed, auto-ending on
   user interaction or next present), and a **read-back** script so the
   agent can see what's on screen before commenting. The backlog's "phone
   image attachments" item is the inbound twin of this.
4. **Per-persona memory in the rewrite** — **M** — daemon (`gemini.ts`).
   `personas/<name>/MEMORY.md` beside `characters.json`, injected into the
   Gemini character prompt: a hard-capped (~15 lines, one fact each) set
   of durable owner facts + a "Lessons" block folded in on correction,
   per their Job-note pattern. Raph's sarcasm should know the owner
   rejects task-board UIs. Bound it hard — it costs Gemini tokens per
   queue item forever. Prompt edits are user-facing → opus/fable authors
   them. Cheap-verify with `index.ts once <queue-file>`.
5. **Sentence-chunk streaming with "first alone, then 2-batch" + flush on
   tool-call boundary** — **M** — daemon (live-tail / stream-playback).
   Faster first audio in live mode, fewer EL requests (credit-positive),
   and it removes the "dead air then two thoughts glued" artifact around
   tool calls. Must respect the hold-one buffer and the Stop-path-owns-
   the-final rule.
6. **Eased state-fade grammar** — **S** — `packages/ui`. A tiny module
   returning `{idleS, workingS, speakingS, awaitingS}` scalars with
   asymmetric taus plus a warped-clock scalar; every badge/card/ring
   animation drives off those instead of booleans. Highest futurism-per-
   line in the whole study and needs no new data. Do it first.
7. **Amplitude envelope on the wire** — **M** — daemon + protocol +
   panel. Optional `env` (or a short sample ring) on `NowPlaying`,
   computed in `stream-playback` as the MP3 streams (RMS per ~50 ms
   window); port their `core.js:147-183` smoother client-side. Unlocks
   every amplitude-driven visual on the panel and would sharpen lipsync
   over pure alignment timing. Also steal the "fresh waveform IS speech"
   liveness heuristic for the speaking badge. **Phone first** (free via
   AnalyserNode) to prove the visuals before touching the protocol.
8. **Per-persona status ring / face mode** — **S→M** — panel (dock) +
   mobile. The barehands ring (100 lines of canvas: inward pulses
   listening, radar sweep working, hot-white band speaking) as a halo on
   each persona card, rendered outside React like `src/stage/`. Then,
   optionally, a fullscreen per-persona face in the dock NSPanel or a
   phone "lock-screen" view, copying the board's *semantics* (input
   reverses flow, name melts, glyphs scramble while working — the TMNT
   name on the chip is free). Fits the RIG's holo/instrument language;
   the PCB art itself is not the target.
9. **Whole-field bloom + cached glow sprites + `Descrambler`** — **S** —
   `packages/ui`. ~60 lines total; the difference between "glowing" and
   "pencil lines", and text that boots instead of appearing.
10. **Demo/shot harness** — **S** — panel dev tooling. A scripted state
    loop plus `?shot=<state>&t=ms` deterministic render that flags
    `document.title="ready"`: lets codex screenshot every persona state
    with zero Gemini/EL spend. Complements `mock-live.ts`.
11. **Vault-style structure over our docs + memory; Obsidian as viewer**
    — **S/M** — docs + memory dir. Frontmatter (`type/status/project`),
    `[[wikilinks]]`, one index note per folder kept in the same pass as
    any change, a `Jobs/` set ("read one note, have the whole job" —
    panel deploy, the parallel-worktree round, live-mode verify), and the
    compaction-aware split (can't-lapse rules in CLAUDE.md, re-read the
    index after compaction). Then open `~/projects` in Obsidian as a
    viewer for a week; if it wins, its mobile app + git sync can replace
    Postplan for *reading*. Serves session-token hygiene and the
    STATUS-is-a-mess inbox item directly. See §5.
12. **Rule provenance + "land mines" doc pattern** — **S** — CLAUDE.md /
    docs. Their rules carry their own history ("this replaced an earlier
    X rule, which turned out to be the loophole…") and backtalk ships a
    "things you must not simplify away" list. Our credit-guard rules and
    dated owner calls deserve the same treatment so a future session
    doesn't "clean up" a guard back into the bug it stops.
13. **Barge-in without closing the stream; relative/debounced ducking;
    greeting-over-warmup** — **S each** — daemon. Hygiene for the day we
    add interrupt-while-speaking; the ducking trio fixes seasickness;
    the greeting rides the existing phrase cache.
14. **Offline TTS fallback ("degrade, never mute")** — **M** — daemon.
    Kokoro as a zero-cost lane when EL fails *and* as a free audio half
    for the mock-live harness. Note: the local-TTS *cloning* lane is
    closed (`voice-lab-local-tts-postmortem.md`) — this is a fallback
    voice, not a character voice; don't reopen that question.
15. **Hand-gesture PTT** — **M** — panel. Only the one-gesture MVP above,
    only if a hands-full use case shows up. Ranked last on purpose.

### Explicitly not borrowing

- HTTP polling bus / dotfile state — ours is better.
- The Agent-SDK-instead-of-CLI process model *as a whole* — already a
  flagged spike in the backlog; take `reset_turn` only if that lands.
- Open-mic / hands-free listening — `design-conversational-layer.md`
  already rules: "PTT half-duplex is a feature"; full duplex may never be
  built. Their own `mic_mode` warning agrees.
- A *second* memory tree beside what we have — adopt the structure onto
  the existing `docs/` + memory dir instead (§5, #11). Obsidian the app is
  a viewer; trying it costs nothing.
- The prompt-as-installer for `setup.sh` — ours is deterministic and has
  the two-location invariant; prose would be a downgrade. The pattern
  *is* a good fit for a future **persona onboarding wizard** (pick
  character → audition voice → write `characters.json` + team map) and
  for fleet corefiles (conductor decides answers/order, leaf owns how).
- A free-layout board surface in the panel — a redesign, not a borrow;
  revisit only after `present` proves it earns screen space.
- The cinematic flythrough — demo-reel material, zero operational value.

---

## 7. Suggested sequencing

1. **Free wins, one small round**: #6 state fades + #9 bloom/descrambler
   + #10 shot harness in `packages/ui`/panel; #12 doc hygiene. No API
   spend, no protocol change, immediately visible under the RIG target.
2. **`present` + read-back (#3)** — small, high leverage, and it gives
   agents a reason to exist on screen beyond speaking.
3. **Phone amplitude + ring (#7 phone half, #8)** to prove the visual
   language cheaply, then the daemon envelope if it earns it.
4. **Doc structure + Obsidian trial (#11)**, then **per-persona memory
   (#4)** — a prompt-design task for opus/fable with a bounded-cost rule.
5. **Spoken permission gate (#1 + #2)** — the big one; spec it against
   the conversational-layer stages and the PreToolUse hook semantics
   before building. Bounded paid-lane testing only.

_Scratch clones used for this study live in `/tmp/fullstack-agent`,
`/tmp/backtalk`, `/tmp/ai-visualizer`, `/tmp/barehands`,
`/tmp/ai-memory-vault` (2026-08-21 heads); re-clone if they're gone._
