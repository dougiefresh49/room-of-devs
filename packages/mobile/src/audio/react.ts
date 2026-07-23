/**
 * React bindings for the AudioController stores. Kept out of controller.ts so
 * that module stays framework-free (it owns the <audio>, not the renderer).
 */
import { useSyncExternalStore } from "react";
import { audioController, type Notice, type PlayerSnapshot } from "./controller.js";

/** Full player state — re-renders on the 80ms karaoke tick while playing. */
export function usePlayer(): PlayerSnapshot {
  return useSyncExternalStore(audioController.subscribe, audioController.getSnapshot);
}

/**
 * Only the currently-loaded file — a primitive that is stable across ticks, so
 * a subscriber (the replay list's "playing" highlight) does NOT re-render 12×/s.
 */
export function usePlayingFile(): string | null {
  return useSyncExternalStore(
    audioController.subscribe,
    () => audioController.getSnapshot().file,
  );
}

/** Transient toast text from the controller (never churns on ticks). */
export function useNotice(): Notice | null {
  return useSyncExternalStore(audioController.subscribeNotice, audioController.getNotice);
}

/** Just the catch-up flag — a boolean stable across ticks (overflow menu). */
export function useCatchUp(): boolean {
  return useSyncExternalStore(
    audioController.subscribe,
    () => audioController.getSnapshot().catchUp,
  );
}
