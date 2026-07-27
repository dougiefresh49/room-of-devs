/**
 * Expanded player sheet (chunk E, item 3) — opened from the docked player. Its
 * reason to exist is the Mac↔phone handoff device row that activates the
 * controller's dormant initiators:
 *
 *   - PHONE clip loaded  → Phone is the source; tapping "Mac" hands playback to
 *     the Mac at the current offset (beginPhoneToMac).
 *   - MAC clip playing   → Mac is the source; tapping "This phone" drains the
 *     Mac and picks the clip up here from its offset (beginMacToPhone).
 *
 * Keeps the classic transport minimal (spec §B3): play/pause, karaoke, speed
 * (phone static only), device row. No scrub/timestamps. The one <audio> keeps
 * playing while the sheet is open.
 */
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Markdown, Sheet, SheetContent, SheetTitle } from "@room/ui";
import { IconLaptop, IconPause, IconPlay, IconSmartphone } from "../icons.js";
import { audioController } from "../audio/controller.js";
import { usePlayer } from "../audio/react.js";
import { macOffsetSec, type DockState } from "../dock.js";
import { Avatar } from "./Avatar.js";
import { KaraokeLine } from "./KaraokeLine.js";

interface PlayerSheetProps {
  open: boolean;
  dock: DockState | null;
  onClose: () => void;
}

export function PlayerSheet({ open, dock, onClose }: PlayerSheetProps) {
  const player = usePlayer();
  // Bug 2: the grab handle must actually dismiss. Tap-to-close is the floor;
  // a downward swipe on the handle is the bonus gesture (no live translate —
  // just detect the drag distance on release).
  const dragStartY = useRef<number | null>(null);
  const onGrabDown = (e: ReactPointerEvent) => {
    dragStartY.current = e.clientY;
  };
  const onGrabUp = (e: ReactPointerEvent) => {
    if (dragStartY.current != null && e.clientY - dragStartY.current > 56) onClose();
    dragStartY.current = null;
  };

  // Transcript (character-interpreted, with karaoke) vs Original (the agent's
  // raw message, Markdown, no karaoke). Default transcript; reset when the
  // loaded clip changes.
  const [showOriginal, setShowOriginal] = useState(false);
  const file = player.file;
  useEffect(() => {
    setShowOriginal(false);
  }, [file]);

  // Controlled open (no Radix Trigger) — capture the opener when the sheet
  // opens so close can hand focus back instead of dropping it on <body>.
  // Captured inside onOpenAutoFocus, while the opener still holds focus.
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  if (!open || !dock) return null;

  const isPhone = dock.kind === "phone";
  const playing = player.status === "playing";
  const source: "mac" | "phone" = isPhone ? "phone" : "mac";
  const rawText = (player.entry?.rawText ?? "").trim();
  const spokenText = player.text.trim();
  // Offer the toggle only when there's a distinct original worth seeing.
  const hasRaw = rawText.length > 0 && rawText !== spokenText;
  const viewingOriginal = showOriginal && hasRaw;
  // Belt on top of the controller's single-in-flight latch: while any handoff
  // is pending BOTH device buttons are disabled, so rapid taps can't queue.
  const busy = player.handoffPending;

  const moveToMac = () => {
    if (!isPhone || busy) return;
    audioController.beginPhoneToMac();
    onClose();
  };
  const moveToPhone = () => {
    if (isPhone || !dock.np || busy) return;
    audioController.beginMacToPhone(
      dock.np,
      { character: dock.character, name: dock.name },
      macOffsetSec(dock.np),
    );
    onClose();
  };

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      {/*
        Radix bottom sheet (audit U-7): the scrim, focus trap, Escape and
        focus return come from the primitive — the hand-rolled version
        claimed aria-modal while implementing none of it, and used a
        full-bleed <button> as its backdrop. z-40 keeps the player BELOW the
        conversation sheet, as before.
      */}
      <SheetContent
        side="bottom"
        showClose={false}
        overlayClassName="z-40 bg-black/50"
        aria-describedby={undefined}
        onOpenAutoFocus={() => {
          restoreFocusRef.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          restoreFocusRef.current?.focus();
        }}
        className="relative z-40 mx-auto flex max-h-[88dvh] w-full max-w-xl flex-col gap-0 rounded-t-3xl border border-line-strong bg-bg-elevated px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-1 shadow-2xl"
      >
        <SheetTitle className="sr-only">Playback</SheetTitle>
        {/* Grab handle — tap OR swipe down to dismiss. Generous tap target. */}
        <button
          type="button"
          aria-label="Close player"
          onClick={onClose}
          onPointerDown={onGrabDown}
          onPointerUp={onGrabUp}
          className="mx-auto flex w-full shrink-0 touch-none items-center justify-center py-2 focus-visible:outline-none"
        >
          <span className="h-1 w-10 rounded-full bg-line-strong" />
        </button>

        <div className="flex shrink-0 items-center gap-3">
          <Avatar
            agent={
              dock.agent ?? {
                character: dock.character === "default" ? null : dock.character,
                name: dock.name,
              }
            }
            frame={playing || !isPhone ? "speaking" : "idle"}
            className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-2xl bg-surface-strong text-sm font-semibold text-fg-muted"
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-bold text-fg">{dock.name}</div>
            <div className="text-[11px] font-medium text-fg-muted">
              {isPhone
                ? player.live
                  ? "streaming on this phone"
                  : "on this phone"
                : "playing on Mac"}
            </div>
          </div>
          {/* Always-present, reachable close affordance (never trap the user). */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-9 shrink-0 place-items-center rounded-lg text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              className="size-5"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
          {isPhone ? (
            playing || player.status === "paused" ? (
              <button
                type="button"
                onClick={() => audioController.toggle()}
                aria-label={playing ? "Pause" : "Play"}
                className="grid size-11 shrink-0 place-items-center rounded-full bg-accent text-bg transition-colors hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent [&_svg]:size-5"
              >
                {playing ? <IconPause /> : <IconPlay />}
              </button>
            ) : null
          ) : null}
        </div>

        {/* transcript / original — clamped within the sheet with internal
            scroll so the device + speed rows and the handle stay visible. */}
        {isPhone ? (
          <div className="mt-3 flex min-h-0 flex-col rounded-xl border border-line bg-surface">
            {hasRaw ? (
              <div className="flex shrink-0 items-center justify-end gap-1 border-b border-line px-2 py-1.5">
                <ToggleChip active={!viewingOriginal} onClick={() => setShowOriginal(false)}>
                  Transcript
                </ToggleChip>
                <ToggleChip active={viewingOriginal} onClick={() => setShowOriginal(true)}>
                  Original
                </ToggleChip>
              </div>
            ) : null}
            <div className="min-h-0 max-h-[40dvh] overflow-y-auto px-3 py-2.5">
              {viewingOriginal ? (
                <Markdown
                  text={rawText}
                  linkPolicy="inert"
                  className="cv-md text-[14px] leading-relaxed text-fg"
                />
              ) : (
                <KaraokeLine
                  text={player.text}
                  alignment={player.alignment}
                  elapsedMs={player.elapsedMs}
                  variant="card"
                  pendingTap={player.status === "pending-tap"}
                />
              )}
            </div>
          </div>
        ) : null}

        {/* device row — the handoff (§A2/A3 semantics) */}
        <div className="mt-3 grid shrink-0 grid-cols-2 gap-2 rounded-xl bg-surface p-1">
          <button
            type="button"
            onClick={moveToMac}
            disabled={busy}
            aria-disabled={busy}
            className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-[13px] font-semibold transition-colors disabled:opacity-60 [&_svg]:size-4 ${
              source === "mac"
                ? "bg-accent/15 text-accent"
                : "text-fg-muted hover:bg-surface-hover hover:text-fg"
            }`}
          >
            <IconLaptop /> Mac
          </button>
          <button
            type="button"
            onClick={moveToPhone}
            disabled={busy}
            aria-disabled={busy}
            className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-[13px] font-semibold transition-colors disabled:opacity-60 [&_svg]:size-4 ${
              source === "phone"
                ? "bg-accent/15 text-accent"
                : "text-fg-muted hover:bg-surface-hover hover:text-fg"
            }`}
          >
            <IconSmartphone /> This phone
          </button>
        </div>
        {busy ? (
          <div className="mt-2 shrink-0 text-center text-[12px] text-fg-muted">
            Moving playback…
          </div>
        ) : null}

        {/* speed — phone static playback only */}
        {isPhone && !player.live ? (
          <div className="mt-3 flex shrink-0 items-center justify-between">
            <span className="text-[12px] text-fg-muted">Playback speed</span>
            <button
              type="button"
              onClick={() => audioController.cycleSpeed()}
              className="rounded-lg border border-line-strong px-3 py-1 text-[13px] font-semibold tabular-nums text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {player.speed}×
            </button>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/** Quiet segmented chip for the Transcript / Original toggle (secondary). */
function ToggleChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-md px-2 py-0.5 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
        active ? "bg-accent/15 text-accent" : "text-fg-faint hover:text-fg-muted"
      }`}
    >
      {children}
    </button>
  );
}
