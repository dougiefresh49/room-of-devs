import { devices, HID } from "node-hid";
import {
  DEFAULT_DEVICE_HINT,
  loadArcadeButtons,
} from "./config.js";
import { log } from "./logger.js";
import { makeDiffer } from "./hid-report.js";
import { safe } from "./hid-actions.js";
import {
  onEdge,
  onReportAxes,
  refreshMappedAxisBytes,
  clearPending,
  stickArmState,
} from "./hid.js";

// Reconnect poll: one cheap enumerate every 3s while the device is closed.
const RECONNECT_MS = 3000;

// ── Device discovery / open / reconnect ───────────────────────────
export function findDevicePath(hint: string): string | null {
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

export const deviceRef: { current: HID | null } = { current: null };
let scheduler: ReturnType<typeof setInterval> | null = null;
let differ = makeDiffer();

function openDevice(): void {
  if (deviceRef.current) return;
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
    deviceRef.current = d;
    log("hid", `opened encoder at ${path}`);
  } catch (err: any) {
    log("hid", `open failed: ${err?.message ?? err}`);
  }
}

function closeDevice(): void {
  const d = deviceRef.current;
  deviceRef.current = null;
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
    if (!deviceRef.current) safe(openDevice);
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
