---
name: codex-computer-use
description: Ask Codex CLI (gpt-5.x) to run local app verification that needs computer use, browser automation, screenshots, app launching, or independent runtime inspection. This is how gpt-5.x is invoked for computer-use work. Use when the user asks Claude to test a flow, verify UI behavior (especially the SwiftBar menu), inspect the running tts-server, capture screenshots, or confirm implemented behavior that benefits from real UI interaction.
---

# Codex Computer Use

Use Codex as a separate local verification agent when the task needs real UI interaction, screenshots, or an independent runtime check outside Claude's current context. Codex on this machine has the computer-use plugin set up and MCP servers connected.

Do not use this for ordinary code reading, typechecking, or checks Claude can run directly (log tailing, queue-file inspection, replay sidecar reading — see CLAUDE.md "Computer use / verifying this app"). Launching apps or playing short test audio to verify requested work is fine without asking; ask first only if the run could disrupt the user's environment beyond that (closing their apps, changing system settings, clearing the TTS queue or replay history).

## What computer use is FOR in this repo

The pipeline's observable side effects are mostly files and logs — Claude can check those itself. Shell out to Codex when verification needs eyes or ears:

- **SwiftBar menu verification** — screenshot the menu bar dropdown to confirm menu items render correctly (replay section labels, session list, toggles, queue count). SwiftBar refreshes every 5s; after a change, run `~/.cursor/tts/scripts/setup.sh` first so the deployed plugin is current.
- **End-to-end flow checks** — trigger `enqueue_manual.sh` with a SHORT text (< 200 chars — live ElevenLabs/Gemini calls cost credits), confirm audio actually plays (ffplay process appears, replay file lands), and screenshot the menu state during/after playback.
- **Notification verification** — confirm macOS notifications appear when `notifications_enabled` is on.
- **Anything needing clicks** — exercising SwiftBar menu actions (Replay Last, mute toggles, speed changes) and confirming their effect.

## Workflow

1. Write a self-contained prompt: what to launch/click/screenshot, exact commands to trigger the pipeline, what "pass" looks like, and where to save artifacts (screenshots, notes) — use a mktemp dir.
2. Include the credit rule verbatim: "Use short test text under 200 characters; never loop or repeat live TTS synthesis."
3. Run it:

```bash
ARTIFACT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/codex-verify.XXXXXX")"
codex -C "$PWD" exec --dangerously-bypass-approvals-and-sandbox - < prompt.md > "$ARTIFACT_DIR/report.md"
```

   Codex runs can exceed Bash's 10-minute timeout — pass an explicit timeout or run in the background and poll for the report file.

4. Read the report and any screenshots; verify key claims (e.g. cross-check the replay dir or logs) before presenting results as confirmed.

## Reporting Back

Separate what Codex demonstrated with evidence (screenshot shows X) from what it merely asserted. If Codex could not complete the verification (no screen access, SwiftBar not running), report that plainly and fall back to file/log-based checks.
