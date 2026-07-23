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
import { IconLaptop, IconSmartphone } from "../icons.js";
import { IconPause, IconPlay } from "@room/ui";
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
  if (!open || !dock) return null;

  const isPhone = dock.kind === "phone";
  const playing = player.status === "playing";
  const source: "mac" | "phone" = isPhone ? "phone" : "mac";
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
    audioController.beginMacToPhone(dock.np, { character: dock.character, name: dock.name }, macOffsetSec(dock.np));
    onClose();
  };

  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end" role="dialog" aria-modal="true" aria-label="Playback">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/50"
      />
      <div className="relative mx-auto w-full max-w-xl rounded-t-3xl border border-line-strong bg-bg-elevated px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-2 shadow-2xl">
        <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-line-strong" />

        <div className="flex items-center gap-3">
          <Avatar
            agent={dock.agent ?? { character: dock.character === "default" ? null : dock.character, name: dock.name }}
            frame={playing || !isPhone ? "speaking" : "idle"}
            className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-2xl bg-surface-strong text-sm font-semibold text-fg-muted"
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-bold text-fg">{dock.name}</div>
            <div className="text-[11px] font-medium text-fg-muted">
              {isPhone ? (player.live ? "streaming on this phone" : "on this phone") : "playing on Mac"}
            </div>
          </div>
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

        {/* karaoke */}
        {isPhone ? (
          <div className="mt-3 rounded-xl border border-line bg-surface px-3 py-2.5">
            <KaraokeLine
              text={player.text}
              alignment={player.alignment}
              elapsedMs={player.elapsedMs}
              variant="card"
              pendingTap={player.status === "pending-tap"}
            />
          </div>
        ) : null}

        {/* device row — the handoff (§A2/A3 semantics) */}
        <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-surface p-1">
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
          <div className="mt-2 text-center text-[12px] text-fg-muted">Moving playback…</div>
        ) : null}

        {/* speed — phone static playback only */}
        {isPhone && !player.live ? (
          <div className="mt-3 flex items-center justify-between">
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
      </div>
    </div>
  );
}
