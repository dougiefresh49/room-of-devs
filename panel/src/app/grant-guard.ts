/**
 * Cross-realm grant belt (Sol #4, settlement fix from the deploy review).
 * In 4b the two windows run independent RoomClients, so client-side
 * pendingGrants can't see a grant fired from the other realm. localStorage
 * is shared across both webviews (same app data store, same origin), so
 * grants leave a marker here; dispatch checks it, and cards render the
 * spinner from either source.
 *
 * Settlement: each realm settles ITS OWN markers — syncSettledGrants()
 * (called from the bootstrap store subscription) removes a marker as soon
 * as RoomClient clears the matching pendingGrants entry (audio started,
 * dispatch failed, or the 25s belt expired). The other realm does the same
 * for its markers — it keeps running while hidden. The 25s TTL remains the
 * backstop for a crashed realm.
 *
 * The daemon's claim markers remain the BILLING authority — this belt only
 * prevents cosmetic divergence and redundant dispatches in the seconds
 * around a mode switch. Harmlessly inert while only one window exists (4a).
 */
import { PENDING_GRANT_MS } from "@room/room-client";
import type { RoomClient } from "@room/room-client";

const KEY_PREFIX = "room_grant_pending:";

/** Sessions THIS realm wrote markers for (settled via syncSettledGrants). */
const ourMarks = new Set<string>();

function markKey(sessionId: string): string {
  return `${KEY_PREFIX}${sessionId}`;
}

function freshMarkAt(sessionId: string): number | null {
  try {
    const raw = localStorage.getItem(markKey(sessionId));
    if (!raw) return null;
    const at = Number(raw);
    if (!Number.isFinite(at)) return null;
    if (Date.now() - at > PENDING_GRANT_MS) {
      localStorage.removeItem(markKey(sessionId));
      return null;
    }
    return at;
  } catch {
    return null;
  }
}

/** Fresh (<25s, unsettled) grant marker from EITHER realm. */
export function crossRealmGrantPending(sessionId: string): boolean {
  return freshMarkAt(sessionId) != null;
}

/** Newest fresh marker across realms (dock spotlight staging). */
export function latestCrossRealmPending(): string | null {
  let latest: string | null = null;
  let latestAt = -1;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(KEY_PREFIX)) continue;
      const sessionId = key.slice(KEY_PREFIX.length);
      const at = freshMarkAt(sessionId);
      if (at != null && at > latestAt) {
        latestAt = at;
        latest = sessionId;
      }
    }
  } catch {
    return null;
  }
  return latest;
}

/**
 * Settle our markers against RoomClient's optimism state. Called from the
 * bootstrap store subscription on every state change — when the client
 * clears a pending grant (success, rollback, or belt expiry), the shared
 * marker goes with it.
 */
export function syncSettledGrants(client: RoomClient): void {
  if (ourMarks.size === 0) return;
  const pending = client.getState().pendingGrants;
  for (const sessionId of [...ourMarks]) {
    if (pending.has(sessionId)) continue;
    ourMarks.delete(sessionId);
    try {
      localStorage.removeItem(markKey(sessionId));
    } catch {
      // Marker will die by TTL.
    }
  }
}

/** Single grant dispatch path for the panel: belt check, then client. */
export function dispatchGrant(client: RoomClient, sessionId: string): void {
  if (client.getState().pendingGrants.has(sessionId)) return;
  if (crossRealmGrantPending(sessionId)) return;
  try {
    localStorage.setItem(markKey(sessionId), String(Date.now()));
    ourMarks.add(sessionId);
  } catch {
    // Storage unavailable → fall through; client-side dedup still applies.
  }
  client.grant(sessionId);
}

/** Spinner state: this realm's optimism OR the other realm's fresh marker. */
export function grantPendingFor(client: RoomClient, sessionId: string): boolean {
  return client.getState().pendingGrants.has(sessionId) || crossRealmGrantPending(sessionId);
}
