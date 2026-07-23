/**
 * Docked mini player (chunk D + E). Appears fixed to the bottom whenever
 * something is playing; hidden entirely when idle (§B1 principle). Two shapes,
 * derived from the dock model (dock.ts):
 *
 *   - PHONE: play/pause, agent label, a one-line karaoke, a speed cycle (static
 *     only — a "live" tag replaces it while streaming), and a stop ×.
 *   - MAC:   a compact "Playing on Mac" bar (no transport — Mac owns it).
 *
 * Tapping the body opens the expanded PlayerSheet, which carries the Mac↔phone
 * handoff device row (chunk E, item 3). This component owns the sheet's open
 * state so playback ticks stay isolated to this subtree — App never re-renders
 * on the 80ms karaoke tick.
 *
 * Talks to the AudioController only — never to <audio> directly.
 */
import { useEffect, useState } from "react";
import type { AgentView, NowPlaying } from "@room/protocol";
import { audioController } from "../audio/controller.js";
import { usePlayer } from "../audio/react.js";
import { deriveDock } from "../dock.js";
import { IconPause, IconPlay } from "../icons.js";
import { Avatar } from "./Avatar.js";
import { KaraokeLine } from "./KaraokeLine.js";
import { PlayerSheet } from "./PlayerSheet.js";

interface MiniPlayerProps {
  agents: AgentView[];
  nowPlaying: NowPlaying | null;
}

export function MiniPlayer({ agents, nowPlaying }: MiniPlayerProps) {
  const player = usePlayer();
  const [expanded, setExpanded] = useState(false);
  const dock = deriveDock(player, nowPlaying, agents);
  const hasDock = !!dock;

  // Collapse the expanded sheet once nothing is playing (effect — no
  // render-phase setState). `hasDock` is a boolean, so this only fires on the
  // has→hasn't edge, not every render.
  useEffect(() => {
    if (!hasDock) setExpanded(false);
  }, [hasDock]);

  if (!dock) return null;

  const openSheet = () => {
    audioController.prime(); // §B3: prime on entry, inside this tap gesture
    setExpanded(true);
  };

  const avatarAgent = dock.agent ?? {
    character: dock.character === "default" ? null : dock.character,
    name: dock.name,
  };

  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="pointer-events-auto mx-auto flex w-full max-w-xl items-center gap-2 rounded-2xl border border-line-strong bg-bg-elevated/95 px-2.5 py-2 shadow-lg backdrop-blur">
          {dock.kind === "phone" ? (
            <PhoneBar name={dock.name} avatarAgent={avatarAgent} onExpand={openSheet} />
          ) : (
            <MacBar name={dock.name} avatarAgent={avatarAgent} onExpand={openSheet} />
          )}
        </div>
      </div>

      <PlayerSheet open={expanded} dock={dock} onClose={() => setExpanded(false)} />
    </>
  );
}

function PhoneBar({
  name,
  avatarAgent,
  onExpand,
}: {
  name: string;
  avatarAgent: Pick<AgentView, "character" | "name">;
  onExpand: () => void;
}) {
  const player = usePlayer();
  const playing = player.status === "playing";
  const loading = player.status === "loading";

  return (
    <>
      <button
        type="button"
        onClick={() => audioController.toggle()}
        aria-label={playing ? "Pause" : "Play"}
        className="grid size-10 shrink-0 place-items-center rounded-full bg-accent text-bg transition-colors hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent [&_svg]:size-5"
      >
        {loading ? (
          <span className="size-4 animate-spin rounded-full border-2 border-bg/40 border-t-bg" />
        ) : playing ? (
          <IconPause />
        ) : (
          <IconPlay />
        )}
      </button>

      <button
        type="button"
        onClick={onExpand}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
        aria-label="Open player"
      >
        <Avatar
          agent={avatarAgent}
          frame={playing ? "speaking" : "idle"}
          className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-lg bg-surface-strong text-[11px] font-semibold text-fg-muted"
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[11px] font-medium text-fg-muted">{name}</span>
          <KaraokeLine
            text={player.text}
            alignment={player.alignment}
            elapsedMs={player.elapsedMs}
            pendingTap={player.status === "pending-tap"}
          />
        </span>
      </button>

      {!player.live ? (
        <button
          type="button"
          onClick={() => audioController.cycleSpeed()}
          aria-label={`Playback speed ${player.speed}×`}
          className="shrink-0 rounded-lg border border-line-strong px-2 py-1 text-xs font-semibold tabular-nums text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {player.speed}×
        </button>
      ) : (
        <span className="shrink-0 rounded-lg bg-accent/15 px-2 py-1 text-[11px] font-semibold text-accent">
          live
        </span>
      )}

      <button
        type="button"
        onClick={() => audioController.stop()}
        aria-label="Stop"
        className="grid size-9 shrink-0 place-items-center rounded-lg text-fg-faint transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-5" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </>
  );
}

function MacBar({
  name,
  avatarAgent,
  onExpand,
}: {
  name: string;
  avatarAgent: Pick<AgentView, "character" | "name">;
  onExpand: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onExpand}
      className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
      aria-label="Open player — move to phone"
    >
      <Avatar
        agent={avatarAgent}
        frame="speaking"
        className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-lg bg-surface-strong text-[11px] font-semibold text-fg-muted"
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-fg">{name}</span>
        <span className="text-[11px] font-medium text-fg-muted">Playing on Mac · tap to move here</span>
      </span>
      <span className="mr-1 flex shrink-0 items-end gap-0.5" aria-hidden="true">
        <span className="h-2 w-0.5 rounded bg-accent/70" />
        <span className="h-3.5 w-0.5 rounded bg-accent/70" />
        <span className="h-2.5 w-0.5 rounded bg-accent/70" />
      </span>
    </button>
  );
}
