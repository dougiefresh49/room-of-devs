/**
 * Avatar frame preloading + readiness registries (moved verbatim from
 * main.ts). Readiness gates which optional frames (mouth-mid/closed,
 * blink, expression sets) the frame picker may use — a missing PNG must
 * degrade to neutral frames, never to a broken img.
 */

export type MoodFamily = "excited" | "confused";
export type ExpressionsManifest = Record<string, Partial<Record<MoodFamily, string>>>;

const mouthMidReady = new Map<string, boolean>();
const mouthClosedReady = new Map<string, boolean>();
const blinkReady = new Map<string, boolean>();
/** `${character}:${expr}:${frame}` → loaded successfully */
const exprFrameReady = new Map<string, boolean>();

export let expressionsManifest: ExpressionsManifest = {};

export function hasMouthMid(character: string): boolean {
  return mouthMidReady.get(character) === true;
}

export function hasMouthClosed(character: string): boolean {
  return mouthClosedReady.get(character) === true;
}

export function hasBlink(character: string): boolean {
  return blinkReady.get(character) === true;
}

export function exprFrameKey(
  character: string,
  expr: string,
  frame: "speaking" | "mouth-mid" | "mouth-closed",
): string {
  return `${character}:${expr}:${frame}`;
}

export function isExprSetReady(character: string, expr: string): boolean {
  return (
    exprFrameReady.get(exprFrameKey(character, expr, "speaking")) === true &&
    exprFrameReady.get(exprFrameKey(character, expr, "mouth-mid")) === true &&
    exprFrameReady.get(exprFrameKey(character, expr, "mouth-closed")) === true
  );
}

export function blinkFrameSrc(character: string): string {
  return `avatars/tmnt/${character}/blink.png`;
}

function preloadNeutralFrames(character: string) {
  // Neutral idle/speaking: warm cache only (no readiness gate — always assumed).
  for (const frame of ["idle", "speaking"] as const) {
    const img = new Image();
    img.src = `avatars/tmnt/${character}/${frame}.png`;
  }
  const mid = new Image();
  mid.onload = () => mouthMidReady.set(character, true);
  mid.onerror = () => mouthMidReady.set(character, false);
  mid.src = `avatars/tmnt/${character}/mouth-mid.png`;
  const closed = new Image();
  closed.onload = () => mouthClosedReady.set(character, true);
  closed.onerror = () => mouthClosedReady.set(character, false);
  closed.src = `avatars/tmnt/${character}/mouth-closed.png`;
  const blink = new Image();
  blink.onload = () => blinkReady.set(character, true);
  blink.onerror = () => blinkReady.set(character, false);
  blink.src = blinkFrameSrc(character);
}

function preloadExpressionFrames() {
  for (const [character, moods] of Object.entries(expressionsManifest)) {
    if (!moods || typeof moods !== "object") continue;
    for (const expr of Object.values(moods)) {
      if (typeof expr !== "string" || !expr) continue;
      for (const frame of ["speaking", "mouth-mid", "mouth-closed"] as const) {
        const key = exprFrameKey(character, expr, frame);
        const img = new Image();
        img.onload = () => exprFrameReady.set(key, true);
        img.onerror = () => exprFrameReady.set(key, false);
        img.src = `avatars/tmnt/${character}/${expr}-${frame}.png`;
      }
    }
  }
}

async function loadExpressionsManifest() {
  try {
    const res = await fetch("avatars/tmnt/expressions.json");
    if (!res.ok) return;
    const data: unknown = await res.json();
    if (!data || typeof data !== "object" || Array.isArray(data)) return;
    expressionsManifest = data as ExpressionsManifest;
    preloadExpressionFrames();
  } catch {
    // Missing/404/invalid → neutral-only; art lands independently.
  }
}

export function preloadAvatarFrames(avatarDirs: string[]): void {
  const chars = new Set<string>(["default", ...avatarDirs]);
  for (const character of chars) preloadNeutralFrames(character);
  void loadExpressionsManifest();
}
