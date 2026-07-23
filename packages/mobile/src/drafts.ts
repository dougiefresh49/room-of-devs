/**
 * Reply drafts — per-session text the composer keeps while the user moves
 * between the room, chat, and call surfaces WITHOUT sending. Deliberately
 * in-memory only (a module Map): drafts survive view switches and snapshot
 * ticks but NOT a page reload — matching legacy mobile.html's `replyDrafts`
 * object (they were never persisted to localStorage).
 *
 * Not a reactive store: the composer is an uncontrolled <textarea> (Wispr Flow
 * needs a stable field that snapshot re-renders never wipe), so it reads/writes
 * drafts imperatively rather than through React state.
 */
const drafts = new Map<string, string>();

export function getDraft(sessionId: string): string {
  return drafts.get(sessionId) ?? "";
}

export function setDraft(sessionId: string, text: string): void {
  if (text) drafts.set(sessionId, text);
  else drafts.delete(sessionId);
}

export function clearDraft(sessionId: string): void {
  drafts.delete(sessionId);
}
