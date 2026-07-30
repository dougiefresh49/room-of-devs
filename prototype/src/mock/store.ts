import { useSyncExternalStore } from "react";
import { makeFixtures } from "./fixtures";
import type { RoomState } from "./types";

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

export function resetRoom() {
  state = makeFixtures();
  emit();
}
