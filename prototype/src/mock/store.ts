import { useSyncExternalStore } from "react";
import { makeFleetFixtures } from "./fixtures";
import type { FleetState, RoomId, RoomState, SpendState } from "./types";

export interface AppState {
  fleet: FleetState;
  rooms: Record<RoomId, RoomState>;
}

let state: AppState = makeFleetFixtures();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function getRoom(): RoomState {
  const room = state.rooms[state.fleet.activeRoomId];
  if (!room) throw new Error(`Active room not found: ${state.fleet.activeRoomId}`);
  return room;
}

export function getFleet(): FleetState {
  return state.fleet;
}

export function getAppState(): AppState {
  return state;
}

export function setRoom(next: RoomState | ((prev: RoomState) => RoomState)) {
  const roomId = state.fleet.activeRoomId;
  const current = getRoom();
  const room = typeof next === "function" ? next(current) : next;
  state = { ...state, rooms: { ...state.rooms, [roomId]: room } };
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

export function setFleet(next: FleetState | ((prev: FleetState) => FleetState)) {
  const fleet = typeof next === "function" ? next(state.fleet) : next;
  state = { ...state, fleet };
  emit();
}

export function patchFleet(partial: Partial<FleetState>) {
  setFleet((fleet) => ({ ...fleet, ...partial }));
}

export function setAppState(next: AppState | ((prev: AppState) => AppState)) {
  state = typeof next === "function" ? next(state) : next;
  emit();
}

export function useFleet(): FleetState {
  return useSyncExternalStore(subscribe, getFleet, getFleet);
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

/**
 * TOTAL draw across everything we meter — the plain mean of every guard
 * window's utilization. Defensible because each window is already normalized
 * to its own cap, so "half the hexes lit" reads as "the room is running at
 * about half of what it's allowed", regardless of which provider is hot.
 */
export function aggregateDraw(spend: SpendState): number {
  const windows = spend.guards.flatMap((g) => g.windows);
  if (windows.length === 0) return spend.monthFraction;
  const sum = windows.reduce((a, w) => a + w.fraction, 0);
  return Math.min(1, Math.max(0, sum / windows.length));
}

export function resetRoom() {
  state = makeFleetFixtures();
  emit();
}
