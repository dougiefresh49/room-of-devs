/**
 * Platform adapter — the ONLY seam through which components touch the host
 * shell (Tauri today). Components import the singleton from ./tauri.ts;
 * nothing outside platform/ may import @tauri-apps/*.
 */

export type SnapCorner = "bl" | "br" | "bc" | "tr";

/** Which webview realm this bundle is mounted in (two-window model). */
export type WindowRole = "main" | "dock";

export type RoomMode = "floating" | "dock";

export interface PlatformAdapter {
  /** This webview's realm — drives the App tree + native-chrome variant. */
  windowRole(): WindowRole;
  /** Ask Rust (the mode authority) to swap the visible window. */
  /** Resolves false when the mode switch failed (audit M-31: it used to be
   *  swallowed, leaving the button looking inert). */
  setRoomMode(mode: RoomMode): Promise<boolean>;
  /** WS URL provider for RoomClient (ws_token invoke). May reject when the
   *  daemon is down — WsTransport tolerates that. */
  wsUrl(): Promise<string>;
  /** Native folder picker; null when dismissed. */
  pickFolder(): Promise<string | null>;
  /** Begin a native window drag (mousedown fallback for drag regions). */
  startDragging(): void;
  /** Close this window (main window close = app quit, via Rust). */
  closeWindow(): void;
  /** HID stick flick → corner snap. No-ops when this window is hidden. */
  snapToCorner(corner: SnapCorner): Promise<void>;
  /** Resize+position this window as the bottom-center dock pill. */
  enterDockLayout(width: number, height: number): Promise<void>;
  /** True when this window is currently visible (snap/mode guards). */
  isVisible(): boolean;
}
