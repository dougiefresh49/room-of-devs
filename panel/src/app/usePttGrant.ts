/**
 * The card/dock grant + PTT gesture — SINGLE owner of both billable
 * dispatches (grant click, ptt hold). Semantics verbatim from the legacy
 * bindGrantTargets: mousedown → 300ms hold timer → ptt start; mouseup/
 * mouseleave → ptt stop; click not preceded by a hold (and not on a
 * non-grant target) → grant.
 *
 * Event firewall (Sol #8): a press on any button other than the gesture
 * surface itself, anything inside an action-cluster container, or anything
 * inside a [data-no-grant] overlay (portaled popover content bubbles
 * through the REACT tree, not the DOM) is not a grant/PTT gesture. The
 * room card's GrantButton is such a button, so its own press never also
 * fires the card gesture — it calls this hook's callbacks instead.
 *
 * Keyboard (audit U-5): the same hold is reachable with Space/Enter on any
 * focusable surface bound to `gesture`, and through the shared GrantButton
 * via `onHoldStart`/`onHoldEnd`. Auto-repeat is suppressed, so a held key
 * still means exactly one hold.
 *
 * Lifetime (Sol #9): gesture state lives in refs; unmount/window-blur/
 * pointercancel/visibility-loss ends an active hold with EXACTLY one
 * `ptt stop`. No path dispatches twice — every start/stop goes through
 * beginPtt/endPtt, which flip pttActive BEFORE sending, so the pointer and
 * keyboard paths (and GrantButton's own timer) can never double-dispatch.
 *
 * Offline (audit U-1): when `enabled` is false the whole gesture is inert —
 * no optimistic pending state for a grant the daemon will never see.
 */
import { useCallback, useEffect, useRef } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { client } from "../client.js";
import { runCommand } from "./commands.js";
import { dispatchGrant } from "./grant-guard.js";

const HOLD_MS = 300;

export function isNonGrantTarget(el: EventTarget | null, boundTarget: HTMLElement): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const btn = el.closest("button");
  if (btn && btn !== boundTarget) return true;
  if (el.closest("[data-no-grant]")) return true;
  return !!el.closest(".card-actions, .dock-actions, .spotlight-actions");
}

export interface PttGrantHandlers {
  onMouseDown: (e: ReactMouseEvent<HTMLElement>) => void;
  onMouseUp: (e: ReactMouseEvent<HTMLElement>) => void;
  onMouseLeave: (e: ReactMouseEvent<HTMLElement>) => void;
  onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
  onClick: (e: ReactMouseEvent<HTMLElement>) => void;
  onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => void;
  onKeyUp: (e: ReactKeyboardEvent<HTMLElement>) => void;
}

export interface PttGrant {
  /** Spread onto the gesture surface (room card, dock avatar button). */
  gesture: PttGrantHandlers;
  /** Grant the floor — the GrantButton's onGrant. */
  grant: () => void;
  /** Push-to-talk hold — the GrantButton's onHoldStart/onHoldEnd pair. */
  holdStart: () => void;
  holdEnd: () => void;
}

export function usePttGrant(sessionId: string, enabled = true): PttGrant {
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pttActive = useRef(false);
  /** Did the daemon ACCEPT the start? A stop after a refused start is quiet. */
  const startAccepted = useRef(false);
  const suppressClick = useRef(false);
  const keyHeld = useRef(false);
  // sessionId can change if a card is recycled across snapshots — the stop
  // must go to the session the hold STARTED on.
  const heldSession = useRef(sessionId);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const clearHold = useCallback(() => {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  }, []);

  /** The ONLY `ptt start` dispatch. No-op if a hold is already open. */
  const beginPtt = useCallback(() => {
    if (pttActive.current) return;
    pttActive.current = true;
    startAccepted.current = false;
    const session = heldSession.current;
    void runCommand(
      { type: "ptt", phase: "start", sessionId: session },
      "Push-to-talk didn't start",
    ).then((ok) => {
      if (heldSession.current === session) startAccepted.current = ok;
    });
  }, []);

  /** The ONLY `ptt stop` dispatch. No-op unless a hold is open. */
  const endPtt = useCallback(() => {
    if (!pttActive.current) return;
    pttActive.current = false;
    const accepted = startAccepted.current;
    startAccepted.current = false;
    void runCommand(
      { type: "ptt", phase: "stop", sessionId: heldSession.current },
      // Nothing was recording if the start never landed — stay quiet then;
      // a failed stop after a live start is worth saying out loud.
      accepted ? "Push-to-talk may still be recording" : null,
    );
  }, []);

  const endHold = useCallback(() => {
    clearHold();
    keyHeld.current = false;
    endPtt();
  }, [clearHold, endPtt]);

  const armHold = useCallback(() => {
    clearHold();
    heldSession.current = sessionId;
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null;
      suppressClick.current = true;
      beginPtt();
    }, HOLD_MS);
  }, [sessionId, clearHold, beginPtt]);

  const grant = useCallback(() => {
    if (!enabledRef.current) return;
    // Optimistic pending state + render come back through the store
    // subscription; duplicate clicks are deduped in the grant guard
    // (this realm's pendingGrants + the cross-realm localStorage belt).
    dispatchGrant(client, sessionId);
  }, [sessionId]);

  const holdStart = useCallback(() => {
    if (!enabledRef.current) return;
    heldSession.current = sessionId;
    beginPtt();
  }, [sessionId, beginPtt]);

  // Unmount, window blur, or tab-hide while holding → exactly one stop.
  useEffect(() => {
    const onWindowBlur = () => endHold();
    const onVisibility = () => {
      if (document.visibilityState !== "visible") endHold();
    };
    window.addEventListener("blur", onWindowBlur);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", onWindowBlur);
      document.removeEventListener("visibilitychange", onVisibility);
      endHold();
    };
  }, [endHold]);

  const onMouseDown = useCallback(
    (e: ReactMouseEvent<HTMLElement>) => {
      if (!enabled) return;
      if (e.button !== 0) return;
      if (isNonGrantTarget(e.target, e.currentTarget)) return;
      suppressClick.current = false;
      armHold();
    },
    [enabled, armHold],
  );

  const onClick = useCallback(
    (e: ReactMouseEvent<HTMLElement>) => {
      if (isNonGrantTarget(e.target, e.currentTarget)) return;
      if (suppressClick.current) {
        suppressClick.current = false;
        return;
      }
      grant();
    },
    [grant],
  );

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLElement>) => {
      if (!enabled) return;
      if (e.key !== " " && e.key !== "Enter") return;
      if (isNonGrantTarget(e.target, e.currentTarget)) return;
      // A held key auto-repeats; only the first keydown opens the hold.
      if (e.repeat || keyHeld.current) return;
      // Space scrolls, and both keys synthesize a click that would race the
      // release handling below.
      e.preventDefault();
      keyHeld.current = true;
      suppressClick.current = false;
      armHold();
    },
    [enabled, armHold],
  );

  const onKeyUp = useCallback(
    (e: ReactKeyboardEvent<HTMLElement>) => {
      if (e.key !== " " && e.key !== "Enter") return;
      if (!keyHeld.current) return;
      e.preventDefault();
      keyHeld.current = false;
      const wasHold = pttActive.current || suppressClick.current;
      endHold();
      suppressClick.current = false;
      // A short press is a grant; a completed hold was the PTT, not a grant.
      if (!wasHold) grant();
    },
    [endHold, grant],
  );

  return {
    gesture: {
      onMouseDown,
      onMouseUp: endHold,
      onMouseLeave: endHold,
      onPointerCancel: endHold,
      onClick,
      onKeyDown,
      onKeyUp,
    },
    grant,
    holdStart,
    holdEnd: endHold,
  };
}
