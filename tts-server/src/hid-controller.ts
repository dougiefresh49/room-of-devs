import { existsSync, readdirSync } from "fs";
import {
  STATE_DIR,
  loadArcadeButtons,
  loadConfig,
  type ArcadeButton,
  type StickDirection,
} from "./config.js";
import { log } from "./logger.js";
import { runStatusSay } from "./status-say.js";
import {
  TRIAGE_IDLE_MS,
  clearTriageFocus,
  focusAfterDismiss,
  nextTriageFocus,
  readTriageFocus,
  writeTriageFocus,
  type HandEntry,
} from "./triage.js";
import {
  type Edge,
  type StickArmState,
  mappedAxisBytes,
  evaluateStickAxis,
} from "./hid-report.js";
import {
  safe,
  runScript,
  readState,
  resolveCharacterSession,
  doAction,
  characterPress,
  characterHold,
} from "./hid-actions.js";
import { deviceRef } from "./hid-device.js";

// A press held this long or longer is a hold (PTT), not a tap (grant).
const HOLD_MS = 500;

// ── Dispatch ──────────────────────────────────────────────────────
function buttonFor(idx: number): ArcadeButton | null {
  const cfg = loadArcadeButtons();
  return cfg.buttons[String(idx)] ?? null;
}

function isGrantNextButton(btn: ArcadeButton | null): boolean {
  return !!btn && (btn.action === "grant_next" || btn.name === "white");
}

// White (grant_next) held → stick flicks snap the panel instead of triage.
// If a stick flick happens during the hold, suppress the white button's own
// press/hold action on release; a plain tap still grants.
let whitePhysicallyDown = false;
let whiteStickUsed = false;

const STICK_COOLDOWN_MS = 200;
const stickCooldownUntil = new Map<StickDirection, number>();
export const stickArmState = new Map<StickDirection, StickArmState>();

export function refreshMappedAxisBytes(): void {
  mappedAxisBytes.clear();
  const sticks = loadArcadeButtons().sticks;
  if (!sticks) return;
  for (const m of Object.values(sticks)) {
    if (m) mappedAxisBytes.add(m.byte);
  }
}

export function onReportAxes(buf: Buffer): void {
  refreshMappedAxisBytes();
  const sticks = loadArcadeButtons().sticks;
  if (!sticks) return;
  for (const dir of ["left", "right", "up", "down"] as const) {
    const m = sticks[dir];
    if (!m) continue;
    const value = buf[m.byte] ?? 127;
    const prev = stickArmState.get(dir) ?? "armed";
    const { fire, state } = evaluateStickAxis(prev, value, m.pole);
    stickArmState.set(dir, state);
    if (fire) safe(() => handleStick(dir));
  }
}

let triageIdleTimer: ReturnType<typeof setTimeout> | null = null;

function bumpTriageIdle(): void {
  if (triageIdleTimer) clearTimeout(triageIdleTimer);
  triageIdleTimer = setTimeout(() => {
    triageIdleTimer = null;
    clearTriageFocus();
  }, TRIAGE_IDLE_MS);
}

function listRaisedHands(): HandEntry[] {
  const hands: HandEntry[] = [];
  try {
    if (!existsSync(STATE_DIR)) return hands;
    for (const f of readdirSync(STATE_DIR)) {
      if (!f.endsWith(".json")) continue;
      const sessionId = f.slice(0, -5);
      const st = readState(sessionId);
      if (!st || st.state !== "hand_raised") continue;
      const raisedAt = st.raisedAt ?? st.updatedAt ?? "";
      hands.push({ sessionId, raisedAt });
    }
  } catch (err: any) {
    log("hid", `listRaisedHands failed: ${err?.message ?? err}`);
  }
  return hands;
}

const SNAP_CORNER: Record<StickDirection, "bl" | "br" | "tr" | "bc"> = {
  left: "bl",
  right: "br",
  up: "tr",
  down: "bc",
};

function handleStick(dir: StickDirection): void {
  const now = Date.now();
  const until = stickCooldownUntil.get(dir) ?? 0;
  if (now < until) return;
  stickCooldownUntil.set(dir, now + STICK_COOLDOWN_MS);

  if (whitePhysicallyDown) {
    whiteStickUsed = true;
    // Dynamic import avoids a circular init with panel-ws (which imports hid).
    void import("./panel-ws.js")
      .then((m) => m.broadcastPanel({ type: "snap", corner: SNAP_CORNER[dir] }))
      .catch(() => {});
    log("hid", `stick ${dir} → snap ${SNAP_CORNER[dir]}`);
    return;
  }

  const hands = listRaisedHands();
  if (dir === "left" || dir === "right") {
    if (hands.length === 0) return;
    const next = nextTriageFocus(hands, readTriageFocus(), dir);
    if (!next) return;
    writeTriageFocus(next);
    bumpTriageIdle();
    log("hid", `triage focus → ${next.slice(0, 12)} (${dir})`);
    return;
  }

  const focus = readTriageFocus();
  if (!focus) {
    log("hid", `stick ${dir} ignored — no triage focus`);
    return;
  }

  if (dir === "down") {
    log("hid", `triage grant → ${focus.slice(0, 12)}`);
    runScript("grant_floor.sh", [focus]);
    clearTriageFocus();
    if (triageIdleTimer) {
      clearTimeout(triageIdleTimer);
      triageIdleTimer = null;
    }
    return;
  }

  // up = dismiss focused hand, advance to next if any
  log("hid", `triage dismiss → ${focus.slice(0, 12)}`);
  runScript("clear_session_queue.sh", [focus]);
  const next = focusAfterDismiss(hands, focus);
  if (next) {
    writeTriageFocus(next);
    bumpTriageIdle();
  } else {
    clearTriageFocus();
    if (triageIdleTimer) {
      clearTimeout(triageIdleTimer);
      triageIdleTimer = null;
    }
  }
}

function handlePress(idx: number): void {
  const btn = buttonFor(idx);
  if (!btn) return;
  if (isGrantNextButton(btn) && whiteStickUsed) {
    whiteStickUsed = false;
    return; // stick flick during hold → suppress grant
  }
  if (btn.character) {
    if (noteTripleTap(idx)) {
      tapTimes.delete(idx);
      const sid = resolveCharacterSession(btn.character);
      if (sid) {
        log("hid", `triple-tap status → ${btn.character} (${sid.slice(0, 12)})`);
        runStatusSay(sid);
        return;
      }
    }
    characterPress(btn.character);
  } else if (btn.action) doAction(btn.action);
}

function handleHoldStart(idx: number): void {
  const btn = buttonFor(idx);
  if (!btn) return;
  if (isGrantNextButton(btn) && whiteStickUsed) return;
  if (btn.character) characterHold(btn.character, "start");
}

function handleHoldEnd(idx: number): void {
  const btn = buttonFor(idx);
  if (!btn) return;
  if (isGrantNextButton(btn) && whiteStickUsed) {
    whiteStickUsed = false;
    return;
  }
  // Character buttons close the PTT capture. Action buttons fire their
  // hold_action when one is configured (e.g. tap 2P = pause, hold 2P = stop);
  // otherwise a long press still fires the tap action on release.
  if (btn.character) characterHold(btn.character, "stop");
  else if (btn.hold_action) doAction(btn.hold_action);
  else if (btn.action) doAction(btn.action);
}

// ── Press / hold detection ────────────────────────────────────────
const TRIPLE_WINDOW_MS = 900;
const tapTimes = new Map<number, number[]>();

function noteTripleTap(idx: number): boolean {
  const now = Date.now();
  const prev = (tapTimes.get(idx) ?? []).filter((t) => now - t < TRIPLE_WINDOW_MS);
  prev.push(now);
  tapTimes.set(idx, prev);
  return prev.length >= 3;
}

interface Pending {
  timer: ReturnType<typeof setTimeout>;
  holding: boolean;
}
const pending = new Map<number, Pending>();

// Learn-capture bridge (panel-ws): one-shot arm; non-noise DOWN resolves.
let captureArmed: {
  resolve: (idx: number) => void;
  timer: ReturnType<typeof setTimeout>;
} | null = null;
const suppressPress = new Set<number>();

export function isCaptureReady(): boolean {
  return loadConfig().arcade_enabled && deviceRef.current !== null;
}

export function captureNextPress(timeoutMs = 15_000): Promise<number | null> {
  if (!isCaptureReady()) return Promise.resolve(null);
  if (captureArmed) {
    clearTimeout(captureArmed.timer);
    captureArmed.resolve = () => {};
    captureArmed = null;
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      captureArmed = null;
      resolve(null);
    }, timeoutMs);
    captureArmed = {
      timer,
      resolve: (idx) => {
        clearTimeout(timer);
        captureArmed = null;
        resolve(idx);
      },
    };
  });
}

export function onEdge(edge: Edge, idx: number): void {
  if (edge === "down" && captureArmed) {
    const armed = captureArmed;
    captureArmed = null;
    clearTimeout(armed.timer);
    suppressPress.add(idx);
    armed.resolve(idx);
    return;
  }
  if (suppressPress.has(idx)) {
    if (edge === "up") suppressPress.delete(idx);
    return;
  }

  const btn = buttonFor(idx);

  // Track white / grant_next physical hold for stick-modifier corner snap.
  if (isGrantNextButton(btn)) {
    if (edge === "down") {
      whitePhysicallyDown = true;
      whiteStickUsed = false;
    } else {
      whitePhysicallyDown = false;
    }
  }

  if (edge === "down") {
    if (pending.has(idx)) return; // ignore repeat-downs for a held button
    const p: Pending = {
      holding: false,
      timer: setTimeout(() => {
        p.holding = true;
        safe(() => handleHoldStart(idx));
      }, HOLD_MS),
    };
    pending.set(idx, p);
  } else {
    const p = pending.get(idx);
    if (!p) return;
    clearTimeout(p.timer);
    pending.delete(idx);
    if (p.holding) safe(() => handleHoldEnd(idx));
    else safe(() => handlePress(idx));
  }
}

export function clearPending(): void {
  for (const p of pending.values()) clearTimeout(p.timer);
  pending.clear();
  suppressPress.clear();
  whitePhysicallyDown = false;
  whiteStickUsed = false;
  stickArmState.clear();
  if (triageIdleTimer) {
    clearTimeout(triageIdleTimer);
    triageIdleTimer = null;
  }
  if (captureArmed) {
    clearTimeout(captureArmed.timer);
    captureArmed = null;
  }
}
