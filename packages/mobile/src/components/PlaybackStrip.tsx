/**
 * In-sheet playback strip (spec §B1 playback-strip contract): hidden entirely
 * when no clip plays for this session; while a clip is loaded, ONE slim strip
 * above the composer with ▶/⏸, a one-line karaoke of the spoken words, and an
 * × that stops phone playback. NO speed / scrub / timestamps here (the docked
 * MiniPlayer keeps those on the room screen; the strip stays minimal).
 *
 * Talks only to the AudioController.
 */
import { IconPause, IconPlay } from "@room/ui";
import { audioController } from "../audio/controller.js";
import { usePlayer } from "../audio/react.js";
import { KaraokeLine } from "./KaraokeLine.js";

export function PlaybackStrip({ sessionId }: { sessionId: string }) {
  const player = usePlayer();

  // Strip stays up while a clip is loaded for THIS session (playing OR paused).
  const active =
    player.status !== "idle" && !!player.entry && player.entry.sessionId === sessionId;
  if (!active) return null;

  const playing = player.status === "playing";
  const loading = player.status === "loading";

  return (
    <div className="mx-3 mb-2 flex shrink-0 items-center gap-2.5 rounded-xl border border-line bg-surface px-2.5 py-2">
      <button
        type="button"
        onClick={() => audioController.toggle()}
        aria-label={playing ? "Pause" : "Play"}
        className="grid size-8 shrink-0 place-items-center rounded-full bg-accent text-bg transition-colors hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent [&_svg]:size-[15px]"
      >
        {loading ? (
          <span className="size-3.5 animate-spin rounded-full border-2 border-bg/40 border-t-bg" />
        ) : playing ? (
          <IconPause />
        ) : (
          <IconPlay />
        )}
      </button>

      <div className="min-w-0 flex-1">
        <KaraokeLine
          text={player.text}
          alignment={player.alignment}
          elapsedMs={player.elapsedMs}
          pendingTap={player.status === "pending-tap"}
        />
      </div>

      <button
        type="button"
        onClick={() => audioController.stop()}
        aria-label="Stop"
        className="grid size-8 shrink-0 place-items-center rounded-lg text-fg-faint transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-[18px]" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}
