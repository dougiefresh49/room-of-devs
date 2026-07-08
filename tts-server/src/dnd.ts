import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { spawnSync } from "child_process";
import { TTS_DIR, loadConfig } from "./config.js";
import { log } from "./logger.js";

const SCRIPTS_DIR = join(TTS_DIR, "scripts");
const HOLD_FILE = join(TTS_DIR, ".hold-room.json");
const POLL_MS = 15_000;
const RECENT_ACTIVE_MS = 60_000;

const DEFAULT_DND_APPS = [
  "zoom.us",
  "FaceTime",
  "Microsoft Teams",
  "Webex",
];

export interface HoldInfo {
  active: boolean;
  source?: string;
}

export type DndAction = "hold" | "release" | "noop";

/** Pure decision: given meeting-app signal + hold state → action. */
export function decideDndAction(
  meetingActive: boolean,
  hold: HoldInfo
): DndAction {
  if (meetingActive) {
    if (!hold.active) return "hold";
    return "noop";
  }
  if (hold.active && hold.source === "dnd") return "release";
  return "noop";
}

export function readHoldInfo(): HoldInfo {
  try {
    if (!existsSync(HOLD_FILE)) return { active: false };
    const data = JSON.parse(readFileSync(HOLD_FILE, "utf-8")) as {
      source?: string;
    };
    return { active: true, source: data.source };
  } catch {
    return { active: false };
  }
}

function normApp(s: string): string {
  return s.toLowerCase().replace(/\.us$/, "").replace(/\s+/g, " ").trim();
}

function appsMatch(a: string, b: string): boolean {
  const x = normApp(a);
  const y = normApp(b);
  return x === y || x.includes(y) || y.includes(x);
}

function pgrepRunning(appName: string): boolean {
  const r = spawnSync("pgrep", ["-x", appName], { encoding: "utf-8" });
  return r.status === 0 && !!r.stdout?.trim();
}

function getFrontmostApp(): string | null {
  const r = spawnSync(
    "osascript",
    [
      "-e",
      'tell application "System Events" to get name of first application process whose frontmost is true',
    ],
    { encoding: "utf-8" }
  );
  const name = r.stdout?.trim();
  return name || null;
}

const lastFrontmostAt = new Map<string, number>();

function isAppFrontmostOrRecent(appName: string): boolean {
  const front = getFrontmostApp();
  const now = Date.now();
  if (front && appsMatch(appName, front)) {
    lastFrontmostAt.set(appName, now);
    return true;
  }
  const last = lastFrontmostAt.get(appName);
  return last != null && now - last < RECENT_ACTIVE_MS;
}

function meetingAppActive(apps: string[]): boolean {
  for (const app of apps) {
    if (!pgrepRunning(app)) continue;
    if (isAppFrontmostOrRecent(app)) return true;
  }
  return false;
}

function runHoldRoom(args: string[], env: Record<string, string> = {}): void {
  spawnSync(join(SCRIPTS_DIR, "hold_room.sh"), args, {
    env: { ...process.env, ...env },
    stdio: "ignore",
  });
}

function tick(): void {
  const config = loadConfig();
  const apps =
    config.dnd_apps?.length > 0 ? config.dnd_apps : DEFAULT_DND_APPS;
  const active = meetingAppActive(apps);
  const hold = readHoldInfo();
  const action = decideDndAction(active, hold);

  if (action === "hold") {
    log("dnd", `meeting app active (${apps.join(", ")}) — auto-hold`);
    runHoldRoom([], { CR_DND: "1" });
  } else if (action === "release") {
    log("dnd", "meeting app gone — releasing dnd hold");
    runHoldRoom(["off"]);
  }
}

let interval: ReturnType<typeof setInterval> | null = null;

export function startDnd(): void {
  if (interval) return;
  log("dnd", "starting meeting auto-hold poll (15s)");
  tick();
  interval = setInterval(tick, POLL_MS);
}

export function stopDnd(): void {
  if (!interval) return;
  clearInterval(interval);
  interval = null;
  log("dnd", "stopped meeting auto-hold poll");
}
