/**
 * Platform adapter — the ONLY seam through which components touch the host
 * shell (Tauri today). Components import the singleton from ./tauri.ts;
 * nothing outside platform/ may import @tauri-apps/*.
 */

export type SnapCorner = "bl" | "br" | "bc" | "tr";

export interface PlatformAdapter {
  /** WS URL provider for RoomClient (ws_token invoke). May reject when the
   *  daemon is down — WsTransport tolerates that. */
  wsUrl(): Promise<string>;
  /** Native folder picker; null when dismissed. */
  pickFolder(): Promise<string | null>;
  /** Begin a native window drag (mousedown fallback for drag regions). */
  startDragging(): void;
  /** Close this window (4a: the sole window — quits the app). */
  closeWindow(): void;
  /** HID stick flick → corner snap. No-ops when this window is hidden. */
  snapToCorner(corner: SnapCorner): Promise<void>;
  /** Resize+position this window as the bottom-center dock pill. */
  enterDockLayout(width: number, height: number): Promise<void>;
  /** Restore the pre-dock frame (4a in-window dock only). */
  exitDockLayout(): Promise<void>;
  /** True when this window is currently visible (snap/mode guards). */
  isVisible(): boolean;
}
