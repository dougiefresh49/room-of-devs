/**
 * Grant optimism — the ONE implementation of the "show a loading state for
 * up to 25s after a grant click" behavior that panel/src/main.ts and
 * mobile.html previously each hand-rolled.
 *
 * Unified semantics (logged in docs/reviews/refactor-2026-07/
 * decisions-overnight.md):
 *  - Pending grants are per-session (mobile's concurrency model) with
 *    duplicate clicks for a session ignored while one is in flight.
 *  - A session's pending clears when ITS audio starts — a non-ended frame
 *    from that session that differs from the message playing at click time
 *    (panel's baseline-key rule, scoped per session), or a live
 *    phone-routed frame from that session (grant-to-phone landed).
 *  - Belt: 25s wall-clock timeout.
 *  - RoomClient additionally clears a pending on dispatch failure
 *    (mobile's rollback; the panel used to leave a doomed spinner).
 *
 * Pure reducer: callers pass the snapshot + wall clock; timer/dispatch
 * wiring lives in RoomClient.
 */
import type { NowPlaying, PanelSnapshot } from "@room/protocol";
import { isPhoneRoutedFrame, nowPlayingKey } from "./selectors.js";

export const PENDING_GRANT_MS = 25_000;

export interface PendingGrant {
  sessionId: string;
  at: number;
  /** nowPlaying key at click time — keep pending while that message lives. */
  baselineKey: string | null;
}

export type PendingGrants = ReadonlyMap<string, PendingGrant>;

export const NO_PENDING_GRANTS: PendingGrants = new Map();

export function beginGrant(
  sessionId: string,
  snapshot: PanelSnapshot | null,
  now: number,
): PendingGrant {
  const np = snapshot?.nowPlaying ?? null;
  const baselineKey =
    np && !np.endedAt && !isPhoneRoutedFrame(np) ? nowPlayingKey(np) : null;
  return { sessionId, at: now, baselineKey };
}

/** The granted session's audio started (Mac stage or phone stream). */
function grantSettled(pending: PendingGrant, np: NowPlaying | null): boolean {
  if (!np || np.endedAt || np.sessionId !== pending.sessionId) return false;
  if (isPhoneRoutedFrame(np)) return true;
  if (np.kind === "ack") return false;
  return nowPlayingKey(np) !== pending.baselineKey;
}

/**
 * Prune settled/expired pendings. Returns the SAME map reference when
 * nothing changed so store subscribers can cheap-compare.
 */
export function reduceGrants(
  pending: PendingGrants,
  snapshot: PanelSnapshot | null,
  now: number,
): PendingGrants {
  if (!pending.size) return pending;
  const np = snapshot?.nowPlaying ?? null;
  let next: Map<string, PendingGrant> | null = null;
  for (const [sessionId, grant] of pending) {
    if (now - grant.at > PENDING_GRANT_MS || grantSettled(grant, np)) {
      next ??= new Map(pending);
      next.delete(sessionId);
    }
  }
  return next ?? pending;
}
