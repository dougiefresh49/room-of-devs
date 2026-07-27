/**
 * Ephemeral island UI state that must survive portal re-targeting.
 *
 * Legacy render() rebuilds #app's DOM on every store change, which replaces
 * island placeholder nodes and remounts the portals inside them — React
 * component state would be lost mid-interaction. Kill-arm and the swap
 * popover therefore live in this tiny external store (the island-side
 * sibling of RoomClient), read via useSyncExternalStore.
 */

import { announce } from "./view-state.js";

// Confirm window for the end-session button. 2s proved too short in
// practice: a second click after disarm silently re-arms, which reads as
// "does nothing". (Moved verbatim from main.ts.)
export const KILL_ARM_MS = 8000;

export interface IslandUiState {
  /** Sessions whose end-session button is armed (next click confirms). */
  killArmed: ReadonlySet<string>;
  /** Session whose swap-character popover is open, if any. */
  swapOpen: string | null;
}

let state: IslandUiState = { killArmed: new Set(), swapOpen: null };
const listeners = new Set<() => void>();
const killTimers = new Map<string, ReturnType<typeof setTimeout>>();

function setState(next: IslandUiState) {
  state = next;
  for (const cb of listeners) cb();
}

export function subscribeUiState(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getUiState(): IslandUiState {
  return state;
}

export function isKillArmed(sessionId: string): boolean {
  return state.killArmed.has(sessionId);
}

export function armKill(sessionId: string): void {
  const existing = killTimers.get(sessionId);
  if (existing) clearTimeout(existing);
  killTimers.set(
    sessionId,
    // The window used to expire silently (audit U-6) — the button reverted
    // with nothing said. expired=true announces the revert.
    setTimeout(() => disarmKill(sessionId, true), KILL_ARM_MS),
  );
  if (!state.killArmed.has(sessionId)) {
    const next = new Set(state.killArmed);
    next.add(sessionId);
    setState({ ...state, killArmed: next });
    announce("End session armed — activate again within 8 seconds to confirm");
  }
}

export function disarmKill(sessionId: string, expired = false): void {
  const timer = killTimers.get(sessionId);
  if (timer) clearTimeout(timer);
  killTimers.delete(sessionId);
  if (state.killArmed.has(sessionId)) {
    const next = new Set(state.killArmed);
    next.delete(sessionId);
    setState({ ...state, killArmed: next });
    if (expired) announce("End session confirmation expired");
  }
}

export function setSwapOpen(sessionId: string | null): void {
  if (state.swapOpen === sessionId) return;
  setState({ ...state, swapOpen: sessionId });
}

/** Drop arm/popover state for sessions that left the room (snapshot prune). */
export function pruneUiState(liveSessionIds: ReadonlySet<string>): void {
  for (const sid of [...killTimers.keys()]) {
    if (!liveSessionIds.has(sid)) disarmKill(sid);
  }
  if (state.swapOpen && !liveSessionIds.has(state.swapOpen)) {
    setSwapOpen(null);
  }
}
