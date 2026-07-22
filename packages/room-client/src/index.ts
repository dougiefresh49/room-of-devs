/**
 * @room/room-client — framework-free shared client for the Room UIs.
 *
 * RoomClient (store.ts) + a transport (ws-transport.ts for the desktop
 * panel's loopback WS, sse-transport.ts for the mobile page's LAN SSE +
 * POST /action) give both UIs one implementation of: connection state,
 * rev-gated snapshot application, requestId/CommandResult correlation,
 * and grant optimism. Selectors are the read API; Phase 3 mounts React on
 * top via useSyncExternalStore(client.subscribe, client.getState).
 */
export { RoomClient } from "./store.js";
export {
  NO_PENDING_GRANTS,
  PENDING_GRANT_MS,
  beginGrant,
  reduceGrants,
  type PendingGrant,
  type PendingGrants,
} from "./grant.js";
export * from "./selectors.js";
export * from "./types.js";
export { WsTransport } from "./ws-transport.js";
export { SseTransport } from "./sse-transport.js";
