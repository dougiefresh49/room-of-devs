# Spec: T3 replies — Phase B (reply into a T3 thread from the room)

Status: ACTIVE (2026-08-15), rev 2 — incorporates Sol + grok plan reviews
(/tmp/review-sol-phase-b.md, /tmp/review-grok-b.md). Depends on Phase A
(shipped). Research basis: Sol /tmp/t3-auth-report.md (installed T3 nightly
commit 8c628f14993c, verified live).

## Goal

From the mobile room page, reply to an SDK (T3 Code) session — the message
lands in the real T3 thread (visible in the T3 app). Core = text replies.
Stretch (gated, only after text works) = image attachments.

## CRITICAL credit guard (grok BLOCKER)

Team replies stamp a phone-ack marker BEFORE tmux inject so the injected
prompt's `UserPromptSubmit` hits a cached ack in `signal.ts` and exits
WITHOUT `handleDynamicResponse` (which spends Gemini+ElevenLabs). A T3
dispatch runs in the same Claude Code harness and fires the SAME
`UserPromptSubmit`. Therefore the sdk reply branch MUST stamp the phone-ack
marker (via the same `markPendingPhoneAck` path the inject path uses) BEFORE
dispatching, and clear it on dispatch failure. Missing this = every T3 reply
bills a dynamic voice response. This is the #1 correctness requirement.

## Transport (HTTP only; loopback-hardened)

Origin from `~/.t3/userdata/server-runtime.json`, read FRESH per send, and
VALIDATED before any authenticated call (Sol/grok — token-exfil boundary):
- Parse `origin` as URL; accept ONLY `http:` scheme with an IP-literal
  loopback host (`127.0.0.0/8` or `::1`). Reject credentials, non-`/` path,
  query, fragment, and any hostname that isn't a loopback IP literal (no DNS
  rebinding). Never use `host` `0.0.0.0` as a destination.
- Every request sets `redirect: "error"` (never follow a 3xx carrying the
  bearer). Fail closed with a fixed non-secret notice on malformed/non-loop.
- The unauthenticated liveness probe (`GET /.well-known/t3/environment`)
  carries NO bearer.

Send sequence (all Bearer except the probe):
1. `GET /.well-known/t3/environment` — liveness (no auth).
2. `GET /api/auth/session` — validate token + assert scopes
   `orchestration:read` + `orchestration:operate`.
3. `GET /api/orchestration/threads/<threadId>?turnLimit=1` — resolve
   `thread.runtimeMode` + `thread.interactionMode` (echo them back).
4. `POST /api/orchestration/dispatch` (JSON):
   ```
   { type:"thread.turn.start", commandId:`turn-start-${uuid}`, threadId,
     message:{ messageId:`message-${uuid}`, role:"user", text, attachments:[] },
     runtimeMode: thread.runtimeMode, interactionMode: thread.interactionMode,
     createdAt: new Date().toISOString() }
   ```
   Returns `{sequence}`. Requires `orchestration:operate`. Field is nested
   `message.text` (NOT top-level messageText).

Timeout/idempotency (grok #3): daemon wall-time ≤7s TOTAL including at most
ONE network retry, kept strictly under the mobile client's ~11s timeout so a
slow success can't race a user retry into a double-send. One fresh
`commandId`/`messageId` per user send intent (a daemon-internal retry of the
SAME send reuses the same commandId).

## Auth provisioning (`scripts/t3-provision-bearer.sh`)

One-time, non-interactive, least-privilege, secret-safe. Mechanics (Sol #5,
grok #12):
- `set +x` throughout; never `echo`/`tee`/log any token or credential.
- Resolve the T3 `.app` path from the running process (`lsof`/`ps` for the
  server pid in `server-runtime.json`) — do not hardcode the nightly name.
- Step 1: mint a SHORT-TTL admin bearer, capturing only its token + sid:
  ```
  ELECTRON_RUN_AS_NODE=1 "<T3.app>/Contents/MacOS/<bin>" \
    "<...>/apps/server/dist/bin.mjs" auth session issue \
    --base-dir "$HOME/.t3" --subject room-of-devs-daemon \
    --label "Room of Devs (bootstrap)" --ttl 5m --token-only --json
  ```
- Step 2: `POST /api/auth/pairing-token` (admin bearer, needs `access:write`)
  JSON `{label:"Room of Devs daemon", scopes:["orchestration:read",
  "orchestration:operate"]}` → `{id, credential, ...}`.
- Step 3: exchange at `POST /oauth/token`, form-urlencoded, ALL of:
  `grant_type=urn:ietf:params:oauth:grant-type:token-exchange`,
  `subject_token=<credential>`,
  `subject_token_type=urn:t3:params:oauth:token-type:environment-bootstrap`,
  `requested_token_type=urn:ietf:params:oauth:token-type:access_token`,
  `scope=orchestration:read orchestration:operate`. → restricted bearer.
- Step 4: revoke the admin session (Sol #2, grok #4): `auth session revoke
  <admin-sid>`. Revoke failure = hard provisioning failure (loud), not a
  silent proceed. Short TTL is only the fallback.
- Secret handling: pass the CLI token / pairing credential / bearer to
  curl/node via STDIN or a temp 0600 file, NEVER argv or env. Prefer one
  small Node body (stdin-fed) doing both HTTP exchanges in memory. `umask
  077`. Create `~/.cursor/tts/secrets/` at 0700 (reject symlink/non-dir/
  wrong-owner), write bearer with `O_EXCL`, atomic rename, verify 0600 +
  owner after. Scrub all secret vars + temp files on every exit path
  (trap). NEVER read `~/.t3/userdata/secrets/server-signing-key.bin`.
- On success, touch a daemon-watched file to invalidate the snapshot
  (below) so `replyable` flips without a restart.

## Daemon (`tts-server/src`)

- `t3-thread-state.ts`: add `t3ThreadIdForSession(sid): string|null` —
  resume-cursor join, but filter `deleted_at IS NULL AND archived_at IS NULL
  AND settled_override IS NOT 'settled'`, and do NOT require runtime
  `status='running'` (Sol #7 — active threads can be `stopped`). Keep the
  UUID allowlist before interpolation. Ambiguous (>1 active match) →
  return null (caller emits `thread_missing`).
- NEW `t3-reply.ts`:
  - `t3BearerState(): {present:boolean, expMs:number|null}` — reads the
    bearer file (regular-file/owner/0600 checks), decodes claims locally for
    `exp` (no signature-key access). Cached with a short TTL; invalidated on
    401/403.
  - `t3ReplyProvisioned(): boolean` = present AND not expired (Sol #6, grok
    #5). Drives `replyable`, so the composer never offers a bounce.
  - `async sendT3Reply(claudeSessionId, text, attachments?):
    Promise<{ok:true,sequence}|{ok:false,code}>` — never throws. Maps via
    `t3ThreadIdForSession`, runs the hardened transport, returns a STABLE
    code on failure (see codes). Logs a rate-limited warning when the
    bearer expires in <3 days.
- Async reply refactor (Sol #3): `handleReplyAction` becomes async; both
  `mobile-http.ts /action` and `panel-ws.ts` await it with request-scoped
  correlation (the WS module-global `activeRequest` is only valid while
  synchronous — replace with a per-request token that survives the await,
  OR make Phase B mobile-only and reject the WS sdk-reply path explicitly).
  Preserve the team/tmux path + its pre-inject ack marker EXACTLY.
- Reply branch decision table (grok #8 — ordered, exhaustive, no fall-through
  to inject):
  1. `isTeamSession` → existing tmux inject (unchanged).
  2. else `isSdkCard` && `t3ReplyProvisioned()` → stamp phone-ack marker →
     `sendT3Reply` → on failure clear the marker + return the code.
  3. else `isSdkCard` && !provisioned → `{status:"not_provisioned"}` (NO
     inject, NO marker).
  4. else → refuse (existing `not_in_team`); never reach `inject_prompt.sh`.
- Stable failure codes (Sol #3, grok #7): `not_provisioned`, `auth_expired`,
  `t3_unreachable`, `thread_missing`, `dispatch_rejected`, `t3_timeout`.
  Fixed catalog strings only — NEVER interpolate `error.message`, HTTP
  bodies, headers, or CLI stdout into a notice (token-leak risk).
- Snapshot invalidation (grok #6): `state-watch.ts` currently watches
  `STATE_DIR`/root files/`FAILED_DIR`, not `secrets/`. Add a small watched
  marker (e.g. touch `$TTS_DIR/.t3-auth-rev` on provision/rotation, add its
  basename to `ROOT_FILES`) so `replyable` refreshes live.

## Protocol / fixtures

- `AgentViewSchema`: add optional `replyable?: boolean`. Builder emits
  `isTeamSession || (isSdkCard && t3ReplyProvisioned())`.
- Reuse the existing `reply` command (it already carries text). Only extend
  it if attachments land (stretch). Update fixtures + hand-validate ONLY if
  the command shape changes.

## Mobile (`packages/mobile/src`)

- Composer gate: `agent.replyable ?? agent.injectable` (grok #2 deploy-skew
  fallback via `agent-ext.ts`), in ChatView AND CallView (grok #13 — pass
  `replyable` into CallView for the "Send a text" vs "Show conversation
  text" affordance). Phase A's sdk hint shows only when NOT replyable.
- Reply send reuses the existing composer dispatch + failure mapping; add
  announce strings for the new stable codes (grok #7). Draft preserved on
  failure (existing behavior).
- Attachments (stretch, grok #16): the mobile composer is TEXT-ONLY today
  and `ReplyCommandSchema` is text-only — do NOT imply otherwise. Build +
  verify text first; attachments are a separate follow-up (schema + UI +
  T3 attachment mapping `{type:"image",name,mimeType,sizeBytes,dataUrl}`,
  ≤10MiB, ≤8).

## Panel (grok #18)

Phase B is MOBILE-ONLY for v1. `panel-ws.ts` also calls `handleReplyAction`;
either make it async-safe too or explicitly reject sdk replies from the
panel path with `not_provisioned`-style handling until a later round. State
the choice in code.

## Test plan

Free / no-provision lane (unit-level, no bearer minted):
1. `pnpm typecheck` + `pnpm check-fixtures` clean; mobile dist rebuilt.
2. Origin validation: table-test `t3-reply` origin parser accepts
   `http://127.0.0.1:3773`, rejects `http://0.0.0.0`, `http://evil.tld`,
   `https://127.0.0.1`, creds/path/query, and refuses to follow a 3xx.
3. Branch decision table: team→inject (unchanged), sdk+provisioned→dispatch
   path (stub the fetch), sdk+unprovisioned→`not_provisioned` (no inject, no
   marker), unknown→refuse. Assert the phone-ack marker is stamped for the
   sdk-provisioned case and cleared on simulated dispatch failure.
4. `t3ThreadIdForSession`: seed read-only fixtures; active thread resolves,
   settled/archived/deleted excluded, ambiguous→null.
5. Failure codes never leak: force each failure, assert the notice is a
   fixed catalog string with no token/host/body substring.
6. Mobile UI with a mocked `replyable`: composer shows when replyable,
   hint when not; codes map to announce strings.

Provision + auth lane (mints a REAL restricted bearer — revocable; the
designed steady state):
7. Run `t3-provision-bearer.sh`; assert bearer file 0600/owner, dir 0700,
   `GET /api/auth/session` reports exactly the 2 scopes, and the temporary
   ADMIN session is no longer active (revoked). No token in any log.

Dispatch lane (owner-gated — see below):
8. DRY-RUN first: everything through building the exact dispatch command +
   `GET threads/:id` resolve for the owner's own current sdk thread, WITHOUT
   the final POST. Assert the command is well-formed.
9. ONE real dispatch is OWNER-GATED (not run unsupervised): a live
   `thread.turn.start` posts a turn into a real T3 thread, which wakes that
   agent and spends the owner's Anthropic quota / may do work. Leave this as
   a single documented command for the owner to run/confirm; do not
   auto-post into active threads overnight.

Credit safety (grok #11): all "watch the response" verification uses live
MUTE ON (free). Only an intentional, owner-approved single clip may go
unmuted.

Security review: run the `security-review` skill on the Phase B diff before
ship. Confirm bearer never logged/argv'd, 0600/0700 perms, admin revoked, no
signing-key access, loopback-only + no-redirect, failures leak nothing.

## Risks

- Protocol drift: pin to installed commit; startup capability probe; fail
  closed with fixed notices.
- Token expiry ~30d, no auto-rotate v1 → owner re-provisions; daemon warns
  <3d (rate-limited).
- Async refactor touches shared transport (mobile-http, panel-ws,
  commands) — keep the team path byte-for-byte; add tests around the ack
  marker.
- Never kill/restart T3; never write its sqlite directly.
