/**
 * Docked mini player (chunk D). Appears fixed to the bottom while a clip plays
 * on THIS phone; hidden entirely when nothing plays (§B1 principle). Shows:
 * play/pause, the agent/character label, a one-line karaoke that scrolls the
 * spoken word into view, a speed cycle (static playback only — hidden during a
 * live stream), and a close/stop ×. No scrub, no timestamps (§B1).
 *
 * It talks to the AudioController only — never to <audio> directly.
 */
import { useEffect, useRef } from "react";
import type { AgentView } from "@room/protocol";
import { IconPause, IconPlay } from "@room/ui";
import { audioController, type PlayerSnapshot } from "../audio/controller.js";
import { usePlayer } from "../audio/react.js";
import { karaokeWords } from "../audio/karaoke.js";
import { Avatar } from "./Avatar.js";

interface MiniPlayerProps {
  agents: AgentView[];
}

function fmtSpeed(v: number): string {
  return `${v}×`;
}

export function MiniPlayer({ agents }: MiniPlayerProps) {
  const player = usePlayer();
  const { status, file, entry, live } = player;

  if (status === "idle" || !file || !entry) return null;

  const agent = entry.sessionId ? agents.find((a) => a.sessionId === entry.sessionId) : undefined;
  const name =
    agent?.label ||
    agent?.name ||
    entry.sessionName ||
    (entry.sessionId ? entry.sessionId.slice(0, 8) : "Unknown");
  const avatarAgent = agent ?? { character: entry.character ?? null, name };

  const playing = status === "playing";
  const loading = status === "loading";

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div className="pointer-events-auto mx-auto flex w-full max-w-xl items-center gap-2 rounded-2xl border border-line-strong bg-bg-elevated/95 px-2.5 py-2 shadow-lg backdrop-blur">
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

        <Avatar
          agent={avatarAgent}
          frame={playing ? "speaking" : "idle"}
          className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-lg bg-surface-strong text-[11px] font-semibold text-fg-muted"
        />

        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] font-medium text-fg-muted">{name}</div>
          <KaraokeLine
            text={player.text}
            alignment={player.alignment}
            elapsedMs={player.elapsedMs}
            pendingTap={status === "pending-tap"}
          />
        </div>

        {!live ? (
          <button
            type="button"
            onClick={() => audioController.cycleSpeed()}
            aria-label={`Playback speed ${fmtSpeed(player.speed)}`}
            className="shrink-0 rounded-lg border border-line-strong px-2 py-1 text-xs font-semibold tabular-nums text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {fmtSpeed(player.speed)}
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
      </div>
    </div>
  );
}

function KaraokeLine({
  text,
  alignment,
  elapsedMs,
  pendingTap,
}: {
  text: string;
  alignment: PlayerSnapshot["alignment"];
  elapsedMs: number;
  pendingTap: boolean;
}) {
  const scrollRef = useRef<HTMLSpanElement | null>(null);
  const words = pendingTap ? null : karaokeWords(alignment, elapsedMs);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    try {
      el.scrollIntoView({ inline: "center", block: "nearest" });
    } catch {
      /* older webview */
    }
  });

  if (pendingTap) {
    return <div className="truncate text-[13px] text-fg-muted">Ready — tap to play</div>;
  }
  if (!words) {
    return <div className="truncate text-[13px] text-fg">{text}</div>;
  }
  return (
    <div className="flex gap-1 overflow-hidden whitespace-nowrap text-[13px] leading-snug">
      {words.map((w, i) => (
        <span
          key={i}
          ref={w.state === "on" ? scrollRef : undefined}
          className={
            w.state === "on"
              ? "text-accent"
              : w.state === "past"
                ? "text-fg-muted"
                : "text-fg-faint"
          }
        >
          {w.word}
        </span>
      ))}
    </div>
  );
}
