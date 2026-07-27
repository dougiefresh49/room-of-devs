/**
 * Pure selectors over RoomState / PanelSnapshot pieces.
 *
 * These are the single home for logic both UIs previously duplicated
 * (phone-frame detection, summary keys). Selectors take the state (or a
 * snapshot fragment) and return derived values — no side effects, no DOM.
 */
import type { AgentView, NowPlaying } from "@room/protocol";
import type { RoomState } from "./types.js";

/** Message identity key — same message ⇔ same key (panel's summaryKey). */
export function nowPlayingKey(np: NowPlaying): string {
  return `${np.sessionId}:${np.startedAt}`;
}

/** Live-mode clips and phone-granted playback route to the phone, not the Mac. */
export function isPhoneRoutedFrame(np: NowPlaying | null): boolean {
  return !!np && (np.kind === "live" || np.output === "phone");
}

const PHONE_FRAME_STALE_MS = 5 * 60_000;

/**
 * A phone-routed frame that is still plausibly playing (not ended, not
 * older than the staleness belt). `now` is injectable for tests.
 */
export function isPhoneFrame(np: NowPlaying | null, now: number = Date.now()): boolean {
  if (!np || np.endedAt || !isPhoneRoutedFrame(np)) return false;
  const startedAt =
    typeof (np.startedAt as unknown) === "number"
      ? (np.startedAt as unknown as number)
      : Date.parse(np.startedAt);
  const age = now - startedAt;
  return Number.isFinite(age) && age >= 0 && age <= PHONE_FRAME_STALE_MS;
}

export function selectConnected(state: RoomState): boolean {
  return state.connected;
}

export function selectVisibleAgents(state: RoomState): AgentView[] {
  return state.snapshot?.agents ?? [];
}

export function selectAgent(state: RoomState, sessionId: string): AgentView | undefined {
  return state.snapshot?.agents.find((a) => a.sessionId === sessionId);
}

export function selectNowPlaying(state: RoomState): NowPlaying | null {
  return state.snapshot?.nowPlaying ?? null;
}

export function selectRoomHeld(state: RoomState): boolean {
  return state.snapshot?.roomHeld ?? false;
}

export function selectPaused(state: RoomState): boolean {
  return state.snapshot?.paused ?? false;
}

export function selectTriageFocus(state: RoomState): string | null {
  const focus = state.snapshot?.triageFocus;
  return typeof focus === "string" && focus.trim() ? focus : null;
}

export function selectPhoneAck(state: RoomState) {
  return state.snapshot?.phoneAck ?? null;
}

/** True when the session has an optimistic grant in flight. */
export function selectGrantPending(state: RoomState, sessionId: string): boolean {
  return state.pendingGrants.has(sessionId);
}

/** Session ids with optimistic grants in flight (render loading states). */
export function selectPendingGrantSessions(state: RoomState): string[] {
  return [...state.pendingGrants.keys()];
}

/** Deploy-skew banner: snapshot protocolVersion ≠ client PROTOCOL_VERSION. */
export function selectProtocolMismatch(state: RoomState): boolean {
  return state.protocolMismatch;
}
