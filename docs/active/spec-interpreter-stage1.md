# Spec: Interpreter Stage 1 — PTT intent routing

Status: **ready to build** — 2026-07-23. Implements Stage 1 of
[design-conversational-layer.md](design-conversational-layer.md) (read its
Architecture section first; this spec is the concrete build plan). Stage 1
scope only: rule routing, LLM routing on miss, compound CommandPlans, the
bound-target bypass fix, silent/cached acks. NO contextual Q&A
(`answer_from_context` is Stage 2), no phone mic, no ElevenLabs replies.

Cost profile: ≈$0/turn — whisper is local, the router call is flash-lite
sub-cent, replies are `say`/cached phrases only.

## What changes for the user

- "hey donnie, write that to memory and then clear your queue" → an
  ordered two-step plan instead of a raw inject or a shrug.
- Paraphrases the grammar misses ("shut donnie up for a bit" → mute)
  resolve via the LLM router instead of "Didn't catch that".
- Bound-target PTT (arcade button / Raycast with a session bound) stops
  raw-injecting every utterance: "pause" while bound to Donnie now pauses
  playback instead of typing "pause" into Donnie's session.
- Free-form speech while bound still reaches the session (that UX is
  preserved — it just goes through routing first).

## Architecture (Stage 1 slice)

```
ptt.sh stop → whisper-cli transcript
  → intent file drop            ~/.cursor/tts/intents/<id>.json   (new IPC dir)
  → daemon interpreter service  chokidar watcher (same pattern as queue/)
      RuleRouter                extracted voice.ts grammar (pure module)
      LlmRouter (on rule miss)  flash-lite, function-calling, own client
      TurnCoordinator           validates → executes via services/commands.ts
                                + CommandPlan for multi-step
      reply policy              silent success · say() clarify/error ·
                                cached phrase ack when a plan starts
  → fallback                    daemon down → legacy `voice.ts route` CLI
                                (behavior identical to today)
```

Why an intent **file** and not an HTTP call: filesystem JSON under
`~/.cursor/tts/` is the established IPC contract with hook/script
processes (CLAUDE.md), the daemon already runs chokidar watchers with a
startup-recovery scan (index.ts:537-576), and it needs no auth story
(mobile-http is token-gated + Tailscale-exposed; a localhost intent
endpoint would be a new security surface for no gain).

## Module layout (new: `tts-server/src/interpreter/`)

| File | Contents |
| --- | --- |
| `rule-router.ts` | The grammar moved out of voice.ts as a pure function: `matchIntent(transcript, ctx) → Action \| null`. Carries over `normalizeTranscript`, `applyAliases`, `matchGrammar`, `levenshtein`, `resolveByName`, `NICKNAMES`, candidate builders (voice.ts:24-243). No side effects, no `speak()`, no script spawns — returns data. |
| `llm-router.ts` | `routeWithLlm(transcript, ctx) → RouterResult \| null`. Own lazy singleton client per gemini.ts:47-55 conventions (`GEMINI_API_KEY`, no-key → null skip). NOT `processWithGemini` — no rewrite prompt. `generateContent` with `tools:[{functionDeclarations}]`, `temperature: 0`, small `maxOutputTokens`, `AbortSignal.timeout(loadConfig().interpreter_timeout_ms)`. Logs one line per call (`log("interpreter", …)`) with duration + chosen tool for usage auditing. |
| `plan.ts` | `CommandPlan` type + `runPlan()`: ordered steps, per-step `CommandResult`s, stop-on-failure, an idempotency key (plan id = intent file id — a re-delivered intent must not re-run), confirmation gate on destructive steps. |
| `coordinator.ts` | `handleIntent(intent)`: rules → LLM → validate tool args (exact target resolution via `resolveByName`; ambiguous → clarify, never guess) → execute single actions through `services/commands.ts` dispatch or `runScript`, plans through `runPlan()` → reply policy → un-duck. |
| `service.ts` | `startInterpreter()`/`stopInterpreter()` per daemon convention: chokidar on `~/.cursor/tts/intents/` + `ready` recovery scan; wire in index.ts:483-495 gated on `loadConfig().interpreter_enabled`, mirror stop in both signal handlers. |
| `cli.ts` | `tsx src/interpreter/cli.ts route [--target <sid>] [--dry-run] "<text>"` — one-shot entry mirroring index.ts:432-458 `once` pattern. `--dry-run` prints the resolved action/plan JSON without executing (extends the voice.ts:249-252 dry mechanism). This is the free test harness. |

`voice.ts` shrinks to: the legacy CLI entry + `speak()`/execution glue,
importing the grammar from `rule-router.ts` (single source of truth — the
grammar must not fork). Its behavior when invoked directly is unchanged.

## Intent file contract

`~/.cursor/tts/intents/<epoch-ms>-<pid>.json`:

```json
{
  "transcript": "raw whisper text",
  "boundTarget": "<sessionId or null>",
  "source": "voice",
  "capturedAt": 1690000000000,
  "duckToken": "<ptt id or null>"
}
```

- `source` uses the existing reservation (`packages/protocol/src/commands.ts:20-26`
  already lists `"voice"` and `"interpreter"`); commands dispatched by the
  coordinator carry `source: "interpreter"`.
- Processed intents move to `intents/done/` (mirror queue→played). Stale
  intents older than 30s found at recovery scan are dropped with a log
  line, never executed — replaying old voice commands after a daemon
  restart is worse than losing one.

## The bound-target fix (the arcade-waste bug)

Today `route()` short-circuits: voice.ts:588-590 raw-injects the
transcript whenever `opts.target` is set, skipping all routing. New flow
in the coordinator:

1. RuleRouter runs with `boundTarget` as the **default target** — bare
   commands like "pause", "status", "say again" now work while bound;
   targeted grammar ("tell raph …") still resolves its own target.
2. Rule miss → LlmRouter (same default-target context).
3. LLM returns `inject_reply` or nothing usable / no API key → **fall
   back to injecting the transcript into `boundTarget`** — today's reply
   UX, preserved as the terminal fallback, not the first move.
4. No boundTarget + no match → clarify via `say` (today's "Didn't catch
   that").

## LlmRouter tool vocabulary (registered, closed)

One function declaration per existing action — mirror the
voice.ts:51-65 `Action` union: `grant`, `pause_resume`, `stop`,
`cancel_inject`, `hold_room`, `release_room`, `replay {slower?}`,
`status`, `mood {preset}`, `mute {target}` / `unmute {target}`,
`clear_queue {target}`, `inject_reply {target?, message}`,
`slash_command {name, target?}` — plus two new ones:

- `plan {steps: Action[]}` — ordered compound. Router prompt instructs:
  decompose only on explicit conjunction/sequencing ("and then", "after
  that"); never invent steps.
- `none {reason}` — explicit "not a command" (routes to the bound-target
  fallback or clarify).

Target arguments are **names as heard** ("donnie") — the coordinator does
resolution via `resolveByName`; the LLM never sees or emits sessionIds.
The router system prompt is user-facing surface (taste bar applies): it
gets the live candidate names (from the same builders ptt.sh uses for the
whisper prompt, ptt.sh:41-97), the tool list, and hard rules: exactly one
tool call; prefer `none` over guessing; "clear the session" ≠
`clear_queue` (see below).

## CommandPlan semantics

- Steps execute **sequentially**, each awaited to completion before the
  next (async `runScript` from commands.ts — the daemon-safe variant with
  the 10s SIGKILL cap, commands.ts:147-166).
- Injects inside a plan use `inject_prompt.sh --now` — the 4s
  latest-write-wins arming window (`ptt/pending-inject.json`,
  inject_prompt.sh:99-160) means two armed injects clobber each other, so
  plans bypass it. Single direct injects keep today's armed/undo window.
- Stop-on-failure: a failed step halts the plan and the failure is spoken
  (`say`, with `speakableName()` guarding UUID readout).
- **"clear" disambiguation** (the canonical compound trap): grammar
  `clear` stays queue hygiene (`clear_session_queue.sh`). The router
  prompt defines "clear the session / clear context / fresh start" as
  `slash_command {name:"clear"}` → injected `/clear`. That inject is a
  **destructive step**: Stage 1 confirmation = the coordinator speaks
  "Clearing Donnie's session — say confirm" and arms a 10s
  pending-confirmation (in-memory); the next intent matching
  confirm/cancel resolves it. No other steps of the plan run until
  confirmed; timeout cancels the remainder.
- Destructive set for Stage 1: injected `/clear`, anything matching
  `kill`/`exit`. Everything else runs unconfirmed.

## Reply policy (Stage 1)

Silent on single-action success (side effect is the feedback — status
quo). Plan start → one cached ack via `playRandomPhrase(voiceId, "ack")`
(free, phrases.ts:107-129; contends politely on the stream lock — exit-2
"floor busy" semantics, never waits). Clarify/error/confirm → `say`. No
ElevenLabs anywhere in Stage 1. Interpreter-triggered audio carries
`{source: "interpreter"}` meta so it never trips the phone-grant or
queue-stage guards (design doc "provenance" requirement).

## Ducking / turn end

ptt.sh currently un-ducks itself based on route()'s exit code
(FLOOR_EXIT=10 contract, ptt.sh:247-254). With the async daemon path,
`route_transcript` becomes: write intent file (including the duck token)
and exit; the **coordinator owns un-duck** — on turn completion it calls
`pause.sh` resume unless the executed action was floor-granting/stop
(the FLOOR_EXIT set). Fallback CLI path keeps the exit-code contract
unchanged. Watchdog: if the daemon dies mid-turn, the 30s stale-intent
drop plus ptt.sh falling back on "daemon not running" (pid check against
the existing daemon pidfile) bounds how long audio stays ducked.

## Config additions (config.ts pattern: field + DEFAULTS entry)

```ts
interpreter_enabled: boolean   // default true
interpreter_model: string      // default "gemini-3.1-flash-lite"
interpreter_timeout_ms: number // default 4000; on timeout → rule-only fallback
```

`gemini_model` stays untouched (rewrite contract). No-key behavior:
LlmRouter skips → rules + bound-target fallback still work (the system
degrades to slightly-better-than-today, never worse).

## Explicitly out of scope (Stage 2+)

`answer_from_context` / fact cache / tool-output projection; any
ElevenLabs interpreter speech; interpreter turn log; phone mic; changes
to `voice.ts` grammar coverage beyond the extraction refactor.

## Verification (free)

1. `pnpm exec tsc --noEmit` clean in tts-server/.
2. Grammar parity: `tsx src/interpreter/cli.ts route --dry-run` over a
   fixture list of every grammar phrase (build the list from the
   voice.ts action table) — resolved actions must match
   `tsx src/voice.ts route --dry-run` pre-refactor output.
3. Bound-target matrix (dry-run, `--target` set): bare command → action
   (not inject); free text → inject to bound target; "tell raph X" →
   inject to raph.
4. LLM router: a handful of real flash-lite calls (sub-cent, allowed) for
   paraphrase + compound + `none` cases; then unset `GEMINI_API_KEY` and
   confirm graceful rule-only degradation.
5. Plan execution against a **fake session** (Verification Hygiene memory:
   never mutate live playback state): tmux session with a dummy pane,
   team_map entry; verify ordered `--now` injects land and stop-on-failure
   halts. No TTS enqueued anywhere in the test path.
6. `bash -n` on ptt.sh; live PTT smoke (one utterance, e.g. "status") on
   the deployed daemon — speaks via `say`, zero API cost.

## Build/deploy notes

- Deploy = `tts-server.sh restart` (syncs src) + `./scripts/setup.sh`
  (ptt.sh changed). No panel or mobile builds involved.
- Delegate-friendly: no live Gemini/ElevenLabs calls needed to build or
  verify except step 4's bounded flash calls; state that in the
  delegation prompt per CLAUDE.md rules.
