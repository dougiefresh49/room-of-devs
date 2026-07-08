import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { TTS_DIR } from "./config.js";

export const TRIAGE_PATH = join(TTS_DIR, ".triage.json");
export const TRIAGE_IDLE_MS = 12_000;

export interface HandEntry {
  sessionId: string;
  raisedAt: string;
}

export type TriageCycleDir = "left" | "right";

/** Pure: cycle focus through raised hands (oldest-first). No I/O. */
export function nextTriageFocus(
  hands: HandEntry[],
  currentFocus: string | null,
  direction: TriageCycleDir
): string | null {
  if (hands.length === 0) return null;
  const sorted = [...hands].sort((a, b) => {
    const ta = Date.parse(a.raisedAt) || 0;
    const tb = Date.parse(b.raisedAt) || 0;
    if (ta !== tb) return ta - tb;
    return a.sessionId.localeCompare(b.sessionId);
  });
  const ids = sorted.map((h) => h.sessionId);
  const i = currentFocus ? ids.indexOf(currentFocus) : -1;
  if (i < 0) {
    // No / stale focus: right → oldest, left → newest.
    return direction === "right" ? ids[0] : ids[ids.length - 1];
  }
  if (direction === "right") return ids[(i + 1) % ids.length];
  return ids[(i - 1 + ids.length) % ids.length];
}

/** After dismissing `removed`, pick the next hand in FIFO order (or null). */
export function focusAfterDismiss(
  hands: HandEntry[],
  removed: string
): string | null {
  const remaining = hands.filter((h) => h.sessionId !== removed);
  if (remaining.length === 0) return null;
  const sorted = [...remaining].sort((a, b) => {
    const ta = Date.parse(a.raisedAt) || 0;
    const tb = Date.parse(b.raisedAt) || 0;
    if (ta !== tb) return ta - tb;
    return a.sessionId.localeCompare(b.sessionId);
  });
  const ids = sorted.map((h) => h.sessionId);
  // Prefer the hand that was next after `removed` in the pre-dismiss list.
  const before = [...hands].sort((a, b) => {
    const ta = Date.parse(a.raisedAt) || 0;
    const tb = Date.parse(b.raisedAt) || 0;
    if (ta !== tb) return ta - tb;
    return a.sessionId.localeCompare(b.sessionId);
  });
  const allIds = before.map((h) => h.sessionId);
  const ri = allIds.indexOf(removed);
  if (ri >= 0) {
    for (let step = 1; step < allIds.length; step++) {
      const cand = allIds[(ri + step) % allIds.length];
      if (cand !== removed && ids.includes(cand)) return cand;
    }
  }
  return ids[0];
}

export function readTriageFocus(): string | null {
  try {
    if (!existsSync(TRIAGE_PATH)) return null;
    const raw = JSON.parse(readFileSync(TRIAGE_PATH, "utf-8")) as {
      sessionId?: unknown;
    };
    return typeof raw.sessionId === "string" && raw.sessionId.trim()
      ? raw.sessionId
      : null;
  } catch {
    return null;
  }
}

export function writeTriageFocus(sessionId: string): void {
  const payload = JSON.stringify(
    { sessionId, updatedAt: new Date().toISOString() },
    null,
    2
  ) + "\n";
  const tmp = `${TRIAGE_PATH}.tmp.${process.pid}`;
  writeFileSync(tmp, payload);
  renameSync(tmp, TRIAGE_PATH);
}

export function clearTriageFocus(): void {
  try {
    if (existsSync(TRIAGE_PATH)) unlinkSync(TRIAGE_PATH);
  } catch {
    /* already gone */
  }
}
