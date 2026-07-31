import { useSyncExternalStore } from "react";
import { makeFixtures } from "./fixtures";
import type { RoomState, SpendState } from "./types";

let state: RoomState = makeFixtures();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function getRoom(): RoomState {
  return state;
}

export function setRoom(next: RoomState | ((prev: RoomState) => RoomState)) {
  state = typeof next === "function" ? next(state) : next;
  emit();
}

export function patchRoom(partial: Partial<RoomState>) {
  setRoom((s) => ({ ...s, ...partial, rev: s.rev + 1 }));
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useRoom(): RoomState {
  return useSyncExternalStore(subscribe, getRoom, getRoom);
}

/**
 * The single tightest guard across every provider window — what the CORE
 * shows at a glance. Returns null only if there are no guards at all.
 */
export function worstGuard(
  spend: SpendState,
): { label: string; window: string; fraction: number } | null {
  let worst: { label: string; window: string; fraction: number } | null = null;
  for (const g of spend.guards) {
    for (const w of g.windows) {
      if (!worst || w.fraction > worst.fraction) {
        worst = { label: g.label, window: w.window, fraction: w.fraction };
      }
    }
  }
  return worst;
}

export function resetRoom() {
  state = makeFixtures();
  emit();
}
