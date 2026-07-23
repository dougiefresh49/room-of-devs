# Spec: room session lifecycle — stale cards, duplicate spawn, safe terminal open

Status: FINAL v2 (2026-07-19). Reviewed by grok-4.5 + gpt-5.6 Sol.

## Symptoms & causes (confirmed by investigation + review)

1. **Stale card after Terminal.app quit**: room membership = files in
   `~/.cursor/tts/state/`; `buildSnapshot()` has no liveness check; no
   SessionEnd hook is registered; cards are removed only by kill button,
   /clear rekey, or daemon-startup pruning.
2. **Duplicate Mikey / silent phone**: the first Mikey was a non-team session
   (voice-bound), so `+` spawning "Michelangelo" seeded a second card with the
   same character — no dedup exists. Spawn is fire-and-forget
   (`runScript`, panel-ws.ts ~:121–135); `team.sh` dies under `set -e` on tmux
   name collision (`cr-<persona>` is GLOBAL, one per machine) with no
   client-visible error.
3. **Empty tmux on "open terminal"**: `focusTerminal()` blind-attaches;
   `team_map.json` entries are never reaped when their tmux dies.

## Fix

### 1. Card liveness

a. **SessionEnd hook**: `scripts/setup.sh` merges a `SessionEnd` entry into
   `~/.claude/settings.json` via a safe jq/python JSON merge (note: setup.sh's
   existing hook block writes `~/.cursor/hooks.json`; the Claude-settings merge
   is new — idempotent, preserve unrelated keys). New tiny synchronous
   `scripts/hook_session_end.sh`: read payload, **skip reasons `clear` and
   `resume`** (both race lineage migration), otherwise call the cleanup helper
   (below) for the sessionId. Budget ~1.5s — no Node startup; plain shell + jq.
b. **Runtime reaper (backstop — Terminal quit may skip hooks)**: ~60s interval
   in `index.ts` (NOT inside `buildSnapshot()` — reads must stay side-effect
   free). For each state card, join to `~/.claude/sessions` registry by
   sessionId (extend registry parsing to expose pid; lineage reconcile drops
   dead pids so lineage alone can't be the source — Sol 3.7); liveness =
   `kill(pid, 0)`. Delete a card only after **two consecutive failed passes**
   (miss counter reset when seen alive) — protects fresh spawns and registry
   churn (Sol 3.8). Cards younger than 2 min are never reaped (team.sh binds in
   up to ~90s).
c. **Central cleanup helper** (used by SessionEnd hook path, reaper, and kill
   button): remove `state/<id>.json` + the session's `session_voices.json`
   entry; remove the `team_map.json` entry only if its exact tmux session is
   gone. Never invoked for clear/resume. (Fixes the orphan-voice buildup, e.g.
   live orphan `eff19ab4…`.)

### 2. Spawn dedup + visible failures

a. **Dedup key = persona, globally unique** among live/pending room sessions —
   matches the `cr-<persona>` global tmux reality; state cards have no `dir`
   field, so dir-scoped dedup is not possible today and multi-folder same
   persona was never supported (grok 6, Sol 3.10). Different personas in one
   folder remain allowed. Check in `validateAndSpawn`: reject synchronously
   with a clear error ("Michelangelo is already in the room") if the persona
   has a live card (same resolved character) or a `team_map` entry whose tmux
   exists, or is in the in-flight set.
b. **In-flight reservation**: server-side pending-persona set added before
   spawning, cleared on child exit — two simultaneous requests can't both pass
   the check (Sol 3.11). `tmux has-session -t =cr-<persona>` preflight is the
   authoritative lock across daemon restarts.
c. **`team.sh` idempotency**: preflight `tmux has-session -t =cr-<persona>`;
   if present with `pane_dead=1` AND owned per team_map → kill and proceed;
   otherwise exit with a distinct error message. Never kill a live unexpected
   session (Sol 3.12).
d. **Surface failures**: spawn via a captured variant of `runScript` (collect
   exit code + stderr tail). On failure, deliver a typed `notice` event:
   panel WS broadcast + mobile SSE (SSE currently emits snapshots only —
   extend the payload; `mobile.html` distinguishes notices from snapshots and
   shows a toast, replacing the dead-end "Starting session…" optimism).

### 3. Safe "open terminal"

- `focusTerminal()`: probe `tmux has-session -t =<name>` first. On failure:
  remove that stale `team_map.json` entry and reply with an error to the
  initiating WS client (no broadcast needed; mobile doesn't expose
  focus_terminal). Only open Terminal when the attach will succeed.

### Out of scope

- **Adopting a LIVE non-tmux session into tmux**: impossible without
  coordinated termination (two claude processes on one conversation). The
  supported flow — now reliable with the fixes above — is: end the old
  session; its card disappears (hook/reaper); use "+ → Resume" (resume path
  already exists: `team.sh --resume`, `validateAndResume`, picker) to relaunch
  that conversation inside tmux with a persona. Document this in the picker UX
  if trivial; no new mechanism.

## Guardrails

- No API calls (state files + shell only). Filesystem state stays house style.
- Idle-but-alive sessions are never reaped; the 90-min display demotion stays.
- Verification hygiene: fake cards/pids only; never touch live sessions' state.

## Verification

- `pnpm exec tsc --noEmit`; `bash -n` on team.sh, setup.sh, hook_session_end.sh.
- Fake dead card (fake sessionId + dead pid in a fixture registry entry):
  reaped after two passes; live cards untouched; voice entry removed.
- Dedup: spawn_session for a persona with a live card → synchronous error,
  toast on both UIs, no tmux session created.
- focusTerminal with a team_map entry pointing at no tmux → entry removed +
  error reply, Terminal not opened.
- SessionEnd: throwaway claude session in a scratch dir, exit normally → card
  gone without daemon restart; /clear on a test session → card survives via
  rekey.
