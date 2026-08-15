# Spec: T3 replies — Phase B (reply into a T3 thread from the room)

Status: ACTIVE (2026-08-15). Depends on Phase A shipped. Research basis:
Sol deep-dive /tmp/t3-auth-report.md (pinned to installed T3 nightly commit
8c628f14993c). Build only AFTER Phase A is deployed + verified.

## Goal

From the mobile room page, reply to an SDK (T3 Code) session — the message
lands in the real T3 thread (visible in the T3 app, history intact), so the
owner can: type in the room, hear it live (Phase A), and reply without
switching to the T3 app. Core = text replies. Stretch (same spec, gated
behind text working) = image attachments.

Non-goals: creating T3 threads, model/mode switching, streaming completion
back over WS (Phase A's transcript tail already surfaces the response).

## Why not the community CLI

`t3code-threads` 0.2.0 is wire-INCOMPATIBLE with the installed nightly: it
calls removed routes (`/api/auth/ws-token`, `wsToken`, `/api/auth/bootstrap/
bearer`). Sol confirmed. We implement a tiny first-party HTTP client instead —
fewer moving parts than forking + pinning their `@t3tools/*` deps.

## Transport (HTTP only — no WS needed for fire-and-forget reply)

All against the origin in `~/.t3/userdata/server-runtime.json` (read FRESH
each call; never hardcode 3773 — Sol observed it stale). Sequence:

1. `GET /.well-known/t3/environment` — liveness probe (unauth).
2. `GET /api/auth/session` with `Authorization: Bearer <token>` — validate
   token + assert scopes include `orchestration:read` + `orchestration:operate`.
3. `GET /api/orchestration/threads/<threadId>?turnLimit=1` — resolve
   `thread.runtimeMode` + `thread.interactionMode` (must echo them back).
4. `POST /api/orchestration/dispatch` (Bearer, JSON) with:
   ```
   {
     type: "thread.turn.start",
     commandId: `turn-start-${uuid}`,
     threadId,
     message: { messageId: `message-${uuid}`, role: "user",
                text: <reply>, attachments: [] },
     runtimeMode: thread.runtimeMode,
     interactionMode: thread.interactionMode,
     createdAt: new Date().toISOString(),
   }
   ```
   Returns `{ sequence: number }`. Requires `orchestration:operate`.

CRITICAL: the field is nested `message.text`, NOT top-level `messageText`
(that older shape is rejected at this commit). Fresh uuid per send (dedup).

## Auth provisioning (one-time, non-interactive, least-privilege)

A committed helper script `scripts/t3-provision-bearer.sh` (owner runs once;
also runnable by us): 
1. Mint an admin bearer via the app-bundled server CLI (supported, no desktop
   click):
   ```
   ELECTRON_RUN_AS_NODE=1 "<T3.app>/Contents/MacOS/<bin>" \
     "<T3.app>/Contents/Resources/app.asar/apps/server/dist/bin.mjs" \
     auth session issue --base-dir "$HOME/.t3" --subject room-of-devs-daemon \
     --label "Room of Devs daemon" --ttl 30d --token-only
   ```
   (Resolve the .app path from the running T3 or `server-runtime.json`; the
   nightly bundle name is "T3 Code (Nightly)".)
2. Delegate down to least privilege: `POST /api/auth/pairing-token` (Bearer =
   admin, needs `access:write`) with `{ label, scopes:
   ["orchestration:read","orchestration:operate"] }` → one-time credential →
   exchange at `POST /oauth/token` (grant_type token-exchange,
   subject_token_type environment-bootstrap) → restricted 30-day bearer.
3. Store ONLY the restricted bearer at `~/.cursor/tts/secrets/t3-bearer`
   (mode 0600, dir 0700). Never log it. Discard the admin bearer.

Daemon reads that file; if missing/expired, replies fail with a clear notice
("T3 reply auth not provisioned — run t3-provision-bearer.sh"). Do NOT read
T3's master signing key (Sol option 2) — the CLI route avoids it.

Rotation: bearer ~30-day expiry. Daemon logs a warning when
`/api/auth/session` reports <3 days left; owner re-runs the script. (A
future auto-rotate via stored admin bearer is possible but out of scope.)

## Daemon (`tts-server/src`)

- NEW `t3-reply.ts`:
  - `t3ReplyAvailable(): boolean` — bearer file exists.
  - `sendT3Reply(claudeSessionId, text, attachments?): Promise<{ok, error?}>`
    — maps claudeSessionId → T3 threadId via the EXISTING resume-cursor
    lookup (extend `t3-thread-state.ts` with `t3ThreadIdForSession(sid)`),
    then runs the transport sequence. All failures return `{ok:false,error}`
    (never throw into the command path). Uses global `fetch` (Node 18+).
  - Bounded: 8s total timeout per send; no ret␛ry storm (one retry on network
    error, then fail).
- `services/commands.ts` reply/inject handler: today mobile reply for team
  sessions runs `inject_prompt.sh` (tmux). Branch:
  - team session → existing inject path (unchanged).
  - sdk session (isSdkCard) with `t3ReplyAvailable()` → `sendT3Reply`; emit a
    CommandResult ok/notice. On success the Phase A transcript tail surfaces
    the agent's response (no extra plumbing).
  - sdk session without provisioning → notice to provision.
- Snapshot: add `agent.replyable: boolean` (protocol optional) = team OR
  (sdk && t3ReplyAvailable). Mobile uses THIS to show the composer, so the
  UI never offers a reply that will bounce.

## Protocol / fixtures

- `AgentViewSchema`: add optional `replyable?: boolean`. Builder emits it.
- Reuse the existing reply command type if one exists for team inject
  (check `COMMAND_TYPES` — likely a `reply`/`inject` command); if mobile
  currently sends the same command for team replies, sdk reuses it and the
  daemon branches on session kind. Only add a new command if the existing
  reply command can't carry attachments. Fixtures + hand-validate updated for
  any new/extended command.

## Mobile (`packages/mobile/src`)

- `ConvoSheet.tsx` / `ChatView.tsx`: composer shown when `agent.replyable`
  (was `injectable`). Remove the Phase A "coming soon" hint for sdk sessions
  that are replyable. Reply send reuses the existing composer dispatch.
- Image attachments (stretch): the composer likely already supports
  attachments for team/desktop chat (panel shipped "typed chat +
  attachments"). For sdk sessions, attachments flow into `sendT3Reply` and
  map to T3's attachment schema: `{ type:"image", name, mimeType:
  "image/<x>", sizeBytes, dataUrl: "data:<mime>;base64,..." }`, ≤10MiB
  decoded, ≤8 per message. Build + verify text FIRST; attachments second.

## Test plan

Free / no-cost-to-us lane:
1. `scripts/t3-provision-bearer.sh` dry mechanics: verify it resolves the
   T3 app path + server origin and the endpoints exist (GET probes only) —
   WITHOUT minting until we intend to. Then provision once for real (writes
   a T3 auth row — that's T3's own store, acceptable; it's the owner's app).
   Assert bearer file is 0600 and `/api/auth/session` reports the 2 scopes.
2. `t3-reply.ts` against the owner's REAL current T3 session (this very
   thread is an sdk session): send a SHORT test reply ("ack from room —
   ignore"); confirm `{sequence}` returned and the message appears in the
   T3 thread transcript (`state.sqlite` projection_thread_messages, read-only)
   and/or the T3 app. This spends NOTHING on our providers — it's a T3-side
   turn on the owner's own T3/Anthropic account, which is exactly the normal
   cost of the owner typing in T3. Keep it to ONE short reply.
3. Session-kind branch: team session still injects via tmux (unaffected);
   sdk-without-bearer shows the provision notice.
4. Browser round (codex computer use / chrome-devtools MCP): from the mobile
   page, open an sdk session chat, type a reply, send, confirm it posts and
   the T3 thread advances; toggle Phase A live to watch the response arrive.
   Screenshots as evidence.
5. Image attachment (if built): send one small test image; confirm it lands
   as an attachment on the T3 turn.
6. `pnpm typecheck` + `pnpm check-fixtures` clean; mobile dist rebuilt.

Security review: run the `security-review` skill on the diff before ship —
this handles a bearer token + shells out to the T3 CLI. Confirm: bearer never
logged/argv'd, file perms 0600, no signing-key access, loopback-only calls,
failures don't leak token in notices.

## Risks (from Sol)

- Protocol drift: pin behavior to installed commit; startup capability check
  (probe `/.well-known/t3/environment` + `/api/auth/session`), fail closed
  with a clear notice rather than guessing.
- Token expiry (~30d) + no auto-rotate v1 → owner re-provisions; daemon warns
  early.
- T3 not running / stale server-runtime.json → reply fails gracefully with
  "T3 server not reachable".
- Attachments schema/limits can move; validate against installed contracts.
- Never kill/restart T3; never write its sqlite directly.
