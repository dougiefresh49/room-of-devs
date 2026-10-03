// Speed across the render and the player. ElevenLabs bakes some speed into
// the audio; the player (ffplay atempo, afplay -r, the phone's playbackRate)
// makes up the rest.

// eleven_v4 ignores speed (and style) without an error (comic-reader #213
// probe, 2026-09-28), so it bakes in none. v3 and earlier accept speed in
// [0.7, 1.2].
const EL_SPEED_MIN = 0.7;
const EL_SPEED_MAX = 1.2;

export function modelTakesSpeed(modelId: string): boolean {
  return !modelId.startsWith("eleven_v4");
}

/** The speed ElevenLabs bakes into a render: 1.0 when the model ignores speed. */
export function bakedSpeed(modelId: string, rawSpeed: number): number {
  if (!modelTakesSpeed(modelId)) return 1.0;
  return Math.min(EL_SPEED_MAX, Math.max(EL_SPEED_MIN, rawSpeed));
}

/** The playback factor that takes a render baked at `baked` up to `rawSpeed`. */
export function residualTempo(rawSpeed: number, baked: number): number {
  return +(rawSpeed / baked).toFixed(4);
}
