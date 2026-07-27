import { type StickPole } from "./config.js";

// ── Report diffing ────────────────────────────────────────────────
// The encoder is a plain HID gamepad: input reports carry button states as a
// bitmask somewhere in the report (typically bytes 5-6 on DragonRise), plus
// analog axes for the stick. We don't hardcode byte offsets — we XOR each
// report against the previous one and treat every changed bit as an event,
// keyed by a stable index = byteOffset*8 + bitOffset. That index is
// deterministic across runs (so learn mode's mapping stays valid).
//
// Axes are NOT bit-edges: they're analog bytes centered ~127. Calibration
// records which bytes jittered at idle (axis candidates) + each one's median
// baseline. Stick dispatch uses threshold + hysteresis on those bytes.
export type Edge = "down" | "up";

// Analog axis bytes jitter constantly at idle (127↔128↔129 ADC noise on the
// DragonRise encoders), which XOR-diffing would read as phantom button edges.
// So every differ starts with a calibration window: any bit that changes while
// the device should be untouched is marked noise and masked forever after.
const CALIBRATION_MS = 1500;

export interface Differ {
  (buf: Buffer, emit: (edge: Edge, idx: number) => void): void;
  /** Byte offsets that changed during the idle calibration window. */
  axisCandidates: () => number[];
  /** Median idle value per axis-candidate byte. */
  axisBaselines: () => Map<number, number>;
  isCalibrated: () => boolean;
}

function median(samples: number[]): number {
  if (samples.length === 0) return 127;
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1]! + sorted[mid]!) / 2) : sorted[mid]!;
}

export function makeDiffer(onCalibrated?: (noisyCount: number) => void): Differ {
  let prev: Buffer | null = null;
  let calibrateUntil = 0;
  let calibrated = false;
  const noise = new Set<number>();
  // During calibration: any byte whose value changes is an axis candidate;
  // we keep every sample of that byte to compute a median baseline.
  const axisChanged = new Set<number>();
  const axisSamples = new Map<number, number[]>();
  let baselines = new Map<number, number>();

  const differ = ((buf: Buffer, emit: (edge: Edge, idx: number) => void) => {
    const now = Date.now();
    if (!prev) {
      prev = Buffer.from(buf);
      calibrateUntil = now + CALIBRATION_MS;
      // Seed samples from the first report so a quiet axis still has a baseline
      // if it later jitters once.
      for (let byte = 0; byte < buf.length; byte++) {
        axisSamples.set(byte, [buf[byte]!]);
      }
      return;
    }
    if (!calibrated && now >= calibrateUntil) {
      calibrated = true;
      baselines = new Map();
      for (const byte of axisChanged) {
        baselines.set(byte, median(axisSamples.get(byte) ?? [127]));
      }
      onCalibrated?.(noise.size);
    }
    const len = Math.max(prev.length, buf.length);
    for (let byte = 0; byte < len; byte++) {
      const a = prev[byte] ?? 0;
      const b = buf[byte] ?? 0;
      if (!calibrated) {
        const samples = axisSamples.get(byte) ?? [];
        samples.push(b);
        axisSamples.set(byte, samples);
        if (a !== b) axisChanged.add(byte);
      }
      let changed = a ^ b;
      if (!changed) continue;
      for (let bit = 0; bit < 8; bit++) {
        const mask = 1 << bit;
        if (changed & mask) {
          const idx = byte * 8 + bit;
          if (!calibrated) noise.add(idx);
          else if (!noise.has(idx) && !mappedAxisBytes.has(byte)) {
            emit(b & mask ? "down" : "up", idx);
          }
        }
      }
    }
    prev = Buffer.from(buf);
  }) as Differ;

  differ.axisCandidates = () => [...axisChanged].sort((a, b) => a - b);
  differ.axisBaselines = () => new Map(baselines);
  differ.isCalibrated = () => calibrated;
  return differ;
}

// ── Stick axis: threshold + hysteresis (pure) ─────────────────────
// Fire when the byte crosses the pole threshold FROM armed; re-arm only when
// the value returns to the dead zone (96–160). Cooldown is applied by caller.
export type StickArmState = "armed" | "fired";

const STICK_FIRE_LOW = 64;
const STICK_FIRE_HIGH = 192;
export const STICK_REARM_LO = 96;
export const STICK_REARM_HI = 160;
export const STICK_LEARN_MIN_DEV = 48;
export const STICK_LEARN_SAMPLE_MS = 1200;

export function evaluateStickAxis(
  prev: StickArmState,
  value: number,
  pole: StickPole,
): { fire: boolean; state: StickArmState } {
  if (prev === "armed") {
    const crossed = pole === "low" ? value < STICK_FIRE_LOW : value > STICK_FIRE_HIGH;
    if (crossed) return { fire: true, state: "fired" };
    return { fire: false, state: "armed" };
  }
  // fired → re-arm in dead zone
  if (value >= STICK_REARM_LO && value <= STICK_REARM_HI) {
    return { fire: false, state: "armed" };
  }
  return { fire: false, state: "fired" };
}

/** Axis bytes currently mapped in sticks — excluded from bit-edge button emit. */
export const mappedAxisBytes = new Set<number>();
