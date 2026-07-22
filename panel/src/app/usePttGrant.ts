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
 * through the REACT tree, not the DOM) is not a grant/PTT gesture.
 *
 * Lifetime (Sol #9): gesture state lives in refs; unmount/window-blur/
 * pointercancel/visibility-loss ends an active hold with EXACTLY one
 * `ptt stop`. No path dispatches twice — pttActiveRef flips before send.
 */
import { useCallback, useEffect, useRef } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { client } from "../client.js";
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
}

export function usePttGrant(sessionId: string): PttGrantHandlers {
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pttActive = useRef(false);
  const suppressClick = useRef(false);
  // sessionId can change if a card is recycled across snapshots — the stop
  // must go to the session the hold STARTED on.
  const heldSession = useRef(sessionId);

  const clearHold = useCallback(() => {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  }, []);

  const endHold = useCallback(() => {
    clearHold();
    if (pttActive.current) {
      pttActive.current = false;
      client.send({ type: "ptt", phase: "stop", sessionId: heldSession.current });
    }
  }, [clearHold]);

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
      if (e.button !== 0) return;
      if (isNonGrantTarget(e.target, e.currentTarget)) return;
      suppressClick.current = false;
      clearHold();
      heldSession.current = sessionId;
      holdTimer.current = setTimeout(() => {
        holdTimer.current = null;
        pttActive.current = true;
        suppressClick.current = true;
        client.send({ type: "ptt", phase: "start", sessionId: heldSession.current });
      }, HOLD_MS);
    },
    [sessionId, clearHold],
  );

  const onClick = useCallback(
    (e: ReactMouseEvent<HTMLElement>) => {
      if (isNonGrantTarget(e.target, e.currentTarget)) return;
      if (suppressClick.current) {
        suppressClick.current = false;
        return;
      }
      // Optimistic pending state + render come back through the store
      // subscription; duplicate clicks are deduped in the grant guard
      // (this realm's pendingGrants + the cross-realm localStorage belt).
      dispatchGrant(client, sessionId);
    },
    [sessionId],
  );

  return {
    onMouseDown,
    onMouseUp: endHold,
    onMouseLeave: endHold,
    onPointerCancel: endHold,
    onClick,
  };
}
