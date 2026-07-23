# Spec: fix deferred-announce robot voice + synthetic-prompt acks

Status: FINAL v2 (2026-07-19). Reviewed by grok-4.5 + gpt-5.6 Sol.

## Symptom

In the jellyfin session: instant ack ("on it", Donnie) plays on message send,
but the response's announce chime is replaced by macOS `say` speaking
"One hand up: jellyfin" (the "archaic robot voice").

## Root cause

Background/subagent `<task-notification>` prompts arrive as synthetic
UserPromptSubmit events. `signal.ts` (~:23–33) treats them like real user
prompts: purges the session queue, flips the card to "working", and fires the
instant ack, which acquires and holds the stream lock through playback
(`dynamic-response.ts` ~:120). The response's announce chime
(`scripts/announce.sh` ~:86–94, try-once lock) loses the race → deferred → at
the next settle point `maybeFireDeferredAnnounce()` (`announce.ts` ~:110–116)
speaks via `spawnSync("say", ...)`. The settle points themselves are old
(Jul 7); what changed is collision frequency from the heavy background-task
session, plus mobile-v2's `awaitPendingDrain()` making the once-path settle
fire reliably.

## Fix

### 1. Skip synthetic prompts entirely (before any side effects)

- In `signal.ts`, BEFORE `purgeSessionQueue()` and `setSessionState("working")`
  and the ack: if `prompt.trimStart()` starts with `<task-notification`
  (regex `/^\s*<task-notification\b/`), return early — no purge, no state flip,
  no ack, no dynamic-response call (grok 6, Sol 2.3). A background completion
  must not dismiss a pending hand or flip the card to working.
- Cheap pre-filter: same check in `scripts/hook_prompt.sh` before launching
  Node (Sol 2.9), keeping the `signal.ts` guard as defense for direct callers.
- Real user prompts (including injected replies, which are normal prose) keep
  the ack. This removes the routine lock collision AND stops dynamic-response
  spend on machine events.

### 2. Deferred announce speaks in character — never `say`

Rework `maybeFireDeferredAnnounce()` (`announce.ts`):
- `handRaisedName()` returns `{sessionId, name}` per still-raised entry
  (Sol 2.7) so voices stay resolvable.
- For each distinct voice among still-raised sessions (in practice: one), play
  a cached announce chime (`sounds/phrases/<voice>/announce_*.mp3`) via voice
  resolution `resolveVoiceId(sessionId)` → config default fallback.
- CRITICAL: the caller already holds the stream lock — play the MP3 in-process
  (the same playback primitive `phrases.ts` uses AFTER its lock acquire), never
  by spawning the `phrases.ts play` CLI or any path that re-acquires the lock
  (would exit 2 / no-op) (grok 8, Sol 2.5). The function becomes async; await
  it at both settle points in `index.ts` (~:320, ~:346) and the CLI entry.
- No cached phrase for that voice → log and stay SILENT. Remove the `say` call
  and the now-dead `NUMBER_WORDS`/`countWord`/`joinNames` machinery (Sol 2.6,
  2.8). Deferral ledger mechanics stay as-is.

### Scope notes

- Does NOT fully resolve backlog "Subagent-finish fires the room announce" —
  that item is the Stop/ingest announce; this fix removes the ack-side noise
  only. Backlog entry stays (grok 4).
- No changes to yesterday's lock ordering / drain / phone-grant work.
- Guardrails: dedup hash (ingest.ts), mute checks, processing markers untouched.
  No new API calls; cached MP3s only, never regenerated.

## Verification (cheap)

- `pnpm exec tsc --noEmit`; `bash -n scripts/hook_prompt.sh` (and announce.sh
  if touched).
- Synthetic prompt through the hook path with a FAKE session id: no purge, no
  state flip, no ack, no `.pending-announce` entry.
- Deferred path: append a fake session id (with a voiced, cached character) to
  `.pending-announce`, trigger a settle via `pnpm exec tsx src/signal.ts replay "" 1`,
  confirm chime plays and `say` is never invoked.
