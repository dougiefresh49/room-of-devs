# Room of Devs (cursor-read-aloud)

## What it is

A personal macOS tool that turns AI coding agents into a "room of devs" with character voices. Claude Code sessions appear as persona cards (TMNT cast and co.); when an agent finishes a turn, Gemini rewrites the response into the character's voice and ElevenLabs speaks it, on the Mac or streamed to the owner's phone. Family-of-one software: not for sale, but long-lived, so maintainability matters. GitHub repo `dougiefresh49/room-of-devs`; the local folder keeps its old name on purpose (hooks and sessions point at it).

Pipeline: Claude Code hooks (Stop / UserPromptSubmit / AskUserQuestion / SessionEnd) queue JSON into `~/.cursor/tts/queue/`; the daemon (`tts-server/`, Node + TypeScript via `tsx`, chokidar) rewrites with Gemini, streams ElevenLabs TTS, and plays it (`ffplay`/`afplay`) or serves it to the phone. Room state (`state/*.json`, `team_map.json`, `.now-playing.json`) is watched and broadcast as one `PanelSnapshot` to the panel (WebSocket) and the mobile SPA (SSE). tmux team sessions (`team.sh`) accept replies injected from phone or panel (`inject_prompt.sh`); live mode tails a session's transcript and speaks intermediate progress. T3 Code sessions (Theo's coding app, which the owner runs from the phone) join the room as SDK cards. Surfaces: the Tauri panel (`panel/`, two windows from one bundle, `main` and the floating `dock`), the mobile SPA (`packages/mobile/`, token-gated at `/`), tmux teams, live/call mode on the phone.

The repo is not what runs. `scripts/setup.sh` installs scripts, config and Room.app into `~/.cursor/tts/`; `tts-server.sh restart` syncs `tts-server/src/*.ts` (plus the protocol package and mobile `dist/`) into the install before launching. Edit the repo, then deploy the layer.

## What makes this special

**Voice-first, character-first.** The room reads as animated characters on top of an agentic workflow, never as a task board. The avatar is on screen and animated; cards carry data, but a card grid is not the primary surface, and a card is the session working a task, never the task itself. Anything that makes the product feel like a work tracker is heading the wrong way.

**Credit-conscious.** Every queue item bills one Gemini call and one ElevenLabs synthesis (per character, the expensive one). Credit safety is the owner's top priority; each double-fire protection exists because it was once a real double bill. ElevenLabs and Gemini stay: local TTS and local rewrite LLMs were auditioned and lost by ear, and real spend is single-digit dollars a month, so don't reopen that lane to save pennies.

**One owner, phone as much as Mac.** The owner listens and replies from a phone as often as from the desk. Mobile is not a shrunk desktop: its jobs are be-spoken-to, answer-from-pocket, glance, start-by-voice, and "walk to the Mac" is an honest handoff. Output routing is Spotify-Connect style: pick a device anywhere, it applies everywhere.

**THE RIG design language.** The locked visual target is industrial (Titanfall 2): machined gunmetal and amber, asymmetric corner grammar, hex texture, data on digital displays, chrome sparingly, no 3D chased in CSS. `docs/active/design-ui-target.md` is the system of record; the system's own vocabulary (spine, core, salience, plot) is the design inspiration.

**Voice above orchestration.** One always-on concierge voice (Mikey) above the interpreter; orchestration threads are mortal and reconstructable from the spine; workers are silent. Nothing important lives only in a context window.

**Filesystem as IPC.** The JSON, lock, pid and marker files under `~/.cursor/tts/` are the contract between hook processes and the daemon, not incidental style. Change them deliberately.

## Glossary

- **Persona / character**: voice + avatar + phrase set (`characters.json`, gitignored); globally unique, one tmux session per persona. Clone sources, casting reels and voice approvals live in the sibling `~/projects/voice-lab` repo; this repo only consumes ElevenLabs voice ids.
- **Room**: every live session as one snapshot. **Card**: one session.
- **Team session**: tmux `cr-<Persona>` from `team.sh`, reply-capable via `inject_prompt.sh`, runs with `--dangerously-skip-permissions`.
- **SDK card**: a T3 Code session (`sdk:true`), kept on a TTL through T3's idle teardown, evicted when T3 settles the thread.
- **Live mode**: per-session daemon flag (`live_sessions.json`); the transcript tailer (`live-tail.ts`) speaks intermediates to the phone. **Call mode**: the mobile call view while live (`CallView.tsx`); chat view is the thread plus composer.
- **Grant**: letting a queued item speak, on the Mac or grant-to-phone (the phone plays the replay file, the Mac stays quiet). **PTT**: push-to-talk voice input (`voice_ptt.sh`, `usePttGrant`); the daemon's claim markers are the billing authority.
- **queue/ played/ failed/ replay/**: items waiting, done, given up, and the MP3 + JSON sidecar saved per playback (replays re-play free).
- **Snapshot**: `PanelSnapshot` (`packages/protocol`), the one wire shape both UIs consume; staleness gated on `(epoch, rev)` (epoch = daemon boot, rev = monotonic within a boot).
- **The two locations**: the repo (edit here) and `~/.cursor/tts/` (the installed runtime: scripts, config, queue, logs, state, secrets).
- **Spine**: GitHub issues as the durable task record (labels `state/*`, one per issue, plus `gear/*`); `tts-server/scripts/tap-in.ts` reads it.
- **RIG**: the locked design target. **THE CORE**: its spend gauge (pulse = burn now, lit fraction = the month's draw).
- **Salience**: one number per session, 0-100 "% clear of needing you", plus a threshold that gates speaking (the dock approximates it locally).
- **Interpreter**: the daemon's voice-command layer (`tts-server/src/interpreter/`): intent files in `~/.cursor/tts/intents/`, rule router, then LLM, then a command plan.

## Things the model kept doing wrong

- **Editing `~/.cursor/tts/` instead of the repo.** The install is overwritten on every deploy, so edits there vanish. Hook-enforced (`scripts/hooks/block-install-edit.sh`).
- **Forgetting the deploy step for the layer touched.** Daemon TS: `~/.cursor/tts/scripts/tts-server.sh restart`. Mobile SPA: `pnpm --filter @room/mobile build` FIRST (dist is committed; the sync is fatal without it), then the same restart. Shell scripts and hooks: `./scripts/setup.sh`. Panel: `./scripts/panel-dev-install.sh` (cargo from `~/.rustup/toolchains/stable-aarch64-apple-darwin/bin`); a running Room.app must be relaunched, setup.sh does not do it.
- **Burning API credit to verify.** Live synthesis only with short text (under 200 chars), once: `echo "short test" | ~/.cursor/tts/scripts/enqueue_manual.sh "Test"`. Never loop; two enqueues in one Bash command are hook-blocked (`block-enqueue-loop.sh`). When synthesis isn't the thing under test, go free: `processWithGemini`/`streamTTS` skip without API keys, `signal.ts replay "" 1` replays saved audio, `live-tail.ts once <transcript>` dry-runs the tailer, `tts-server/scripts/mock-live.ts` drives live mode with zero synthesis (docs/reference/testing-live-mode.md), `tap-in.ts --dry` skips the LLM. Live/call features that truly need audio get a bounded paid lane: a team session on a cheap model (sonnet), one-sentence prompts, a handful of clips, codex driving the loop.
- **Mutating live playback state during tests.** `.playback-paused`, pid files and `.stream-lock` are load-bearing for a real player (deleting the pause flag without SIGCONT left ffplay suspended and wedged the grant queue). Check `pgrep ffplay` and the lock first; use fake session ids and staged `.now-playing.json` / state files; test pause paths through `pause.sh`. Test scripts that write into `src/` save and restore.
- **A process born with its cwd in the installed tts-server dir.** setup.sh `rm -rf`s it; a tmux server inherited it once and every later spawn died on getcwd. `team.sh` cds to `$HOME` first.
- **Weakening double-fire protections.** Never loosen: the ingest dedup hash; mute checks BEFORE API calls; live-mode gates (re-read after every wait) and the hold-one buffer in `live-tail.ts` (a turn-final spoken there double-bills; the Stop path owns it); processing markers and the stream lock in `playback-locks.ts`; cached-only acks; the phone-ack marker stamped before an SDK reply dispatch.
- **Changing credit caps casually.** `truncateForTTS` caps, `gemini_model` and `elevenlabs_model_id` change only when the owner asks. Hook-enforced (`block-credit-caps.sh`; `CREDIT_OVERRIDE=1` on request). Don't regenerate cached phrase MP3s (`phrases.ts` skips existing files).
- **Reading a worktree `.env`.** Delegates never need live keys; hook-blocked (`block-env-read.sh`) unless `LIVE_API_OK` is set.
- **Touching runtime state without asking.** Ask before clearing queues, deleting replay history, or editing `~/.cursor/tts/config.json`. Launching the app, screenshots and one short test clip need no asking.
- **Leaving a browser test tab on `/` with output = phone.** Every such tab acts as "the phone" and plays routed audio (the owner heard it twice). Reset the toggle to Mac and leave the page before ending the session.
- **tmux `=name` targets.** Exact-match works for session targets only; `send-keys`/`capture-pane` need the pane id from `tmux list-panes -t "=SESSION" -F '#{pane_id}'` (else `cr-Don` matches `cr-Donnie`).

## Surfaces and verification

Surfaces: the panel `main` window (normal activating NSWindow); the panel `dock` (NSPanel, float level, non-activating, all Spaces; Rust `lib.rs set_room_mode` is the mode authority); the mobile SPA (`/` and `/app`, token from `mobile_url.sh`); the phone audio path (`/live-audio/` chunked stream, `/replay-audio/` with Range, one speaker gate per client); tmux teams (spawn, resume, reply, live). Check the ones you touched. Output is audio plus two UIs, so "does it work" means trigger and observe:

1. Deploy the layer you changed.
2. Trigger cheaply with `enqueue_manual.sh` and short text.
3. Observe instead of listening: `logs/hook.log` traces ingest, gemini, elevenlabs, audio; `replay/` gains an MP3 + sidecar; queue files move to `played/`; `curl` `/snapshot`, `/thread/<id>`, `/action` with the mobile token. Panel visuals stage free with a fake speaking session.
4. UI checks need real computer use: delegate to codex (`codex-computer-use` skill) and let it own the whole interact-diagnose-verify loop, reporting once. A one-shot chrome-devtools screenshot is the fallback; claude-in-chrome times out on the SSE stream.
5. Live/call flows: mock-live harness first, the bounded paid lane only for what the mock cannot show.

```bash
~/.cursor/tts/scripts/tts-server.sh restart   # deploy daemon + mobile changes
./scripts/setup.sh                            # install scripts/hooks/panel bundle (no API calls)
./scripts/setup.sh --refresh-voices           # + ElevenLabs voice cache/SFX refresh (billable, opt-in)
pnpm typecheck                                # type check all packages (root workspace)
pnpm check-fixtures                           # validate protocol fixtures vs schemas
echo "test" | ~/.cursor/tts/scripts/enqueue_manual.sh "Verify"   # cheap pipeline poke
pnpm exec tsx src/signal.ts replay "" 1       # free replay of last message (in tts-server/)
tail -40 ~/.cursor/tts/logs/hook.log          # full pipeline trace
./scripts/panel-dev-install.sh                # panel: build, verify fresh, install, relaunch
cd panel && pnpm tauri dev                    # panel: ordinary component work (HMR)
pnpm --filter @room/prototype dev             # RIG prototype on :5180 (mock data)
```

## Where code lives

- `tts-server/`: the daemon. `index.ts` queue processing, `ingest.ts`, `gemini.ts`, `elevenlabs.ts`, `state-watch.ts` (snapshot builder), `panel-ws.ts` / `mobile-http.ts` (thin adapters over `services/commands.ts`), `live-mode.ts` + `live-tail.ts`, the audio split (`playback-locks.ts`, `now-playing.ts`, `replay-store.ts`, `stream-playback.ts`), `hid-*.ts` (arcade buttons), `interpreter/`, `t3-*.ts`; `scripts/` holds `mock-live.ts`, `fake-agent.ts`, `tap-in.ts`.
- `packages/protocol/`: Valibot schemas for every wire type plus fixtures; `tts-server/src/protocol` is a symlink to it.
- `packages/room-client/`: framework-free store over `PanelSnapshot`, WS and SSE transports, (epoch, rev) gating, request correlation, grant optimism.
- `packages/ui/`: `tokens.css` (the color authority), Tailwind v4 theme mapping, vendored shadcn/Radix primitives, domain leaf components, the sanitized `Markdown` renderer, `rig/` (RIG primitives).
- `packages/mobile/`: the phone SPA (React 19 + Vite).
- `panel/`: Tauri 2 + React 19. `src/app/` components over external stores, `src/platform/`, `src/stage/` (lipsync/blink), `src-tauri/` Rust.
- `prototype/`: the standalone RIG prototype over a mock store; never imported by panel, mobile or daemon.
- `scripts/`: bash glue, Claude Code hooks (`hook_*.sh`), `team.sh`, `inject_prompt.sh`, `setup.sh`, `tts-server.sh`, guards in `hooks/`.

Package boundaries are rules:

- The daemon never imports `room-client` or `ui`; the installed daemon never resolves modules back into the repo (protocol deps like valibot are direct deps of `tts-server/package.json`).
- Components take domain values and callbacks only: no fetch, WS, Tauri or audio inside. All Tauri calls live behind `panel/src/platform/`.
- Avatar frames never go through React renders: `src/stage/` swaps `img` refs from one rAF loop with a 70ms watchdog.
- Grant/PTT lives solely in `usePttGrant`; `grant-guard.ts` is the cross-realm belt around mode switches; the two windows coordinate through daemon snapshots only.
- Mobile audio lives in `src/audio/controller.ts`; only a client whose device toggle is "phone" auto-plays routed audio. Mobile `dist/` is committed and rebuilt explicitly; the deploy sync never builds it.
- Shared `tailwind.css` ships no preflight; only the mobile package enables it.

## Taste

- Concise, simple solutions; propose the simpler path when one exists. If asked to do too much at once, say so plainly instead of thinning every part.
- UI is componentized: React with shared components and design tokens across panel and mobile. No innerHTML template strings, no raw DOM lookups. A file approaching ~500 lines is a smell worth raising.
- Prototypes are siloed mock-data builds, never edits to the live app, but they still build on the shared component library (`@room/ui` plus shadcn primitives) from the first round: "extends the shared library" is the bar, not "matches the aesthetic". Flag plan text that says otherwise.
- Concept rounds: lead the brief with "an animated character on top of an agentic workflow", never work/board/status vocabulary. Prefer over-reach: ask boards for a "what I'd cut" note instead of a cost tiebreaker, never cost-gate a concept round, seed different directions, keep the avatar animated (Postplan strips scripts, so motion is CSS or SVG animate).
- No database unless it measurably earns its place; the filesystem layer is the IPC and handles current state well.
- pnpm, never npm. No CI or test-suite theater, but changed behavior gets verified and `pnpm typecheck` stays clean.
- User-facing text is taste work: both UIs, character copy, and the Gemini system prompts in `gemini.ts` and `dynamic-response.ts`.
- Prose and docs: no em dashes or en dashes; commas, colons, or sentences.

## Working with models and delegates

Rankings, higher = better. Cost reflects what we actually pay (subscriptions with generous limits rank cheap). Intelligence is how hard a problem you can hand the model unsupervised. Taste covers UI/UX, code quality, API design and copy.

| model         | cost | intelligence | taste | reachable via                                                                |
| ------------- | ---- | ------------ | ----- | ---------------------------------------------------------------------------- |
| composer-2.5  | 8    | 5            | 5     | cursor-agent CLI (`agent`)                                                   |
| grok-4.5      | 8    | 6            | 6     | cursor-agent CLI (`--model cursor-grok-4.5-high`; `-medium`/`-low` lighter) |
| gpt-5.6 Sol   | 7    | 8            | 5     | codex CLI (`codex -m` Sol tier; the local default)                           |
| gpt-5.6 Terra | 8    | 7            | 5     | codex CLI (Terra tier; bare "gpt-5.6" in prose means Terra)                  |
| gpt-5.6 Luna  | 8    | 4            | 4     | codex CLI (Luna tier)                                                        |
| sonnet-5      | 5    | 5            | 7     | Agent/Workflow `model: 'sonnet'`                                             |
| opus-5        | 7    | 8            | 8     | Agent/Workflow `model: 'opus'`                                               |
| fable-5       | 2    | 9            | 9     | Agent/Workflow `model: 'fable'`                                              |

- Fable is the scarce resource: it drives the main session and burns the weekly budget fast. Sonnet is cheap and capable; use it liberally as a subagent. opus-5 was auditioned and lost (claimed-fixed-still-broken, degrades on long runs): use it only when neither Fable nor Sol has budget left. codex has plenty of headroom: lean on it, Sol for deep work (`-c model_reasoning_effort="high"`), Luna only for trivia. Throttle a provider only when `ai-usage` shows it near its cap; check `ai-usage` before a big delegation round.
- composer/grok via cursor-agent for mechanical and multi-file work (grok for the trickier jobs): `agent --worktree -p --force "prompt"`, non-fast variants. cursor-agent runs composer/grok by default: any other model through it bills the small Cursor API pool (the `api` metric, not `models`). Fable through cursor-agent is the overflow route when the Anthropic Fable budget is nearly out and `ai-usage` shows the Cursor `api` pool under 80%; the `cursor-agent` skill says how to list the current model ids.
- Never Haiku. Never agy/Antigravity (flaky headless).
- Defaults, not limits: redo a cheaper model's output with a smarter model when it misses the bar, without asking. When axes conflict on anything that ships: intelligence > taste > cost. User-facing work needs taste 7 or better (sonnet minimum, fable preferred); visual concept work goes to fable, or opus only as the budget fallback.
- Reviews: fable, with codex (Sol for deep reviews) or composer as an independent perspective (`codex-review` skill).

Session token hygiene: per-task cost is roughly context size times wakeup count. During big multi-stage efforts the main session writes specs, credit-guard-adjacent edits, targeted diff reviews and merges; delegates author the code (composer/grok/Terra for well-specced chunks, a fresh-context fable subagent when a chunk needs frontier judgment). Recon goes to composer or an Explore subagent. Batch verification into ONE delegated round with the complete checklist. Ordinary small tasks: write the code directly.

Context and follow-ups: in a multi-turn main session that passes about 250k tokens, name a good compact point once; subagents and delegates never comment on context hygiene. Follow-up work discovered mid-task goes to the backlog, not the current session: file a GitHub issue (or an `ideas-backlog.md` line for an idea) with enough context to start cold, so the owner can kick it off in another worktree in parallel. Never "compact, then I'll start on B".

Delegate mechanics:

- Parallel code-writing agents use worktree isolation, split by file ownership so merges are trivial (docs/reference/worktree-parallel-flow.md).
- Every delegated prompt says: no live Gemini/ElevenLabs calls unless the task is about synthesis; cursor worktrees don't inherit `.env`. UI-building prompts state the shared-component requirement explicitly.
- Gate for code tasks: `pnpm exec tsc --noEmit` clean in `tts-server/` and `panel/` (when touched), `bash -n` on changed shell scripts.
- Check `command -v agent` / `command -v codex` first; probe cursor-agent with `agent -p -f "Reply with exactly: OK"` before a big round.
- Backgrounded `codex exec` needs `< /dev/null` (an open stdin pipe waits forever) and `-s workspace-write`; long runs exceed Bash's 10-minute timeout, so background them.
- cursor-agent `-p` runs can hang at 0% CPU after committing; check the worktree's git log (`~/.cursor/worktrees/<repo>/<branch>`) before assuming failure. `--output-format stream-json > run.jsonl` shows progress.

## Docs

- `docs/STATUS.md` is the tracking surface: what shipped, what awaits the owner, what's next. Its Inbox is the owner's drop zone: check it at session start and triage (bugs to fixes, ideas to the backlog, work to `active/` specs or Next up). A thin-index rework (`html-status` skill) is pending; don't grow it further meanwhile.
- `docs/decisions.md` is the parking lot for open/assumed questions and new owner calls (fleet `decision-record` skill): write the row when a call resolves, never edit an accepted row, supersede it.
- `docs/active/` unbuilt specs; `docs/shipped/` specs whose feature landed (move it there, log it in STATUS); `docs/archive/` superseded material; `docs/reference/` evergreen (check `ideas-backlog.md` before proposing "new" ideas; `testing-live-mode.md`, `worktree-parallel-flow.md`).
- GitHub issues are the spine: start fix work from `gh issue view`. The owner reads from the GitHub mobile app, so offer to push when a round lands. `pnpm docs:publish` after a shipped round renders STATUS and `active/` to the owner's phone-viewable Postplan draft (no API cost).
- Auto-memory is off for this repo (`autoMemoryEnabled: false` in `.claude/settings.json`). Durable workflow knowledge goes in this file, decisions in `docs/decisions.md`, nowhere else.
