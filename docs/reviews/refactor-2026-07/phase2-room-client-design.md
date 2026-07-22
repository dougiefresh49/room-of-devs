# room-client API design draft (Phase 2, UI refactor)

Context: personal macOS "room of devs" tool. A Node daemon broadcasts a
`PanelSnapshot` (typed via the existing `@room/protocol` valibot package) to
two UIs: a Tauri desktop panel over **loopback WS** (token via Tauri
`invoke("ws_token")` → `{token, port}`) and a phone page over **LAN SSE +
POST /action**. Phase 2 builds `packages/room-client`: a framework-free
external store + transports that both UIs consume UNDER their existing
renderers (no visual changes). Later phases mount React on top via
`useSyncExternalStore`.

Server facts (already shipped, Phase 0/1):
- Every snapshot carries `rev` (daemon-local monotonic, resets on daemon
  restart). WS frame: `{type:"snapshot", ...PanelSnapshot}`. SSE frame: bare
  `PanelSnapshot` JSON (no `type`), plus `{type:"notice"}` events on the
  same stream. SSE endpoint sends a snapshot immediately on connect.
- Commands may carry `requestId` (non-empty string) + `source`
  ("desktop"|"mobile"|...). If a WS command has a requestId the server
  replies `{type:"command_result", requestId, ok, code?, message?,
  sessionId?}` — ok=true means ACCEPTED/dispatched, not completed. Query
  replies (resumable, known_dirs, buttons, settings, list_voices,
  shortcuts) are tagged with the requestId too. Legacy no-requestId
  behavior unchanged. Mobile POST /action returns its result in the HTTP
  response (no requestId needed).
- Legacy uncorrelated `{type:"error"}` frames still emitted alongside
  command_result. `{type:"notice"}` broadcast for async failures.
- Unknown event kinds must be ignored (additive protocol).

Intended behavior changes in Phase 2 (everything else = parity):
1. WS reconnect gets real backoff+jitter (reconnecting-websocket) instead
   of the panel's fixed 2s timer.
2. Snapshot application drops frames whose rev <= last applied rev.
3. Grant optimism (duplicated 25s pending logic in panel + mobile) is
   implemented once, in the client.

Grant optimism semantics being moved (from panel main.ts): on grant click,
set pendingGrant{sessionId, at:now, baselineKey} where baselineKey =
summaryKey(nowPlaying) if a live non-phone non-ended message is playing,
else null. summaryKey = `${sessionId}:${startedAt}`. Cleared when: 25s
elapsed; OR nowPlaying becomes a phone-routed frame (kind==="live" ||
output==="phone"); OR a live non-ack nowPlaying appears whose key differs
from baselineKey. (Meaning: audio actually started, or someone else took
the stage.) Kept while the same pre-click message is still playing or
nothing is playing.

## Proposed package layout

```
packages/room-client/src/
  index.ts          # public exports
  types.ts          # RoomState, Transport, RoomClientOptions
  store.ts          # RoomClient class: external store + event routing
  selectors.ts      # pure selectors over RoomState
  grant.ts          # grant-optimism reducer (pure) + timer wiring
  ws-transport.ts   # WsTransport (reconnecting-websocket)
  sse-transport.ts  # SseTransport (native EventSource + fetch for queries)
```

Deps: `@room/protocol` (workspace), `reconnecting-websocket`. No React, no
DOM assumptions beyond WebSocket/EventSource/fetch globals (injectable for
the WS ctor since reconnecting-websocket takes a WebSocket class option).

## Core types

```ts
interface RoomState {
  connected: boolean;
  snapshot: PanelSnapshot | null;   // last applied (rev-gated)
  pendingGrantSessionId: string | null;
}

interface Transport {
  start(): void;
  stop(): void;
  send(cmd: object): boolean;                  // false if not connected (WS); SSE: POST fire
  request(cmd: Command & {requestId}): Promise<CommandResult>; // transport-appropriate
  onEvent(cb: (ev: ServerEvent) => void): () => void;
  onConnection(cb: (up: boolean) => void): () => void;
}

class RoomClient {
  constructor(transport: Transport, opts?: { source?: CommandSource; now?: () => number });
  // store contract (useSyncExternalStore-compatible)
  subscribe(listener: () => void): () => void;
  getState(): RoomState;                        // stable ref between changes
  // events that are NOT snapshot state (notices, legacy errors, query
  // replies, snap, captured) — old renderers keep their handlers:
  onEvent(cb: (ev: ServerEvent) => void): () => void;
  // commands
  send(cmd: Command): void;                     // legacy fire-and-forget
  request(cmd: Command, timeoutMs=10000): Promise<CommandResult>;
  grant(sessionId: string, output?: "mac"|"phone"): void; // send + optimism
  dispose(): void;
}
```

Selectors (pure, over RoomState): selectVisibleAgents, selectNowPlaying,
selectGrantPending, selectRoomHeld, selectPaused, selectTriageFocus,
selectPhoneAck, selectAgent(state, sessionId), isPhoneRoutedFrame(np),
isPhoneFrame(np, now) — the last two move from panel/mobile duplicates.

## Semantics

- **Rev gating**: apply snapshot iff `rev === undefined || rev >
  lastAppliedRev`. On every transport (re)connect, lastAppliedRev resets to
  -Infinity — a daemon restart resets the counter, so revs only order
  frames within one connection. connected=false does NOT clear the
  snapshot (both UIs keep rendering last-known state greyed out).
- **requestId**: generated `crypto.randomUUID()` fallback counter. request()
  on WS registers a pending entry, attaches requestId+source, resolves on
  command_result, ALSO resolves query replies: for query commands the
  promise resolves with the reply event itself (typed overloads:
  `query(cmd: {type:"list_resumable"}) → Promise<ResumableEvent>` etc.).
  Rejects on timeout or transport stop. On reconnect, in-flight requests
  reject (stale socket).
- **Legacy compatibility**: panel keeps its existing handleMessage switch
  for query replies/errors/notices during Phase 2 by subscribing to
  client.onEvent — the store only owns snapshot+connection+grant. This
  keeps the diff small and behavior-parity verifiable; Phase 3 moves reads
  onto selectors.
- **Grant timer**: pending grant re-evaluated on every snapshot apply AND a
  setTimeout at the 25s deadline so the spinner clears without a snapshot.
- **SSE transport**: EventSource(`/stream?token=…`); frames without `type`
  are snapshots, `notice` passes through; `open` event resets rev baseline;
  send() → fetch POST /action; request() → same POST, resolving the HTTP
  JSON body as a CommandResult-shaped object.

## Open questions for review

1. Is splitting store-owned state (snapshot/connection/grant) from
   pass-through events (onEvent) the right Phase-2 seam, or should query
   replies also be cached in the store now?
2. Rev reset-on-reconnect: any hole? (e.g. SSE proxies replaying old
   frames after open?)
3. Grant-optimism: any race when grant() is called while disconnected?
4. reconnecting-websocket specifics: token refresh via async url provider
   per attempt — sufficient? (Tauri invoke re-read each attempt.)
5. Anything about this API that would fight the Phase-3 React islands or
   the Phase-5 mobile Vite SPA?

---

## Outcome (post-critique, as implemented)

Sol's adversarial review (gpt-5.6-sol) reshaped the draft; deltas that
made it into the code:

- SSE facts corrected: `/events` + POST `/action` (cookie/`t=` auth is the
  page's concern; transport takes paths only), HTTP results normalized into
  a CommandResult shape by the transport, bare snapshots wrapped as
  `{type:"snapshot"}` before schema validation.
- Staleness gate is `(epoch, rev)` — additive `epoch` (daemon boot time)
  added to PanelSnapshot; baseline resets only on epoch change, not on
  every reconnect. Pre-epoch daemons: reset-on-reconnect fallback.
- Grant optimism: per-session `PendingGrants` map (dedup per session,
  dispatch-failure rollback via typed `TransportError` kinds
  down/stopped vs timeout/closed), panel baseline-key semantics per
  session. `RoomState.pendingGrants` replaces the draft's single id.
- `request()` settles only on `command_result`; `query()` settles on the
  expected tagged domain reply, rejects on failed command_result, caches
  replies (`getCachedQuery`) while still passing them through `onEvent`.
- reconnecting-websocket async-url-provider wedge guarded (never-rejecting
  provider, last-known-URL / fast-fail fallback); `maxEnqueuedMessages: 0`
  keeps drop-when-closed parity.
- Server: SSE subscribes before the bootstrap write (lost-update gap).
- Mobile wiring deferred to Phase 5 (grok triage + Sol concurring); see
  decisions-overnight.md.
