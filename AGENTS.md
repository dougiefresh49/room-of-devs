# Agent instructions (codex / cursor-agent / any delegated model)

You are working in **Room of Devs**, a personal macOS tool that gives AI
coding agents character voices (TTS via ElevenLabs, rewrites via Gemini).
Full context lives in `CLAUDE.md` — read it if your task touches the
daemon, deploy flow, or playback. The rules below are the ones delegated
agents most often break; they are non-negotiable.

## Hard rules

- **NO live API calls.** Never call Gemini or ElevenLabs (or run anything
  that synthesizes audio) unless your task explicitly says it is about
  synthesis. ElevenLabs bills per character. `processWithGemini` and
  `streamTTS` skip gracefully when API keys are absent — that is the
  intended test mode. Worktrees don't inherit `.env`; do not go looking
  for one.
- **Edit the repo, never `~/.cursor/tts/`.** The install directory is
  overwritten on every deploy; changes there are lost and prove nothing.
- **Never** raise the `truncateForTTS` caps, change `gemini_model`, or
  change `elevenlabs_model_id`.
- **pnpm, never npm.** No new dependencies without the task saying so.
- Don't touch the double-fire protections (ingest dedup hash, mute checks
  before API calls, live-mode gates, processing markers/locks in the
  audio modules) unless your task is specifically about them.

## Verification gate (before you report done)

- `pnpm exec tsc --noEmit` clean in `tts-server/` — and in `panel/` if
  you touched it.
- `bash -n` on every shell script you changed.
- If you changed `packages/protocol/`, run `pnpm check-fixtures`.
- Changed `packages/mobile/src`? Note in your report that the committed
  `dist/` needs a rebuild (`pnpm --filter @room/mobile build`) — do the
  rebuild yourself only if the task says so.

## Repo facts that save you time

- `tts-server/src/protocol` is a **symlink** into `packages/protocol/src`
  — intentional deploy mechanism, don't "fix" it.
- The committed `packages/mobile/dist/` is **deliberate** owner policy —
  don't gitignore it.
- UI is componentized React with shared primitives in `packages/ui/` —
  no innerHTML/template-string UI. Components take domain values +
  callbacks only; fetch/WS/Tauri/audio never live inside components.
- State/IPC is JSON + lock/pid files under `~/.cursor/tts/` — that's the
  contract with hook processes; change shapes deliberately, not casually.
- Files approaching ~500 lines are a smell worth flagging, not a norm.
- Work items live in GitHub Issues (`gh issue view <n>`) with validation
  criteria per issue; the audit findings they cite are in
  `docs/archive/reviews/ptheory-audit-2026-07-26.md`.

## Reporting

Report what you verified and how, not just what you wrote. If a check
failed or was skipped, say so plainly — a wrong "all green" costs more
than an honest gap.
