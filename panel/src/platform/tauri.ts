/**
 * Tauri implementation of the platform adapter. Window geometry mechanics
 * (dock sizing, corner snap, saved-frame restore) moved here verbatim from
 * the legacy main.ts — the math is unchanged, only the owner is.
 */
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  LogicalPosition,
  LogicalSize,
  PhysicalPosition,
  availableMonitors,
  currentMonitor,
  getCurrentWindow,
} from "@tauri-apps/api/window";
import type { PlatformAdapter, RoomMode, SnapCorner, WindowRole } from "./types.js";

interface WsConfig {
  token: string;
  port: number;
}

const DOCK_MIN_SIZE = new LogicalSize(88, 56);
const DOCK_BOTTOM_GAP = 12;
const SNAP_MARGIN = 12;

async function snapToCorner(corner: SnapCorner): Promise<void> {
  // Snap must never move a hidden window (4b: both realms receive the
  // HID snap event; only the visible one may act).
  if (document.visibilityState !== "visible") return;
  const win = getCurrentWindow();
  try {
    const monitor = await currentMonitor();
    if (!monitor) return;
    // ALL math in physical pixels — monitors can have different scale
    // factors, and mixing logical conversions across them threw the window
    // into the void once. outerSize/monitor rects are already physical.
    const size = await win.outerSize();
    const pos = await win.outerPosition();
    const rect = (m: typeof monitor) => ({
      x: m.position.x,
      y: m.position.y,
      w: m.size.width,
      h: m.size.height,
      margin: Math.round(SNAP_MARGIN * (m.scaleFactor || 1)),
    });

    const target = (m: ReturnType<typeof rect>) => {
      let x = m.x + m.margin;
      let y = m.y + m.margin;
      if (corner === "br" || corner === "tr") x = m.x + m.w - size.width - m.margin;
      else if (corner === "bc") x = m.x + Math.round((m.w - size.width) / 2);
      if (corner !== "tr") y = m.y + m.h - size.height - m.margin;
      return { x, y };
    };

    let mon = rect(monitor);
    let t = target(mon);

    // Repeat flick at an occupied corner = hop to the adjacent monitor.
    const atTarget = Math.abs(pos.x - t.x) < 32 && Math.abs(pos.y - t.y) < 32;
    if (atTarget && corner !== "bc") {
      const wantLeft = corner === "bl";
      const rects = (await availableMonitors()).map(rect);
      const candidates = rects.filter((m) =>
        wantLeft ? m.x + m.w <= mon.x + 1 : m.x >= mon.x + mon.w - 1
      );
      if (candidates.length) {
        candidates.sort((a, b) => (wantLeft ? b.x - a.x : a.x - b.x));
        mon = candidates[0];
        t = target(mon);
      }
    }

    // Safety clamp: the target's top-left must sit inside SOME monitor, or
    // the window becomes unfindable. Fall back to the current monitor.
    const all = (await availableMonitors()).map(rect);
    const visible = all.some(
      (m) => t.x >= m.x - 8 && t.x < m.x + m.w && t.y >= m.y - 8 && t.y < m.y + m.h
    );
    if (!visible) t = target(rect(monitor));

    await win.setPosition(new PhysicalPosition(Math.round(t.x), Math.round(t.y)));
  } catch (err) {
    console.error("failed to snap panel:", err);
  }
}

// Serialized + coalesced: geometry ops are async and must never
// interleave; a call arriving mid-flight just becomes the next target.
let dockLayoutChain: Promise<void> = Promise.resolve();
let dockLayoutTarget: { width: number; height: number } | null = null;

function enterDockLayout(width: number, height: number): Promise<void> {
  const first = dockLayoutTarget === null;
  dockLayoutTarget = { width, height };
  if (first) {
    dockLayoutChain = dockLayoutChain.then(async () => {
      while (dockLayoutTarget) {
        const t = dockLayoutTarget;
        await applyDockLayout(t.width, t.height);
        if (dockLayoutTarget === t) dockLayoutTarget = null;
      }
    });
  }
  return dockLayoutChain;
}

async function applyDockLayout(width: number, height: number): Promise<void> {
  const win = getCurrentWindow();
  try {
    await win.setMinSize(DOCK_MIN_SIZE);
    await win.setSize(new LogicalSize(width, height));

    const monitor = await currentMonitor();
    if (monitor) {
      const scale = await win.scaleFactor();
      const monitorX = monitor.position.x / scale;
      const monitorY = monitor.position.y / scale;
      const monitorWidth = monitor.size.width / scale;
      const monitorHeight = monitor.size.height / scale;
      await win.setPosition(
        new LogicalPosition(
          Math.round(monitorX + (monitorWidth - width) / 2),
          Math.round(monitorY + monitorHeight - height - DOCK_BOTTOM_GAP),
        ),
      );
    }
  } catch (err) {
    console.error("failed to enter dock mode:", err);
  }
}

export const platform: PlatformAdapter = {
  windowRole(): WindowRole {
    return getCurrentWindow().label === "dock" ? "dock" : "main";
  },

  async setRoomMode(mode: RoomMode): Promise<void> {
    try {
      await invoke("set_room_mode", { mode });
    } catch (err) {
      console.error("set_room_mode failed:", err);
    }
  },

  // Token/port come from Tauri per connection attempt, so a daemon restart
  // (which rotates the token) reconnects cleanly. WsTransport tolerates
  // this provider rejecting (daemon down → no token file yet).
  async wsUrl(): Promise<string> {
    const config = await invoke<WsConfig>("ws_token");
    return `ws://127.0.0.1:${config.port}/?token=${encodeURIComponent(config.token)}`;
  },

  async pickFolder(): Promise<string | null> {
    try {
      const selected = await open({ directory: true, multiple: false });
      return selected && typeof selected === "string" ? selected : null;
    } catch (err) {
      console.error("folder picker failed:", err);
      return null;
    }
  },

  startDragging(): void {
    void getCurrentWindow().startDragging();
  },

  closeWindow(): void {
    void getCurrentWindow().close();
  },

  snapToCorner,
  enterDockLayout,

  isVisible(): boolean {
    return document.visibilityState === "visible";
  },
};
