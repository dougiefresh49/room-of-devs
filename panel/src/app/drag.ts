/**
 * Drag-region mousedown fallback. data-tauri-drag-region needs the
 * start-dragging permission and only covers the exact element — this
 * handler makes the whole header/dock shell reliable, with the same
 * no-drag guards as the legacy bindDrag().
 */
import type { MouseEvent } from "react";
import { platform } from "../platform/tauri.js";

export function dragRegionMouseDown(e: MouseEvent<HTMLElement>): void {
  if (e.button !== 0) return;
  if ((e.target as HTMLElement).closest("button, .conn-dot, .no-drag")) return;
  platform.startDragging();
  e.stopPropagation();
}
