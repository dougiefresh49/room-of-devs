import type { ComponentPropsWithoutRef, SyntheticEvent } from "react";
import {
  IconInfo,
  IconPause,
  IconPlay,
  IconPower,
  IconReplay,
  IconReplaySlower,
  IconStop,
  IconSwap,
  IconTerminal,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@room/ui";

/**
 * Per-agent action strip (room card hover, dock hover, dock spotlight).
 * Mirrors the legacy actionButtonsHtml modes exactly:
 *   live    → pause/resume, stop, restart
 *   summary → replay, replay-slower, jump-to-terminal (team only)
 *   idle    → terminal, end-session (2-click arm), status, replay-last, swap
 * Kill-arm DECISION logic (arm vs confirm) belongs to the caller; this
 * component only reports clicks and renders the armed state. The swap
 * popover is Radix-positioned (replaces the legacy fixed-position math).
 */
export type ClusterMode = "live" | "summary" | "idle";
export type ClusterAction =
  | "focus"
  | "status"
  | "pause"
  | "stop"
  | "restart"
  | "replay"
  | "replay_slower"
  | "replay_session"
  | "kill";

export interface PersonaOption {
  name: string;
  label: string;
  avatarSrc: string;
}

export interface ActionClusterProps {
  mode: ClusterMode;
  isTeam: boolean;
  paused: boolean;
  killArmed: boolean;
  swapOpen: boolean;
  personas: PersonaOption[];
  onAction: (action: ClusterAction) => void;
  onSwapOpenChange: (open: boolean) => void;
  onSwapCharacter: (name: string) => void;
}

function hideBrokenAvatar(e: SyntheticEvent<HTMLImageElement>) {
  const img = e.currentTarget;
  img.style.display = "none";
  const fallback = img.nextElementSibling as HTMLElement | null;
  if (fallback) fallback.style.display = "flex";
}

export function ActionCluster(props: ActionClusterProps) {
  const { mode, isTeam, paused, killArmed, swapOpen, personas, onAction, onSwapOpenChange, onSwapCharacter } = props;

  if (mode === "live") {
    return (
      <>
        <ClusterBtn
          className="icon-btn hover-btn dock-live-btn"
          title={paused ? "Resume audio" : "Pause audio"}
          onClick={() => onAction("pause")}
        >
          {paused ? <IconPlay /> : <IconPause />}
        </ClusterBtn>
        <ClusterBtn
          className="icon-btn hover-btn dock-live-btn"
          title="Stop audio"
          onClick={() => onAction("stop")}
        >
          <IconStop />
        </ClusterBtn>
        <ClusterBtn
          className="icon-btn hover-btn dock-live-btn"
          title="Restart audio"
          onClick={() => onAction("restart")}
        >
          <IconReplay />
        </ClusterBtn>
      </>
    );
  }

  if (mode === "summary") {
    return (
      <>
        <ClusterBtn className="icon-btn hover-btn" title="Replay" onClick={() => onAction("replay")}>
          <IconReplay />
        </ClusterBtn>
        <ClusterBtn
          className="icon-btn hover-btn"
          title="Replay slower"
          onClick={() => onAction("replay_slower")}
        >
          <IconReplaySlower />
        </ClusterBtn>
        {isTeam && (
          <ClusterBtn className="icon-btn hover-btn" title="Jump to terminal" onClick={() => onAction("focus")}>
            <IconTerminal />
          </ClusterBtn>
        )}
      </>
    );
  }

  const teamOnly = !isTeam;
  return (
    <>
      <ClusterBtn
        className={`icon-btn hover-btn${teamOnly ? " disabled" : ""}`}
        title={teamOnly ? "team sessions only" : "Jump to terminal"}
        disabled={teamOnly}
        onClick={() => onAction("focus")}
      >
        <IconTerminal />
      </ClusterBtn>
      <ClusterBtn
        className={`icon-btn hover-btn kill-btn${teamOnly ? " disabled" : ""}${killArmed ? " armed" : ""}`}
        title={teamOnly ? "team sessions only" : killArmed ? "click again to end session" : "End session"}
        disabled={teamOnly}
        onClick={() => onAction("kill")}
      >
        <IconPower />
      </ClusterBtn>
      <ClusterBtn className="icon-btn hover-btn" title="Speak status" onClick={() => onAction("status")}>
        <IconInfo />
      </ClusterBtn>
      <ClusterBtn
        className="icon-btn hover-btn"
        title="Replay their last message"
        onClick={() => onAction("replay_session")}
      >
        <IconReplay />
      </ClusterBtn>
      <Popover open={swapOpen} onOpenChange={onSwapOpenChange}>
        <PopoverTrigger asChild>
          <ClusterBtn className="icon-btn hover-btn" title="Swap character">
            <IconSwap />
          </ClusterBtn>
        </PopoverTrigger>
        <PopoverContent
          className="swap-popover no-drag w-auto"
          style={{ position: "static" }}
          side="top"
          align="end"
          sideOffset={6}
          collisionPadding={8}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          {personas.map((p) => (
            <button
              key={p.name}
              type="button"
              className="swap-chip"
              title={p.label}
              onClick={(e) => {
                e.stopPropagation();
                onSwapCharacter(p.name);
              }}
            >
              <span className="swap-chip-av">
                <img className="avatar swap-chip-img" src={p.avatarSrc} alt="" onError={hideBrokenAvatar} />
                <span className="avatar-fallback swap-chip-fallback">{p.label[0]}</span>
              </span>
              <span>{p.label}</span>
            </button>
          ))}
        </PopoverContent>
      </Popover>
    </>
  );
}

/**
 * Legacy `.icon-btn` buttons stop mousedown propagation so the card's
 * grant/PTT hold detector (still legacy-owned) never fires from a button
 * press — same contract as bindHoverActions had.
 */
function ClusterBtn({
  className,
  title,
  disabled,
  onClick,
  children,
  ...rest
}: ComponentPropsWithoutRef<"button">) {
  return (
    <button
      type="button"
      className={className}
      title={title}
      disabled={disabled}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(e);
      }}
      {...rest}
    >
      {children}
    </button>
  );
}
