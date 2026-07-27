/**
 * GrantButton — the room's primary action: "let this agent speak".
 *
 * It exists as a shared leaf because both surfaces need the SAME affordance
 * and only one of them had it (audit C-5): mobile rendered a labelled
 * <button>, while the panel put the gesture on the card <div> with
 * role="button" — visually unlabelled and, because a div's role does not
 * bring Enter/Space activation with it, dead to the keyboard. This is a real
 * <button type="button">, so activation, focus ring, and disabled semantics
 * come from the platform.
 *
 * Push-to-talk (audit U-5) is optional and OFF unless both onHoldStart and
 * onHoldEnd are supplied. When it is on, the hold is reachable two ways:
 *
 *   - pointer: press, hold past holdMs, release;
 *   - keyboard: hold Space or Enter past holdMs, release.
 *
 * A keyboard hold is the part that was previously impossible. Auto-repeat is
 * suppressed (a held key fires keydown over and over — one hold must mean one
 * start), and because we take over activation while holding is enabled, the
 * plain-press case dispatches onGrant itself on release rather than relying on
 * the browser's synthetic click.
 *
 * Exactly one onHoldEnd follows each onHoldStart: blur, pointercancel, tab
 * hide and unmount all settle an open hold, and the active flag flips before
 * the callback runs so no path can fire twice. Callers of a BILLABLE hold
 * depend on that — do not loosen it.
 */
import { useCallback, useEffect, useRef } from "react";
import type {
  ComponentProps,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";

import { cn } from "../lib/cn.js";

const DEFAULT_HOLD_MS = 300;

export interface GrantButtonProps extends Omit<ComponentProps<"button">, "onClick" | "children"> {
  /** Optimistic in-flight grant: disables the control and swaps the label. */
  pending?: boolean;
  /** Primary line. Keep it a verb phrase — this is the room's main action. */
  label?: ReactNode;
  /** Shown instead of `label` while `pending`. */
  pendingLabel?: ReactNode;
  /** Quiet second line, e.g. where the audio will come out. */
  subLabel?: ReactNode;
  onGrant: () => void;
  /** Supply BOTH to enable push-to-talk; omit both for a plain grant button. */
  onHoldStart?: () => void;
  onHoldEnd?: () => void;
  /** How long a press must last before it counts as a hold. */
  holdMs?: number;
}

export function GrantButton({
  pending = false,
  label = "Read update",
  pendingLabel = "Working…",
  subLabel,
  onGrant,
  onHoldStart,
  onHoldEnd,
  holdMs = DEFAULT_HOLD_MS,
  className,
  disabled,
  ...rest
}: GrantButtonProps) {
  const holdEnabled = !!onHoldStart && !!onHoldEnd;

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holding = useRef(false);
  /** This element started the press — a release we never opened isn't ours. */
  const pressed = useRef(false);
  /** A completed hold is not also a grant. */
  const consumed = useRef(false);
  const endRef = useRef(onHoldEnd);
  endRef.current = onHoldEnd;

  const clearTimer = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const endHold = useCallback(() => {
    clearTimer();
    pressed.current = false;
    if (holding.current) {
      holding.current = false;
      endRef.current?.();
    }
  }, [clearTimer]);

  const beginHold = useCallback(() => {
    consumed.current = false;
    pressed.current = true;
    clearTimer();
    timer.current = setTimeout(() => {
      timer.current = null;
      holding.current = true;
      consumed.current = true;
      onHoldStart?.();
    }, holdMs);
  }, [clearTimer, holdMs, onHoldStart]);

  // Losing the window or the tab while holding must still close the hold.
  useEffect(() => {
    if (!holdEnabled) return;
    const onVisibility = () => {
      if (document.visibilityState !== "visible") endHold();
    };
    window.addEventListener("blur", endHold);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", endHold);
      document.removeEventListener("visibilitychange", onVisibility);
      endHold();
    };
  }, [holdEnabled, endHold]);

  const settle = useCallback(() => {
    if (!pressed.current) return;
    const wasHold = consumed.current;
    endHold();
    consumed.current = false;
    if (!wasHold) onGrant();
  }, [endHold, onGrant]);

  const isDisabled = disabled || pending;

  const pointerProps = holdEnabled
    ? {
        onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => {
          if (e.button !== 0) return;
          beginHold();
        },
        onPointerUp: settle,
        onPointerLeave: endHold,
        onPointerCancel: endHold,
        // Pointer handling already dispatched the grant on release.
        onClick: undefined,
      }
    : { onClick: onGrant };

  const keyProps = holdEnabled
    ? {
        onKeyDown: (e: ReactKeyboardEvent<HTMLButtonElement>) => {
          if (e.key !== " " && e.key !== "Enter") return;
          // A held key auto-repeats; only the first keydown opens the hold.
          if (e.repeat) return;
          // Space would scroll and both keys would synthesize a click that
          // races our own release handling.
          e.preventDefault();
          beginHold();
        },
        onKeyUp: (e: ReactKeyboardEvent<HTMLButtonElement>) => {
          if (e.key !== " " && e.key !== "Enter") return;
          e.preventDefault();
          settle();
        },
        onBlur: endHold,
      }
    : {};

  return (
    <button
      type="button"
      disabled={isDisabled}
      className={cn(
        "flex w-full flex-col items-center rounded-xl border border-transparent px-4 py-2.5 font-semibold text-accent transition-colors hover:brightness-110 disabled:cursor-default disabled:border-transparent disabled:bg-surface-strong disabled:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
        className,
      )}
      style={
        pending
          ? undefined
          : {
              // A darker green SURFACE, not a saturated fill — a full-strength
              // accent block dominated the room (live verification round).
              backgroundColor: "color-mix(in srgb, var(--room-accent) 18%, var(--room-surface))",
              borderColor: "color-mix(in srgb, var(--room-accent) 40%, transparent)",
            }
      }
      {...pointerProps}
      {...keyProps}
      {...rest}
    >
      {pending ? (
        <span className="text-sm text-fg-muted">{pendingLabel}</span>
      ) : (
        <>
          <span className="flex items-center gap-2 text-sm">
            <span aria-hidden="true">▶</span> {label}
          </span>
          {subLabel ? (
            <span className="text-[11px] font-medium text-accent/70">{subLabel}</span>
          ) : null}
        </>
      )}
    </button>
  );
}
