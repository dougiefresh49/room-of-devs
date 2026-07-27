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
- **Shared client** (`packages/room-client/`): framework-free store over
  `PanelSnapshot` + WS/SSE transports ((epoch, rev)-gated snapshots,
  requestId/CommandResult correlation, grant optimism). Bundled into the
  panel by Vite; the daemon must NEVER import it. Mobile adopts it in the
  Phase 5 SPA.
- **AI**: Gemini (`@google/genai`, `gemini-3.1-flash-lite`) rewrites agent
  text into character voice; ElevenLabs streams TTS (billed per character —
  the expensive one).
- **Shared UI** (`packages/ui/`): semantic design tokens (`tokens.css` is
  the color authority — state colors, `--room-accent`), Tailwind v4 theme
  mapping (no preflight while legacy CSS coexists), vendored shadcn/Radix
  primitives, domain leaf components (StateBadge, AgentChips, TransportBar,
  SummaryText), and the sanitized `Markdown` renderer (react-markdown +
  rehype-sanitize, platform link policy). Components take domain values +
  callbacks only — no fetch/WS/Tauri/audio inside.
- **Desktop panel** (`panel/`): Tauri 2 + Vite + TypeScript + React 19.
  Fully React since Phase 4: component tree in `src/app/` over external
  stores (`view-state`, `server-data`, `ui-state` + the shared
  room-client store); all Tauri calls behind `src/platform/` (components
  never import @tauri-apps/\*). TWO windows, one bundle, two JS realms:
  `main` = normal activating NSWindow with the standard titlebar; `dock`
  = NSPanel (float level, non-activating, all-Spaces) converted once at
  startup. Rust (`lib.rs`) is the mode authority — `set_room_mode` swaps
  visibility + activation policy (Regular/Accessory); realms coordinate
  via daemon snapshots only. Lipsync/blink run in `src/stage/` (one rAF
  loop + 70ms watchdog, img refs — avatar frames NEVER go through React
  renders). Grant/PTT lives solely in `usePttGrant` (event firewall incl.
  portaled popover content). The cross-realm grant belt
  (`grant-guard.ts`, localStorage) prevents double-dispatch around mode
  switches; the daemon's claim markers stay the billing authority.
- **Mobile room** (`packages/mobile/`, `@room/mobile`): Vite + React 19 SPA
  served token-gated at `/` (and `/app`) by mobile-http from the committed
  `dist/` (owner policy: dist is committed, rebuilt with
  `pnpm --filter @room/mobile build`). Same architecture rules as the
  panel: RoomClient store (SseTransport, `source:"mobile"`), components
  never fetch; audio lives in one adapter (`src/audio/controller.ts` —
  prime/live-stream/handoff/speaker-gate; only a client whose device
  toggle is "phone" auto-plays routed audio). The legacy single-file
  `mobile.html` was deleted in Phase 6 (2026-07-23) — it lives in git
  history if a behavior reference is ever needed.
- **Glue** (`scripts/`): bash utilities + Claude Code hooks. (The SwiftBar
  menu-bar plugin was retired in Phase 6 — the panel is the only Mac UI.)
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
(scripts, config, Room.app bundle), and `tts-server.sh
start|restart` syncs `tts-server/src/*.ts` from the repo before
launching. So:

- Edit files **in the repo**, never in `~/.cursor/tts/`.
- TypeScript changes take effect after
  `~/.cursor/tts/scripts/tts-server.sh restart`. That sync also stages the
  shared wire contract `packages/protocol/src/` → installed `src/protocol/`
  (in the repo, `tts-server/src/protocol` is a symlink to it). The installed
  daemon must never resolve modules back into the repo workspace — protocol
  deps (valibot) are direct deps of tts-server/package.json for that reason.
- Mobile SPA changes need `pnpm --filter @room/mobile build` FIRST (dist is
  committed; the sync rsyncs `packages/mobile/dist/` → installed
  `mobile-dist/` and is FATAL if the repo dist is missing), then the same
  `tts-server.sh restart`. Editing `packages/mobile/src` without rebuilding
  deploys nothing.
- `scripts/*.sh` or hook changes take effect after re-running
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
- **Live-mode testing may spend a little** (owner call 2026-07-22): to test
  live/call features end-to-end, spawn or reuse a dedicated team session on
  a cheap model (`sonnet`/`haiku` — e.g. in the agent-usage-bar project),
  keep its prompts short ("reply in one sentence"), cap a run at a handful
  of clips, and prefer delegating the whole interact→listen→verify→fix loop
  to codex computer use so the owner isn't the test rig. This is a bounded
  lane, not a loosening of the rules above: no unbounded/repeated synthesis
  loops, and anything testable without spend still goes the free route
  first. A no-spend mock live harness is planned in the refactor
  (docs/shipped/spec-ui-refactor.md, Phase 5).
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
./scripts/setup.sh                            # install scripts/hooks/panel bundle (no API calls)
./scripts/setup.sh --refresh-voices           # + ElevenLabs voice cache/SFX refresh (opt-in, billable)
pnpm typecheck                                # type check all packages (root workspace)
pnpm check-fixtures                           # validate protocol fixtures vs schemas
echo "test" | ~/.cursor/tts/scripts/enqueue_manual.sh "Verify"   # cheap pipeline poke
pnpm exec tsx src/signal.ts replay "" 1       # free replay of last message
tail -40 ~/.cursor/tts/logs/hook.log          # full pipeline trace
./scripts/panel-dev-install.sh                # panel: build → verify fresh → install → relaunch
cd panel && pnpm tauri dev                    # panel: ordinary component work (HMR)
```

## Code style

- Concise, simple solutions; propose the simpler path when one exists.
- **UI code is componentized** — React (or similar) with shared components
  and design tokens across the panel and mobile page. No UI built from
  innerHTML template strings. (Owner call 2026-07-21; the old "no
  frameworks" rule is dead — it produced 3k-line monoliths, since deleted.)
- Keep files focused; a file approaching ~500 lines is a smell worth
  raising, not a norm.
- Server-side filesystem state (JSON/lock/pid files) remains the IPC
  contract with the hook processes — change it deliberately, not casually.
- Databases: not forbidden, not sought. Local or hosted (e.g. Supabase) is
  fine IF it clearly earns its place (speed, capability); don't introduce
  one for state the filesystem layer already handles well.
- No CI/test-suite theater, but changed behavior gets verified (see
  Verifying below) and type checks stay clean.

## Refactor status (2026-07-23)

REFACTOR COMPLETE — Phases 0-7 SHIPPED: shared protocol/client/ui
packages, server services + recovery, React panel (two windows), mobile
Vite SPA cut over to `/`, legacy audit + deletion (caller manifest in
docs/archive/reviews/refactor-2026-07/legacy-manifest.md; mobile.html, SwiftBar,
raycast, orphan scripts removed — PTT plumbing exempt and kept), and the
Phase 7 server splits (audio.ts and hid.ts each behind a facade — see
Known issues note). Context in session memory ("Refactor Mandate");
judgment calls in docs/archive/reviews/refactor-2026-07/decisions-overnight.md.
Free live-mode regression tooling: tts-server/scripts/mock-live.ts +
docs/reference/testing-live-mode.md.

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
re-reads the whole conversation — cached, but a 300-450k context across
13 wakeups burned ~25% of a weekly Fable budget on 2026-07-22).

- **During big multi-stage efforts (a refactor phase, a feature round
  with several delegate/verify wakeups), the main session stops
  authoring code** (owner call 2026-07-22): chunks beyond small surgical
  edits are written by a delegate against a written spec —
  Terra/grok/composer for well-specced work; an Agent-tool
  `fable`/`opus` SUBAGENT when a chunk genuinely needs frontier judgment
  (fresh context, none of the session history billed with it). The main
  session does: specs, credit-guard-adjacent edits, targeted diff
  review, merges. Ordinary small tasks: writing code directly is fine.
- **Codebase recon goes to composer-2.5** (cursor-agent) or an Explore
  subagent: finding references, mapping call sites, summarizing big
  files. Don't pull 2000-line files into the main context when a
  delegate can return the 20 lines that matter.
- Batch verification into ONE delegated round with the complete
  checklist; let codex own the whole interact→diagnose→verify loop and
  report once. Every extra round-trip is a full-context wakeup.
- End of a shipped feature/round → tell the owner it's a good `/clear`
  point. Mid-task bloat → `/compact` (especially once recon reads are
  stale after a design is locked). Never let sessions run for days.
- Sequential pipelines (spec→build→review→fix) at one wakeup per stage are
  fine; don't add wakeups for things a delegate can verify itself.

## Picking the right models for workflows and subagents

Rankings, higher = better. Cost reflects what we actually pay
(subscriptions with generous limits rank cheap), not list price.
Intelligence is how hard a problem you can hand the model unsupervised.
Taste covers UI/UX, code quality, API design, and copy.

| model         | cost | intelligence | taste | reachable via                                                                        |
| ------------- | ---- | ------------ | ----- | ------------------------------------------------------------------------------------ |
| composer-2.5  | 8    | 5            | 5     | cursor-agent CLI (`agent`)                                                           |
| grok-4.5      | 8    | 6            | 6     | cursor-agent CLI (`--model cursor-grok-4.5-high`; `-medium`/`-low` for lighter work) |
| gpt-5.6 Sol   | 7    | 8\*          | 5     | codex CLI (`codex -m` Sol tier)                                                      |
| gpt-5.6 Terra | 8    | 7\*          | 5     | codex CLI (default tier)                                                             |
| gpt-5.6 Luna  | 8    | 4\*          | 4     | codex CLI (`codex -m` Luna tier)                                                     |
| sonnet-5      | 5    | 5            | 7     | Agent/Workflow `model: 'sonnet'`                                                     |
| opus-5        | 7    | 8\*          | 8\*   | Agent/Workflow `model: 'opus'`                                                       |
| fable-5       | 2    | 9            | 9     | Agent/Workflow `model: 'fable'`                                                      |

\* Provisional (2026-07-11, unauditioned): GPT-5.6 replaced gpt-5.x with
three tiers — **Sol** (flagship frontier reasoning), **Terra** (balanced
daily driver), **Luna** (fast/lightweight for high-volume work). Ranked
from OpenAI's positioning, not our own testing; audition before relying on
them for anything intricate. opus-5 (2026-07-27) replaced opus-4.8 as the
`'opus'` alias — intelligence/taste carried over from 4.8
plus a notch per Anthropic's positioning; cost 7 — near Sol, far cheaper
than fable (owner call 2026-07-27). Unauditioned; judge output as usual.
Prose references to "gpt-5.6" without a tier
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
  needs taste ≥ 7: sonnet-5 minimum, opus-5/fable-5 preferred. The
  Gemini system prompts in `gemini.ts` and `dynamic-response.ts` directly
  shape what gets spoken — prompt edits are user-facing work.
- Reviews of plans/implementations: fable-5 or opus-5, optionally
  composer-2.5 or gpt-5.6 (Sol for deep reviews) as an extra independent
  perspective (see the `codex-review` skill).
- Never use Haiku. For trivial work, composer-2.5 or gpt-5.6 Luna.

Mechanics:

- **Check CLI availability before delegating** — `command -v agent` /
  `command -v codex`; fall back to a Claude subagent if missing.
- composer/grok: `agent --worktree -p --force "prompt"` (see the
  `cursor-agent` skill). Always `--force` for tasks that write code.
  Model IDs verified 2026-07-22 (`cursor-agent models`): `composer-2.5`,
  `cursor-grok-4.5-high|-medium|-low`. Every ID also has a `-fast` variant
  that burns MORE quota for the same model served faster — default to
  non-fast; Cursor plan headroom is generous (2x usage promo), so
  `cursor-grok-4.5-high` is the standard grok pick.
- gpt-5.6: codex CLI — `codex exec` / `codex review`. Note: `codex review`
  accepts NO custom prompt; use `codex exec` with a self-contained prompt
  when you need one. Long runs exceed Bash's 10-min default timeout —
  background them.
- Claude models run via the Agent/Workflow `model` parameter.
- Parallel implementation agents that write code use worktree isolation;
  split work by file ownership so merges are trivial. Full parallel-round
  flow (lanes, hot files, the single-deploy-target rule):
  docs/reference/worktree-parallel-flow.md.

Repo-specific rules for delegated agents:

- cursor-agent `--worktree` checkouts don't inherit `.env` — copy it from
  the source checkout if the task needs live API calls (it almost never
  should; see credit efficiency).
- Delegated agents must NOT make live Gemini/ElevenLabs calls unless the
  task is explicitly about synthesis — state this in every delegated
  prompt.
- Verification gate for code tasks: `pnpm exec tsc --noEmit` clean in
  `tts-server/` AND `panel/` (when touched), `bash -n` on changed shell
  scripts.

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
6. Live/call-mode flows: use the bounded paid lane above (cheap-model team
   session + codex driving both UIs) until the mock harness exists.

Launching the app, screenshots, and short test audio are fine without
asking; ask first before clearing queues, deleting replay history, or
changing `~/.cursor/tts/config.json`.

## Docs organization (lifecycle folders, 2026-07-23)

`docs/STATUS.md` is the single tracking surface — what shipped, what's
awaiting the owner, what's next. Its **Inbox section is the owner's drop
zone**: check it at session start and triage anything there (bugs →
fixes/known issues, ideas → the backlog, work items → `active/` specs or
Next up). Update STATUS at the end of every shipped round, then
`pnpm docs:publish` (renders STATUS + `docs/active/` to HTML
and updates the owner's phone-viewable Postplan draft — stable URL, draft
id in `docs/.postplan-draft`; no API/TTS cost).

| Folder            | Meaning                                                                 |
| ----------------- | ----------------------------------------------------------------------- |
| `docs/active/`    | Designs/specs for unbuilt work — the queue                              |
| `docs/shipped/`   | Specs whose feature landed (e.g. `spec-live-mode-v2.md` = current live-mode architecture) |
| `docs/archive/`   | Superseded specs, old plans, review rounds (incl. `archive/reviews/`)   |
| `docs/reference/` | Evergreen: `ideas-backlog.md` (check before proposing "new" ideas), `testing-live-mode.md`, vision docs |

Lifecycle rules: new specs start in `active/`; move to `shipped/` when the
feature deploys (and log it in STATUS.md); superseded docs get a pointer
banner and move to `archive/`.

## Known issues / technical debt

- Phase 7 splits shipped: `audio.ts` → playback-locks / now-playing /
  replay-store / player-process / stream-playback, `hid.ts` → hid-report /
  hid-actions / hid-device / hid-controller / hid-learn. Callers import the
  owning modules directly; audio.ts keeps only the simple players
  (playFile/playMp3Buffer/replayLast/startPlayReplay) and hid.ts only the
  `learn` CLI entry.
  `elevenlabs.ts fetchCredits()` is caller-less — kept as the hook for a
  future panel credits chip.
- Cross-persona spawn race and subagent-finish announce filtering
  (docs/reference/ideas-backlog.md).
- No test suite; verification is manual/scripted per the section above.
