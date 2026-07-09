import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { spawn } from "child_process";
import { pathToFileURL } from "url";
import { createInterface } from "readline";
import { devices, HID } from "node-hid";
import {
  TTS_DIR,
  STATE_DIR,
  ARCADE_BUTTONS_PATH,
  DEFAULT_DEVICE_HINT,
  loadArcadeButtons,
  loadConfig,
  saveArcadeButtons,
  loadSessionVoices,
  effectivePlaybackMode,
  type ArcadeButton,
  type ArcadeButtons,
  type StickDirection,
  type StickMapping,
  type StickPole,
} from "./config.js";
import { getCharacter } from "./dynamic-response.js";
import { log } from "./logger.js";
import { loadTeamMap } from "./team-map.js";
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

const SCRIPTS_DIR = join(TTS_DIR, "scripts");
const SERVER_DIR = join(TTS_DIR, "tts-server");

// A press held this long or longer is a hold (PTT), not a tap (grant).
const HOLD_MS = 500;
// Reconnect poll: one cheap enumerate every 3s while the device is closed.
const RECONNECT_MS = 3000;

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
type Edge = "down" | "up";

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
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1]! + sorted[mid]!) / 2)
    : sorted[mid]!;
}

function makeDiffer(onCalibrated?: (noisyCount: number) => void): Differ {
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
const STICK_REARM_LO = 96;
const STICK_REARM_HI = 160;
const STICK_LEARN_MIN_DEV = 48;
const STICK_LEARN_SAMPLE_MS = 1200;

export function evaluateStickAxis(
  prev: StickArmState,
  value: number,
  pole: StickPole
): { fire: boolean; state: StickArmState } {
  if (prev === "armed") {
    const crossed =
      pole === "low" ? value < STICK_FIRE_LOW : value > STICK_FIRE_HIGH;
    if (crossed) return { fire: true, state: "fired" };
    return { fire: false, state: "armed" };
  }
  // fired → re-arm in dead zone
  if (value >= STICK_REARM_LO && value <= STICK_REARM_HI) {
    return { fire: false, state: "armed" };
  }
  return { fire: false, state: "fired" };
}

// ── Failure isolation ─────────────────────────────────────────────
// Every handler runs through this: a throwing button handler logs and dies
// quietly, it never propagates out to crash the shared tts-server daemon.
function safe(fn: () => void): void {
  try {
    fn();
  } catch (err: any) {
    log("hid", `handler error: ${err?.message ?? err}`);
  }
}

// ── Spawning (non-blocking; the daemon must not stall on a button) ─
function runScript(name: string, args: string[]): void {
  try {
    const child = spawn(join(SCRIPTS_DIR, name), args, { stdio: "ignore" });
    child.on("error", (e) => log("hid", `${name} spawn error: ${e.message}`));
  } catch (err: any) {
    log("hid", `${name} spawn failed: ${err?.message ?? err}`);
  }
}

function runSignalReplay(): void {
  try {
    const child = spawn(
      "pnpm",
      ["exec", "tsx", "src/signal.ts", "replay", "", "1"],
      { cwd: SERVER_DIR, stdio: "ignore" }
    );
    child.on("error", (e) => log("hid", `signal replay spawn error: ${e.message}`));
  } catch (err: any) {
    log("hid", `signal replay spawn failed: ${err?.message ?? err}`);
  }
}

// ── Character → session resolution ────────────────────────────────
// Reverse of press-time lookup: character name → voiceId (via characters.json)
// → the session wearing that voice (session_voices.json). Newest active
// session wins; a team_map.json persona whose name matches wins ties.
interface StateSnapshot {
  state?: string;
  updatedAt?: string;
  raisedAt?: string;
}

function readState(sessionId: string): StateSnapshot | null {
  try {
    const p = join(STATE_DIR, `${sessionId}.json`);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf-8")) as StateSnapshot;
  } catch {
    return null;
  }
}

function resolveCharacterSession(character: string): string | null {
  const want = character.trim().toLowerCase();
  if (!want) return null;

  // Sessions whose assigned voice belongs to this character.
  const candidates: string[] = [];
  for (const [sessionId, voiceId] of Object.entries(loadSessionVoices())) {
    const char = getCharacter(voiceId);
    if (char && char.name.trim().toLowerCase() === want) candidates.push(sessionId);
  }
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  // Team-map persona wins ties: if a persona keyed by this character name pins
  // a sessionId that is one of the candidates, prefer it.
  const team = loadTeamMap();
  const teamEntry = team[want];
  if (teamEntry?.sessionId && candidates.includes(teamEntry.sessionId)) {
    return teamEntry.sessionId;
  }

  // Otherwise newest active session — most recently updated state file wins.
  let best: string | null = null;
  let bestT = -1;
  for (const sid of candidates) {
    const st = readState(sid);
    if (!st) continue;
    const t = st.updatedAt ? Date.parse(st.updatedAt) : 0;
    if (t >= bestT) {
      bestT = t;
      best = sid;
    }
  }
  return best ?? candidates[0];
}

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
const stickArmState = new Map<StickDirection, StickArmState>();
/** Axis bytes currently mapped in sticks — excluded from bit-edge button emit. */
const mappedAxisBytes = new Set<number>();

function refreshMappedAxisBytes(): void {
  mappedAxisBytes.clear();
  const sticks = loadArcadeButtons().sticks;
  if (!sticks) return;
  for (const m of Object.values(sticks)) {
    if (m) mappedAxisBytes.add(m.byte);
  }
}

function onReportAxes(buf: Buffer): void {
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

const MODE_CYCLE: Record<string, string> = {
  auto: "announce",
  announce: "silent",
  silent: "auto",
};

// Valid `action` / `hold_action` values for arcade_buttons.json (panel UI lists these).
export const HID_ACTIONS = [
  "grant_next",
  "replay",
  "stop",
  "pause",
  "panel",
  "cycle_mode",
  "toggle_mode",
  "hold_room",
] as const;

export type HidAction = (typeof HID_ACTIONS)[number];

function doAction(action: string): void {
  switch (action) {
    case "grant_next":
      runScript("grant_floor.sh", []);
      return;
    case "replay":
      runSignalReplay();
      return;
    case "stop":
      runScript("stop.sh", []);
      return;
    case "pause":
      runScript("pause.sh", []); // SIGSTOP/SIGCONT toggle — tap to pause, tap to resume
      return;
    case "panel":
      runScript("panel.sh", []); // open/focus the Room widget
      return;
    case "cycle_mode":
    case "toggle_mode": {
      const next = MODE_CYCLE[effectivePlaybackMode()] ?? "auto";
      runScript("set_playback_mode.sh", [next]);
      return;
    }
    case "hold_room": {
      // Toggle: hold if free, release if already held.
      const held = existsSync(join(TTS_DIR, ".hold-room.json"));
      runScript("hold_room.sh", held ? ["off"] : []);
      return;
    }
    default:
      log("hid", `unknown action: ${action}`);
  }
}

function characterPress(character: string): void {
  const sid = resolveCharacterSession(character);
  if (!sid) {
    log("hid", `no active session wearing ${character}'s voice — press ignored`);
    return;
  }
  // Already talking → the tap means "I heard enough": duck it instead of
  // re-granting the floor (design doc's ducking rule).
  if (readState(sid)?.state === "speaking") {
    log("hid", `${character} (${sid.slice(0, 12)}) speaking → stop`);
    runScript("stop.sh", []);
  } else {
    log("hid", `grant floor → ${character} (${sid.slice(0, 12)})`);
    runScript("grant_floor.sh", [sid]);
  }
}

function characterHold(character: string, phase: "start" | "stop"): void {
  const sid = resolveCharacterSession(character);
  if (!sid) {
    log("hid", `no active session wearing ${character}'s voice — PTT ${phase} ignored`);
    return;
  }
  // Hold-to-talk means INJECTION, which only works for team.sh (tmux) sessions.
  // Fail fast with a friendly spoken error — never start recording toward a
  // session we can't reach, and never speak a raw sessionId aloud.
  const team = loadTeamMap();
  const inTeam = Object.values(team).some((e) => e?.sessionId === sid);
  if (!inTeam) {
    if (phase === "start") {
      log("hid", `PTT to ${character} refused — session not in team_map`);
      try {
        const child = spawn("say", [
          `${character} isn't in the team room yet. Launch them with team dot S H first.`,
        ], { stdio: "ignore" });
        child.on("error", () => {});
      } catch {}
    }
    return;
  }
  log("hid", `PTT ${phase} → ${character} (${sid.slice(0, 12)})`);
  runScript("ptt.sh", [phase, sid]);
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
  return loadConfig().arcade_enabled && device !== null;
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

function onEdge(edge: Edge, idx: number): void {
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

function clearPending(): void {
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

// ── Device discovery / open / reconnect ───────────────────────────
function findDevicePath(hint: string): string | null {
  const hints = (hint || DEFAULT_DEVICE_HINT)
    .toLowerCase()
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
  let list;
  try {
    list = devices();
  } catch (err: any) {
    log("hid", `devices() failed: ${err?.message ?? err}`);
    return null;
  }
  for (const d of list) {
    const hay = `${d.product ?? ""} ${d.manufacturer ?? ""}`.toLowerCase();
    if (hints.some((h) => hay.includes(h))) return d.path ?? null;
  }
  return null;
}

let device: HID | null = null;
let scheduler: ReturnType<typeof setInterval> | null = null;
let differ = makeDiffer();

function openDevice(): void {
  if (device) return;
  const path = findDevicePath(loadArcadeButtons().device_hint);
  if (!path) return; // unplugged → silent no-op; the scheduler retries
  try {
    const d = new HID(path);
    refreshMappedAxisBytes();
    // Reset baseline + recalibrate noise mask so the first report doesn't fire.
    differ = makeDiffer((n) => log("hid", `calibrated — masked ${n} noisy bit(s)`));
    stickArmState.clear();
    d.on("data", (buf: Buffer) =>
      safe(() => {
        differ(buf, onEdge);
        if (differ.isCalibrated()) onReportAxes(buf);
      })
    );
    d.on("error", (err: any) => {
      log("hid", `device error: ${err?.message ?? err}`);
      closeDevice(); // reconnect is the scheduler's job — never a timer here
    });
    device = d;
    log("hid", `opened encoder at ${path}`);
  } catch (err: any) {
    log("hid", `open failed: ${err?.message ?? err}`);
  }
}

function closeDevice(): void {
  const d = device;
  device = null;
  clearPending();
  if (!d) return;
  try {
    d.close();
  } catch {
    /* already gone */
  }
}

export function startHid(): void {
  if (scheduler) return; // idempotent
  openDevice();
  // ONE persistent scheduler, installed once; no-ops while the device is open.
  // Error/close handlers never install timers, so intervals can't stack.
  scheduler = setInterval(() => {
    if (!device) safe(openDevice);
  }, RECONNECT_MS);
  log("hid", `started (reconnect poll ${RECONNECT_MS}ms)`);
}

export function stopHid(): void {
  if (scheduler) {
    clearInterval(scheduler);
    scheduler = null;
  }
  closeDevice();
}

// ── Learn mode ────────────────────────────────────────────────────
// Walk the physical buttons in a fixed order, record the HID index of the next
// button each one fires, and write arcade_buttons.json with sensible default
// bindings. Stick dirs are learned separately via hold-sample on axis bytes.
interface LearnSpec {
  name: string;
  def: Omit<ArcadeButton, "name">;
  prompt?: string;
}

const LEARN_ORDER: LearnSpec[] = [
  { name: "white", def: { action: "grant_next" } },
  { name: "blue", def: { character: "leonardo" } },
  { name: "red", def: { character: "raphael" } },
  { name: "teal", def: { character: "donatello" } },
  { name: "yellow", def: { character: "michelangelo" } },
  { name: "1p", def: { action: "replay" } },
  { name: "2p", def: { action: "stop" } },
  { name: "coin", def: { action: "cycle_mode", hold_action: "hold_room" } },
];

const STICK_DIRS: StickDirection[] = ["left", "right", "up", "down"];

function stickDirFromLearnName(name: string): StickDirection | null {
  const m = /^stick_(left|right|up|down)$/.exec(name);
  return m ? (m[1] as StickDirection) : null;
}

const LEARN_TIMEOUT_MS = 30_000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function learn(): Promise<void> {
  const existing = loadArcadeButtons();
  const hint = existing.device_hint;
  const path = findDevicePath(hint);
  if (!path) {
    console.error(
      `No encoder found matching "${hint}". Plug it in and try again.`
    );
    process.exit(1);
  }

  let d: HID;
  try {
    d = new HID(path);
  } catch (err: any) {
    console.error(`Cannot open the encoder (${err?.message ?? err}).`);
    console.error(
      "Most likely the tts-server daemon has it open (arcade_enabled=true)."
    );
    console.error("Stop it, learn, then restart:");
    console.error("  ~/.cursor/tts/scripts/tts-server.sh stop");
    console.error("  pnpm exec tsx src/hid.ts learn ...");
    console.error("  ~/.cursor/tts/scripts/tts-server.sh start");
    console.error(
      "(Or capture through the Room panel: Settings > Buttons > input-code chip — that path works while the daemon runs.)"
    );
    process.exit(1);
  }

  let latestBuf: Buffer | null = null;
  let calibrated = false;
  const ldiff = makeDiffer((noisy) => {
    calibrated = true;
    console.log(`calibrated — masked ${noisy} noisy axis bit(s). Ready!\n`);
  });
  // During learn, skip runtime stick dispatch (mappedAxisBytes may be stale /
  // empty); we only want bit-edges for buttons + raw buffers for stick sample.
  mappedAxisBytes.clear();
  let onDown: ((idx: number) => void) | null = null;
  d.on("error", (err: any) => {
    console.error(`Device error: ${err?.message ?? err}`);
    process.exit(1);
  });
  d.on("data", (buf: Buffer) => {
    try {
      latestBuf = Buffer.from(buf);
      ldiff(buf, (edge, idx) => {
        if (edge === "down" && onDown) {
          const cb = onDown;
          onDown = null;
          cb(idx);
        }
      });
    } catch {
      /* ignore malformed report during learn */
    }
  });

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  const waitButton = (spec: LearnSpec): Promise<number | null> =>
    new Promise((resolve) => {
      let done = false;
      const label = `Press the ${spec.name.toUpperCase()} button now (or 's' + Enter to skip)... `;
      process.stdout.write(label);
      const finish = (v: number | null) => {
        if (done) return;
        done = true;
        clearTimeout(to);
        rl.off("line", onLine);
        onDown = null;
        resolve(v);
      };
      const to = setTimeout(() => {
        process.stdout.write("(timeout, skipped)\n");
        finish(null);
      }, LEARN_TIMEOUT_MS);
      const onLine = (line: string) => {
        if (line.trim().toLowerCase() === "s") {
          process.stdout.write("(skipped)\n");
          finish(null);
        }
      };
      rl.on("line", onLine);
      onDown = (idx) => {
        process.stdout.write(`recorded index ${idx}\n`);
        finish(idx);
      };
    });

  async function learnStickDir(dir: StickDirection): Promise<StickMapping | null> {
    const dirLabel = dir.toUpperCase();

    const attempt = async (retry: boolean): Promise<StickMapping | "skip" | null> => {
      const prompt = retry
        ? `Not enough deflection — push the stick ${dirLabel} and HOLD it (or 's' + Enter to skip)... `
        : `push the stick ${dirLabel} and HOLD it (or 's' + Enter to skip)... `;

      let skipped = false;
      const onLine = (line: string) => {
        if (line.trim().toLowerCase() === "s") skipped = true;
      };
      rl.on("line", onLine);
      process.stdout.write(prompt);

      const baselines = ldiff.axisBaselines();
      // Digital (microswitch) sticks idle rock-steady, so calibration never
      // flags their axis bytes as candidates — sample EVERY byte instead,
      // baselined from the pre-push report (a 127 default would false-positive
      // on bytes that legitimately idle elsewhere, e.g. the hat at 0x0f).
      const baseSnapshot = latestBuf ? Buffer.from(latestBuf) : null;
      const start = Date.now();
      const peakAbs = new Map<number, number>();
      const peakSigned = new Map<number, number>();

      while (Date.now() - start < STICK_LEARN_SAMPLE_MS) {
        if (skipped) break;
        await sleep(20);
        if (!latestBuf) continue;
        const bytes = [...Array(latestBuf.length).keys()];
        for (const byte of bytes) {
          const base = baselines.get(byte) ?? baseSnapshot?.[byte] ?? 127;
          const v = latestBuf[byte] ?? base;
          const signed = v - base;
          const abs = Math.abs(signed);
          if (abs >= (peakAbs.get(byte) ?? 0)) {
            peakAbs.set(byte, abs);
            peakSigned.set(byte, signed);
          }
        }
      }
      rl.off("line", onLine);
      if (skipped) {
        process.stdout.write("(skipped)\n");
        return "skip";
      }

      let bestByte = -1;
      let bestAbs = 0;
      let bestSigned = 0;
      for (const [byte, abs] of peakAbs) {
        if (abs > bestAbs) {
          bestAbs = abs;
          bestByte = byte;
          bestSigned = peakSigned.get(byte) ?? 0;
        }
      }
      if (bestByte < 0 || bestAbs < STICK_LEARN_MIN_DEV) return null;
      const pole: StickPole = bestSigned < 0 ? "low" : "high";
      process.stdout.write(
        `recorded stick ${dir} → byte ${bestByte} pole ${pole} (dev ${bestSigned})\n`
      );
      return { byte: bestByte, pole };
    };

    let result = await attempt(false);
    if (result === "skip") return null;
    if (!result) {
      result = await attempt(true);
      if (result === "skip" || !result) {
        if (result !== "skip") process.stdout.write("(skipped — still too weak)\n");
        return null;
      }
    }

    // Release gate: wait until axis returns near center so the next prompt
    // doesn't see leftover deflection.
    process.stdout.write("...release the stick and wait for center... ");
    const baselines = ldiff.axisBaselines();
    const releaseDeadline = Date.now() + LEARN_TIMEOUT_MS;
    while (Date.now() < releaseDeadline) {
      await sleep(40);
      if (!latestBuf) continue;
      const v = latestBuf[result.byte] ?? 127;
      const base = baselines.get(result.byte) ?? 127; // release gate tolerates either idle model via the REARM window below
      if (
        Math.abs(v - base) < 20 ||
        (v >= STICK_REARM_LO && v <= STICK_REARM_HI)
      ) {
        process.stdout.write("ok\n");
        return result;
      }
    }
    process.stdout.write("(timeout, continuing)\n");
    return result;
  }

  console.log("Learn mode — map each physical button / stick direction.");
  console.log("Calibrating: DON'T touch the buttons or joystick for 2 seconds...");
  await new Promise<void>((resolve) => {
    const poll = setInterval(() => {
      if (calibrated) {
        clearInterval(poll);
        resolve();
      }
    }, 100);
    // If the device streams no reports at idle there's nothing to calibrate.
    setTimeout(() => {
      clearInterval(poll);
      resolve();
    }, 4000);
  });

  // `learn <name>` = single-button / single-stick mode.
  const only = process.argv[3]?.trim().toLowerCase();
  let buttons: Record<string, ArcadeButton> = {};
  let sticks: Partial<Record<StickDirection, StickMapping>> = {
    ...(existing.sticks ?? {}),
  };
  let buttonOrder: LearnSpec[] = LEARN_ORDER;
  let stickOrder: StickDirection[] = STICK_DIRS;

  if (only) {
    const stickDir = stickDirFromLearnName(only);
    if (stickDir) {
      buttonOrder = [];
      stickOrder = [stickDir];
      buttons = { ...existing.buttons };
      delete sticks[stickDir];
    } else {
      stickOrder = [];
      buttons = { ...existing.buttons };
      const known = LEARN_ORDER.find((s) => s.name === only);
      buttonOrder = [known ?? { name: only, def: { action: "panel" } }];
      for (const [idx, b] of Object.entries(buttons)) {
        if (b.name === only) delete buttons[idx];
      }
    }
  } else {
    console.log("\n── Buttons ──");
    sticks = {}; // full learn rewrites sticks from scratch
  }

  for (const spec of buttonOrder) {
    const idx = await waitButton(spec);
    if (idx == null) continue;
    if (buttons[String(idx)]) {
      console.log(
        `  (index ${idx} already mapped to "${buttons[String(idx)].name}" — overwriting with "${spec.name}")`
      );
    }
    buttons[String(idx)] = {
      ...(buttons[String(idx)] ?? {}),
      name: spec.name,
      ...spec.def,
    };
  }

  if (stickOrder.length > 0) {
    if (!only) console.log("\n── Stick ──");
    for (const dir of stickOrder) {
      const mapping = await learnStickDir(dir);
      if (mapping) sticks[dir] = mapping;
    }
  }

  const cfg: ArcadeButtons = {
    device_hint: hint || DEFAULT_DEVICE_HINT,
    buttons,
    ...(Object.keys(sticks).length > 0 ? { sticks } : {}),
  };
  saveArcadeButtons(cfg);
  console.log(`\nWrote ${ARCADE_BUTTONS_PATH}`);
  console.log(JSON.stringify(cfg, null, 2));

  rl.close();
  try {
    d.close();
  } catch {
    /* ignore */
  }
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === "learn") {
    learn().catch((err) => {
      console.error(err?.message ?? err);
      process.exit(1);
    });
  } else {
    console.error("Usage: tsx src/hid.ts learn [name]");
    process.exit(1);
  }
}
