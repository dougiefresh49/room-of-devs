# Voice-lab local TTS — postmortem (lane closed 2026-08-20)

**Verdict: local voice cloning is not viable at current local-model quality
for room-of-devs voices. ElevenLabs stays the speaker; Gemini stays the
writer. The corpus work was NOT wasted — it pays off through better
EL clones and prompt material (below).**

## What was tried (all owner-eared against an ElevenLabs original)

Test rig: A/B rows on the labeler `/montages` page; script = a real room
message ("[excited] Success! All one hundred twenty-four…"), reference =
either the corpus (Demucs-clean, embedding-verified TMNT-2012 clips) or the
original 92s ElevenLabs training sample for Donnie.

| Engine | Result (owner verdicts) |
| --- | --- |
| Voicebox Qwen3-TTS 1.7B (12 corpus clips) | Timbre close; monotone; sprints through punctuation |
| Qwen sentence-chunked w/ forced pauses | Pacing OK but jarring voice shifts between chunks |
| Qwen + `instruct` pacing | Placebo — `instruct` is silently dropped for cloned profiles (Base model) |
| Chatterbox / Chatterbox Turbo | "Knock-off Donnie"; Turbo mispronounced ~10 words in 7s |
| HumeAI TADA 1B/3B | "Awful" — SFX artifacts, robotic |
| Voicebox persona rewrite (`personality: true`, bundled Qwen3-1.7B LLM) | No-op: parroted the input text verbatim (transcript-verified) |
| VibeVoice-community 1.5B (92s EL-source ref, MPS, 1.14× RT) | Closest timbre yet; monotone + phantom background music (known: ref audio had YT ambience) |
| VibeVoice 1.5B (39s clean expressive corpus ref) | Expressive but unstable ("seizing", squeezed-cat artifacts) |

**Control test that settled it:** cloning from the *identical* audio the
ElevenLabs Donnie was trained on still sounded nothing like the EL voice —
the corpus was never the bottleneck; 1.5–2B-class local TTS is.

## Why the lane closed

Owner uses <40% of a $20/mo EL plan. Remaining local paths (VibeVoice-7B
≈20GB, doesn't fit the 24GB M4 Pro; quants are CUDA-only → rented GPU +
a Voicebox engine fork) are days of work to maybe-save ~$8/mo.
Same math kills the "replace Gemini with a local LLM" idea:
gemini-3.1-flash-lite is rounding-error cheap, and the one local rewrite
LLM we tested parroted. The valuable kernel — retrieving a character's
real lines as few-shot context for the rewrite — works with Gemini as-is.

## What survives / next steps

- **Corpus** (~40k labeled clips across 9 shows; TMNT-2012 fully
  embedding-verified): source for (a) **better ElevenLabs instant clones**
  (included in the existing plan; current voices were cloned from noisy
  YT rips — Demucs-clean corpus audio is strictly better), and (b) a
  per-character **voice bible** — real catchphrases/rhythms mined into the
  Gemini rewrite prompts (text tokens only).
- **Casting reels** built 2026-08-20 for the text-designed EL voices:
  `clips/montages/Casting-MMPR-1993/` (Jason, Billy, Zack, Kimberly,
  Trini, Tommy, Lord Zedd, Rita Repulsa, Goldar, Alpha 5, Zordon) and
  `Casting-TMNT-1990/` (Raphael, Leonardo, + a SPEAKER_05 mystery reel
  for owner ID). Owner reviews on `/montages`, then EL re-clone.
- **Voicebox kept** (Qwen TTS models + whisper-base + qwen3-1.7b LLM
  only; LuxTTS/Chatterbox×2/TADA×2 deleted, +10GB tada-codec HF cache
  cleared) for off-pipeline piddling. Its MCP agent integration
  (`voicebox.speak`, per-client voice binding) was studied for borrowable
  ideas — see the Voicebox-MCP notes in this folder if/when written up.
- VibeVoice install remains at `~/Movies/library/voice-lab/vibevoice/`
  (venv + 5.4GB model) — delete freely if space is needed.

## Pipeline facts worth keeping (hard-won)

- Voicebox concatenates all profile samples into ONE reference
  (`combine_voice_prompts()`); docs prescribe 3–5 samples × 10–30s.
  UI caps uploads at 30s/sample. `qwen_custom_voice` + `kokoro` cannot
  use cloned profiles; only Chatterbox Turbo speaks `[laugh]`-style tags.
- Voicebox API: SSE on `/generate/{id}/status`; urllib's default headers
  400 — use curl. Profile personality field only acts via the LLM
  rewrite path, never on voice.
- VibeVoice mirrors its reference: BGM in ref → BGM in output ("we
  intentionally decided not to denoise our training data"); flat ref →
  flat read. No expression tags (emergent only). 1.14× realtime on
  M4 Pro via MPS at 1.5B.
