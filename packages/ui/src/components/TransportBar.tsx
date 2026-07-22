import { IconHold, IconPause, IconPlay, IconReplay, IconStop } from "./icons.js";

/**
 * Room transport footer: pause/resume, stop, replay-last (free), hold-room.
 * Pure presentation — playback state in, callbacks out.
 */
export interface TransportBarProps {
  paused: boolean;
  held: boolean;
  onPause: () => void;
  onStop: () => void;
  onReplay: () => void;
  onHold: () => void;
}

export function TransportBar({ paused, held, onPause, onStop, onReplay, onHold }: TransportBarProps) {
  return (
    <>
      <button
        type="button"
        className={`icon-btn${paused ? " paused-indicator" : ""}`}
        title={paused ? "Resume playback" : "Pause playback"}
        onClick={onPause}
      >
        {paused ? <IconPlay /> : <IconPause />}
      </button>
      <button type="button" className="icon-btn" title="Stop playback" onClick={onStop}>
        <IconStop />
      </button>
      <button type="button" className="icon-btn" title="Replay last message (free)" onClick={onReplay}>
        <IconReplay />
      </button>
      <button
        type="button"
        className={`icon-btn hold-control${held ? " active" : ""}`}
        title={held ? "Release the room" : "Hold the room"}
        aria-pressed={held}
        onClick={onHold}
      >
        <IconHold />
      </button>
    </>
  );
}
