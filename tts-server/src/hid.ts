import { readFileSync, existsSync, readdirSync, renameSync, writeFileSync } from "fs";
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
  loadSessionVoices,
  effectivePlaybackMode,
  type ArcadeButton,
  type ArcadeButtons,
} from "./config.js";
import { getCharacter } from "./dynamic-response.js";
import { log } from "./logger.js";
import { loadTeamMap } from "./team-map.js";
import { runStatusSay } from "./status-say.js";

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
// deterministic across runs (so learn mode's mapping stays valid), and stick /
// axis noise just produces indices that no button is mapped to → ignored.
type Edge = "down" | "up";

// Analog axis bytes jitter constantly at idle (127↔128↔129 ADC noise on the
// DragonRise encoders), which XOR-diffing would read as phantom button edges.
// So every differ starts with a calibration window: any bit that changes while
// the device should be untouched is marked noise and masked forever after.
const CALIBRATION_MS = 1500;

function makeDiffer(
  onCalibrated?: (noisyCount: number) => void
): (buf: Buffer, emit: (edge: Edge, idx: number) => void) => void {
  let prev: Buffer | null = null;
  let calibrateUntil = 0;
  let calibrated = false;
  const noise = new Set<number>();
  return (buf, emit) => {
    const now = Date.now();
    if (!prev) {
      prev = Buffer.from(buf);
      calibrateUntil = now + CALIBRATION_MS;
      return;
    }
    if (!calibrated && now >= calibrateUntil) {
      calibrated = true;
      onCalibrated?.(noise.size);
    }
    const len = Math.max(prev.length, buf.length);
    for (let byte = 0; byte < len; byte++) {
      const a = prev[byte] ?? 0;
      const b = buf[byte] ?? 0;
      let changed = a ^ b;
      if (!changed) continue;
      for (let bit = 0; bit < 8; bit++) {
        const mask = 1 << bit;
        if (changed & mask) {
          const idx = byte * 8 + bit;
          if (!calibrated) noise.add(idx);
          else if (!noise.has(idx)) emit(b & mask ? "down" : "up", idx);
        }
      }
    }
    prev = Buffer.from(buf);
  };
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

const MODE_CYCLE: Record<string, string> = {
  auto: "announce",
  announce: "silent",
  silent: "auto",
};

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
  if (btn?.character) characterHold(btn.character, "start");
}

function handleHoldEnd(idx: number): void {
  const btn = buttonFor(idx);
  if (!btn) return;
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

function onEdge(edge: Edge, idx: number): void {
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
    // Reset baseline + recalibrate noise mask so the first report doesn't fire.
    differ = makeDiffer((n) => log("hid", `calibrated — masked ${n} noisy bit(s)`));
    d.on("data", (buf: Buffer) => safe(() => differ(buf, onEdge)));
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
// bindings. No wiring assumptions — this is how the map gets written.
interface LearnSpec {
  name: string;
  def: Omit<ArcadeButton, "name">;
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

const LEARN_TIMEOUT_MS = 30_000;

function writeArcadeButtons(cfg: ArcadeButtons): void {
  const tmp = `${ARCADE_BUTTONS_PATH}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(cfg, null, 2) + "\n");
  renameSync(tmp, ARCADE_BUTTONS_PATH);
}

async function learn(): Promise<void> {
  const hint = loadArcadeButtons().device_hint;
  const path = findDevicePath(hint);
  if (!path) {
    console.error(
      `No encoder found matching "${hint}". Plug it in and try again.`
    );
    process.exit(1);
  }

  const d = new HID(path);
  let calibrated = false;
  const ldiff = makeDiffer((noisy) => {
    calibrated = true;
    console.log(`calibrated — masked ${noisy} noisy axis bit(s). Ready!\n`);
  });
  let onDown: ((idx: number) => void) | null = null;
  d.on("error", (err: any) => {
    console.error(`Device error: ${err?.message ?? err}`);
    process.exit(1);
  });
  d.on("data", (buf: Buffer) => {
    try {
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

  const waitButton = (name: string): Promise<number | null> =>
    new Promise((resolve) => {
      let done = false;
      process.stdout.write(
        `Press the ${name.toUpperCase()} button now (or 's' + Enter to skip)... `
      );
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

  console.log("Learn mode — map each physical button to its HID index.");
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
  // `learn <name>` = single-button mode: add/remap ONE button, preserving the
  // rest of the existing mapping. Known names keep their standard role; new
  // names default to opening the Room panel.
  const only = process.argv[3]?.trim().toLowerCase();
  let buttons: Record<string, ArcadeButton> = {};
  let order: LearnSpec[] = LEARN_ORDER;
  if (only) {
    buttons = { ...loadArcadeButtons().buttons };
    const known = LEARN_ORDER.find((s) => s.name === only);
    order = [known ?? { name: only, def: { action: "panel" } }];
    // Drop any existing index bound to this name — it's being remapped.
    for (const [idx, b] of Object.entries(buttons)) {
      if (b.name === only) delete buttons[idx];
    }
  }
  for (const spec of order) {
    const idx = await waitButton(spec.name);
    if (idx == null) continue;
    if (buttons[String(idx)]) {
      console.log(
        `  (index ${idx} already mapped to "${buttons[String(idx)].name}" — overwriting with "${spec.name}")`
      );
    }
    buttons[String(idx)] = { name: spec.name, ...spec.def };
  }

  const cfg: ArcadeButtons = {
    device_hint: hint || DEFAULT_DEVICE_HINT,
    buttons,
  };
  writeArcadeButtons(cfg);
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
    console.error("Usage: tsx src/hid.ts learn");
    process.exit(1);
  }
}
