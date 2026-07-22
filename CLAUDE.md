# Room of Devs (cursor-read-aloud)

Personal macOS tool that turns AI coding agents into a "room of devs" with
character voices. Claude Code sessions appear as persona cards (TMNT cast &
co.); when an agent finishes a turn its response is read aloud with its
ElevenLabs voice — on the Mac or streamed to a phone. Reply-capable (tmux)
agents support replies from the phone and a live "call" mode that narrates
intermediate progress. Family-of-one software: not for sale, but it IS
long-lived — maintainability matters now (see Refactor status).

## Tech Stack

- **Daemon** (`tts-server/`): Node + TypeScript run via `tsx` (no build
  step), chokidar file watching, `ws` for the panel WebSocket, SSE + plain
  HTTP for the mobile page. Playback via `ffplay`/`afplay`.
- **AI**: Gemini (`@google/genai`, `gemini-3.1-flash-lite`) rewrites agent
  text into character voice; ElevenLabs streams TTS (billed per character —
  the expensive one).
- **Desktop panel** (`panel/`): Tauri 2 + Vite + TypeScript. UI currently
  template-string DOM (refactor target → React components).
- **Mobile room** (`tts-server/mobile.html`): single-file HTML/CSS/JS served
  raw over LAN, token-gated (refactor target → componentized build).
- **Glue** (`scripts/`): bash utilities + Claude Code hooks; SwiftBar plugin
  (`plugins/`) is the legacy menu-bar UI, still installed.
- **State/IPC**: JSON + lock/pid files under `~/.cursor/tts/` — this is the
  IPC layer between hook processes and the daemon, not incidental style.

## Architecture flow

Claude Code hooks (Stop / UserPromptSubmit / AskUserQuestion / SessionEnd)
→ queue JSON in `~/.cursor/tts/queue/` → daemon watcher → Gemini rewrite →
ElevenLabs stream → Mac speakers or phone stream (`/live-audio/`). Room
state (`state/*.json`, `team_map.json`, `.now-playing.json`) is watched and
broadcast to the panel (WS) and mobile page (SSE) as one `PanelSnapshot`.
tmux team sessions (`team.sh`) accept injected replies
(`inject_prompt.sh`); live mode tails the session transcript
(`live-tail.ts`) and speaks intermediates while enabled.

## The two-location gotcha

The repo is NOT what runs. `scripts/setup.sh` installs to `~/.cursor/tts/`
(scripts, config, SwiftBar plugin, Room.app bundle), and `tts-server.sh
start|restart` syncs `tts-server/src/*.ts` + `mobile.html` from the repo
before launching. So:

- Edit files **in the repo**, never in `~/.cursor/tts/`.
- TypeScript/mobile.html changes take effect after
  `~/.cursor/tts/scripts/tts-server.sh restart`. That sync also stages the
  shared wire contract `packages/protocol/src/` → installed `src/protocol/`
  (in the repo, `tts-server/src/protocol` is a symlink to it). The installed
  daemon must never resolve modules back into the repo workspace — protocol
  deps (valibot) are direct deps of tts-server/package.json for that reason.
- `scripts/*.sh`, hooks, or SwiftBar changes take effect after re-running
  `scripts/setup.sh`.
- Panel changes need a rebuild (`pnpm tauri build --debug` in `panel/`,
  cargo comes from `~/.rustup/toolchains/stable-aarch64-apple-darwin/bin`),
  then `setup.sh` installs the bundle — and a RUNNING Room.app must be
  relaunched; setup.sh does not restart it.
- Runtime state lives in `~/.cursor/tts/`: `queue/`, `played/`, `failed/`,
  `replay/`, `state/`, `logs/hook.log`, `logs/server.log`, `config.json`,
  `live_sessions.json`, `team_map.json`.
- Re-running setup.sh `rm -rf`'s the installed tts-server dir — never let a
  long-lived process be born with its cwd there (bit us via tmux once).

## API credit efficiency (top priority)

Every queue item costs one Gemini call and one ElevenLabs synthesis. Rules
for any work in this repo:

- Verify the pipeline live only with SHORT text (< 200 chars) via
  `echo "short test" | ~/.cursor/tts/scripts/enqueue_manual.sh "Test"`, or
  process one file with `pnpm exec tsx src/index.ts once <queue-file>`. One
  run is enough — never loop live synthesis.
- If the thing being verified isn't synthesis itself, test WITHOUT burning
  credits: `processWithGemini` and `streamTTS` skip gracefully when API
  keys are absent; `signal.ts replay` re-plays saved audio free;
  `live-tail.ts once <transcript>` dry-runs the tailer.
- Don't regenerate cached phrase MP3s (`phrases.ts` skips existing files).
- Don't raise the `truncateForTTS` caps, change `gemini_model`, or change
  `elevenlabs_model_id` without asking.
- Guard the double-fire protections: ingest dedup hash, mute checks BEFORE
  API calls, live-mode gates + the hold-one buffer in `live-tail.ts`
  (speaking a turn-final there double-bills — the Stop path owns it),
  processing markers/locks in `audio.ts`, cached-only acks.

## Common commands

```bash
~/.cursor/tts/scripts/tts-server.sh restart   # deploy daemon + mobile changes
./scripts/setup.sh                            # install scripts/hooks/panel bundle
pnpm typecheck                                # type check all packages (root workspace)
pnpm check-fixtures                           # validate protocol fixtures vs schemas
echo "test" | ~/.cursor/tts/scripts/enqueue_manual.sh "Verify"   # cheap pipeline poke
pnpm exec tsx src/signal.ts replay "" 1       # free replay of last message
tail -40 ~/.cursor/tts/logs/hook.log          # full pipeline trace
cd panel && pnpm tauri build --debug          # rebuild Room.app (then setup.sh + relaunch)
```

## Code style

- Concise, simple solutions; propose the simpler path when one exists.
- **UI code is componentized** — React (or similar) with shared components
  and design tokens across the panel and mobile page. No new features into
  the mobile.html / panel main.ts monoliths; no UI built from innerHTML
  template strings. (Owner call 2026-07-21; the old "no frameworks" rule is
  dead — it produced 3k-line files.)
- Keep files focused; a file approaching ~500 lines is a smell worth
  raising, not a norm.
- Server-side filesystem state (JSON/lock/pid files) remains the IPC
  contract with the hook processes — change it deliberately, not casually.
- Databases: not forbidden, not sought. Local or hosted (e.g. Supabase) is
  fine IF it clearly earns its place (speed, capability); don't introduce
  one for state the filesystem layer already handles well.
- No CI/test-suite theater, but changed behavior gets verified (see
  Verifying below) and type checks stay clean.

## Refactor status (2026-07-21)

Owner-mandated refactor pending: componentize both UIs with shared pieces,
split the monoliths (mobile.html ~4.3k lines, panel/src/main.ts ~2.5k,
server hotspots audio.ts / panel-ws.ts / mobile-http.ts), audit + delete
legacy scripts/dead code, and update this file's layout/commands sections
as the architecture changes. Context + constraints live in the session
memory ("Refactor Mandate"). A mobile build step will replace the raw
mobile.html sync — keep this doc in lockstep when that lands.

## General preferences

- Use pnpm, never npm.
- Delegation roster: cursor-agent, codex, and Claude models only. Don't
  delegate to agy/Antigravity (owner call, 2026-07-07 — flaky headless).
- If asked to do too much work at once, stop and state that clearly.
- If computer use is helpful for completing or verifying work, shell out to
  gpt-5.6 with Codex (see the `codex-computer-use` skill). One-shot
  claude-in-chrome checks are fine; multi-step interactive MCP ping-pong
  from the main session is not.

## Session token hygiene

Long sessions are the Fable cost driver, not delegated agents. Per-task
cost ≈ context size × wakeup count (every background-task notification
re-reads the whole conversation).

- End of a shipped feature/round → tell the owner it's a good `/clear`
  point. Mid-task bloat → `/compact`. Never let sessions run for days.
- Browser/computer verification goes to codex; batch independent tool
  calls; prefer one delegated agent that reports once over many small
  interactive checks.
- Sequential pipelines (spec→build→review→fix) at one wakeup per stage are
  fine; don't add wakeups for things a delegate can verify itself.

## Picking the right models for workflows and subagents

Rankings, higher = better. Cost reflects what we actually pay
(subscriptions with generous limits rank cheap), not list price.
Intelligence is how hard a problem you can hand the model unsupervised.
Taste covers UI/UX, code quality, API design, and copy.

| model          | cost | intelligence | taste | reachable via                    |
| -------------- | ---- | ------------ | ----- | -------------------------------- |
| composer-2.5   | 8    | 5            | 5     | cursor-agent CLI (`agent`)       |
| grok-4.5       | 8    | 6            | 6     | cursor-agent CLI (`--model grok-4.5-fast-xhigh`; everyday tier `-fast-high`) |
| gpt-5.6 Sol    | 7    | 8\*          | 5     | codex CLI (`codex -m` Sol tier)  |
| gpt-5.6 Terra  | 8    | 7\*          | 5     | codex CLI (default tier)         |
| gpt-5.6 Luna   | 8    | 4\*          | 4     | codex CLI (`codex -m` Luna tier) |
| sonnet-5       | 5    | 5            | 7     | Agent/Workflow `model: 'sonnet'` |
| opus-4.8       | 4    | 7            | 8     | Agent/Workflow `model: 'opus'`   |
| fable-5        | 2    | 9            | 9     | Agent/Workflow `model: 'fable'`  |

\* Provisional (2026-07-11, unauditioned): GPT-5.6 replaced gpt-5.x with
three tiers — **Sol** (flagship frontier reasoning), **Terra** (balanced
daily driver), **Luna** (fast/lightweight for high-volume work). Ranked
from OpenAI's positioning, not our own testing; audition before relying on
them for anything intricate. Prose references to "gpt-5.6" without a tier
mean Terra. Sol burns subscription limits faster — reach for it where you'd
otherwise consider fable-5 for a codex-side task; Luna only for
trivial/mechanical work (composer-2.5 is usually the better pick anyway).

How to apply:

- Defaults, not limits — standing permission to escalate: if a cheaper
  model's output doesn't meet the bar, redo it with a smarter model without
  asking. Judge the output, not the price tag.
- Cost is a tie-breaker only; when axes conflict for anything that ships,
  intelligence > taste > cost.
- Bulk/mechanical work (clear-spec implementation, formatting sweeps,
  migrations, batch refactors): composer-2.5 or grok-4.5 via cursor-agent
  (grok audition 2026-07-08: passed a 9-file cross-module task with
  distinction; prefer grok for trickier multi-file work, composer for pure
  mechanical) — effectively free, runs in an isolated worktree.
- Anything user-facing (both UIs, spoken-text prompts, character copy)
  needs taste ≥ 7: sonnet-5 minimum, opus-4.8/fable-5 preferred. The
  Gemini system prompts in `gemini.ts` and `dynamic-response.ts` directly
  shape what gets spoken — prompt edits are user-facing work.
- Reviews of plans/implementations: fable-5 or opus-4.8, optionally
  composer-2.5 or gpt-5.6 (Sol for deep reviews) as an extra independent
  perspective (see the `codex-review` skill).
- Never use Haiku. For trivial work, composer-2.5 or gpt-5.6 Luna.

Mechanics:

- **Check CLI availability before delegating** — `command -v agent` /
  `command -v codex`; fall back to a Claude subagent if missing.
- composer/grok: `agent --worktree -p --force "prompt"` (see the
  `cursor-agent` skill). Always `--force` for tasks that write code.
- gpt-5.6: codex CLI — `codex exec` / `codex review`. Note: `codex review`
  accepts NO custom prompt; use `codex exec` with a self-contained prompt
  when you need one. Long runs exceed Bash's 10-min default timeout —
  background them.
- Claude models run via the Agent/Workflow `model` parameter.
- Parallel implementation agents that write code use worktree isolation;
  split work by file ownership so merges are trivial.

Repo-specific rules for delegated agents:

- cursor-agent `--worktree` checkouts don't inherit `.env` — copy it from
  the source checkout if the task needs live API calls (it almost never
  should; see credit efficiency).
- Delegated agents must NOT make live Gemini/ElevenLabs calls unless the
  task is explicitly about synthesis — state this in every delegated
  prompt.
- Verification gate for code tasks: `pnpm exec tsc --noEmit` clean in
  `tts-server/` AND `panel/` (when touched), `bash -n` on changed shell
  scripts, and a parse check on mobile.html's inline script while it
  remains a single file.

## Verifying this app

Output is audio + two UIs, so "does it work" = trigger the pipeline and
observe side effects:

1. Deploy: `tts-server.sh restart` (+ setup.sh / panel rebuild + Room.app
   relaunch when those layers changed).
2. Trigger cheaply: `enqueue_manual.sh` with short text (simulates a hook).
3. Observe instead of listen: `logs/hook.log` shows ingest → gemini →
   elevenlabs → audio; `replay/` gets an MP3 + JSON sidecar per playback;
   queue files move to `played/` on success; `curl` the mobile endpoints
   (`/snapshot`, `/thread/<id>`, `/action`) with the token from
   `mobile_url.sh`.
4. UI checks (panel window, mobile page rendering) need real computer use —
   delegate to codex via `codex-computer-use`.
5. `signal.ts replay "" 1` is a free end-to-end audio check.

Launching the app, screenshots, and short test audio are fine without
asking; ask first before clearing queues, deleting replay history, or
changing `~/.cursor/tts/config.json`.

## Docs index

| Doc | What it covers |
|---|---|
| `docs/spec-live-mode-v2.md` | Current live-mode architecture (call/chat views, /thread, activity feed, panel rules) |
| `docs/spec-live-mode.md` | v1 spec (superseded UI, still-valid server cost guards) |
| `docs/mockups/live-mode-v2/` | Concept round + cross-reviews behind the current UI |
| `docs/ideas-backlog.md` | Owner's someday list — check before proposing "new" ideas |
| `docs/plan-room-of-devs.md` + phase/design docs | Earlier room architecture history |

## Known issues / technical debt

- The monoliths (see Refactor status) — biggest debt in the repo.
- Legacy candidates to audit: `scripts/ingest_claude_code.sh` (bash
  fallback), piper-era leftovers, `build_read_aloud_notifier_app.sh`,
  `raycast/`, `clean_text.py`, the SwiftBar plugin's overlap with the
  panel. Audit references before deleting — hooks call into `scripts/`.
- Cross-persona spawn race and subagent-finish announce filtering
  (docs/ideas-backlog.md).
- No test suite; verification is manual/scripted per the section above.
