/**
 * Karaoke word timing — the pure half of mobile.html's karaokeFromAlignment.
 *
 * Given ElevenLabs word/start-ms tuples and an elapsed time, classify each
 * word past / current ("on") / future so the strip can highlight the spoken
 * word and scroll it into view. Returns null when there is no alignment (the
 * caller renders plain text instead). No DOM, no React — kept mobile-local per
 * the phase-5 design (extract to @room/ui only if a second surface needs it).
 */
import type { AlignmentTuples } from "@room/protocol";

export type KaraokeState = "past" | "on" | "future";
export interface KaraokeWord {
  word: string;
  state: KaraokeState;
}

/**
 * The word index that is "on" at `elapsedMs`: the last word whose start time
 * is <= elapsed. -1 before the first word starts.
 */
export function activeWordIndex(alignment: AlignmentTuples, elapsedMs: number): number {
  let active = -1;
  for (let i = 0; i < alignment.length; i++) {
    const startMs = alignment[i][1];
    if (typeof startMs === "number" && startMs <= elapsedMs) active = i;
  }
  return active;
}

/** Per-word highlight states, or null when there is nothing to highlight. */
export function karaokeWords(
  alignment: AlignmentTuples | null | undefined,
  elapsedMs: number,
): KaraokeWord[] | null {
  if (!Array.isArray(alignment) || alignment.length === 0) return null;
  const active = activeWordIndex(alignment, elapsedMs);
  return alignment.map(([word], i) => ({
    word,
    state: i === active ? "on" : i < active ? "past" : "future",
  }));
}
