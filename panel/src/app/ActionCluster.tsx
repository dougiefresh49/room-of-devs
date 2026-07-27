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
 *   stage   → pause/resume, stop, restart (someone is on the Mac lipsync
 *             stage — renamed from "live", which collides with daemon
 *             live mode)
 *   summary → replay, replay-slower, jump-to-terminal (team only)
 *   idle    → terminal, end-session (2-click arm), status, replay-last, swap
 * Kill-arm DECISION logic (arm vs confirm) belongs to the caller; this
 * component only reports clicks and renders the armed state. The swap
 * popover is Radix-positioned (replaces the legacy fixed-position math).
 */
export type ClusterMode = "stage" | "summary" | "idle";
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
  /** Transport link. Offline → every action is genuinely disabled (audit U-1). */
  connected: boolean;
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

const OFFLINE_REASON = "Room is offline";

export function ActionCluster(props: ActionClusterProps) {
  const {
    mode,
    isTeam,
    connected,
    paused,
    killArmed,
    swapOpen,
    personas,
    onAction,
    onSwapOpenChange,
    onSwapCharacter,
  } = props;

  // Offline actions used to stay clickable and simply vanish into a dead
  // socket. Now they carry a real `disabled` (so pointer AND keyboard are
  // blocked, and assistive tech says "dimmed") plus the reason in the title.
  const off = !connected;
  const label = (text: string) => (off ? `${text} — ${OFFLINE_REASON.toLowerCase()}` : text);
  const offClass = off ? " disabled" : "";

  if (mode === "stage") {
    return (
      <>
        <ClusterBtn
          className={`icon-btn hover-btn dock-live-btn${offClass}`}
          title={label(paused ? "Resume audio" : "Pause audio")}
          disabled={off}
          onClick={() => onAction("pause")}
        >
          {paused ? <IconPlay /> : <IconPause />}
        </ClusterBtn>
        <ClusterBtn
          className={`icon-btn hover-btn dock-live-btn${offClass}`}
          title={label("Stop audio")}
          disabled={off}
          onClick={() => onAction("stop")}
        >
          <IconStop />
        </ClusterBtn>
        <ClusterBtn
          className={`icon-btn hover-btn dock-live-btn${offClass}`}
          title={label("Restart audio")}
          disabled={off}
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
        <ClusterBtn
          className={`icon-btn hover-btn${offClass}`}
          title={label("Replay")}
          disabled={off}
          onClick={() => onAction("replay")}
        >
          <IconReplay />
        </ClusterBtn>
        <ClusterBtn
          className={`icon-btn hover-btn${offClass}`}
          title={label("Replay slower")}
          disabled={off}
          onClick={() => onAction("replay_slower")}
        >
          <IconReplaySlower />
        </ClusterBtn>
        {isTeam && (
          <ClusterBtn
            className={`icon-btn hover-btn${offClass}`}
            title={label("Jump to terminal")}
            disabled={off}
            onClick={() => onAction("focus")}
          >
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
        className={`icon-btn hover-btn${teamOnly ? " disabled" : ""}${offClass}`}
        title={teamOnly ? "team sessions only" : label("Jump to terminal")}
        disabled={teamOnly || off}
        onClick={() => onAction("focus")}
      >
        <IconTerminal />
      </ClusterBtn>
      {/* Two-click arm. The armed state used to live ONLY in the title
          attribute (audit U-6): invisible without hover and silent to a
          screen reader. It now changes the accessible NAME and reports
          aria-pressed, and ui-state announces the arm/expiry transitions. */}
      <ClusterBtn
        className={`icon-btn hover-btn kill-btn${teamOnly ? " disabled" : ""}${offClass}${killArmed ? " armed" : ""}`}
        title={
          teamOnly
            ? "team sessions only"
            : killArmed
              ? "click again to end session"
              : label("End session")
        }
        aria-label={
          killArmed ? "Confirm end session — activate again within 8 seconds" : "End session"
        }
        aria-pressed={killArmed}
        disabled={teamOnly || off}
        onClick={() => onAction("kill")}
      >
        <IconPower />
      </ClusterBtn>
      <ClusterBtn
        className={`icon-btn hover-btn${offClass}`}
        title={label("Speak status")}
        disabled={off}
        onClick={() => onAction("status")}
      >
        <IconInfo />
      </ClusterBtn>
      <ClusterBtn
        className={`icon-btn hover-btn${offClass}`}
        title={label("Replay their last message")}
        disabled={off}
        onClick={() => onAction("replay_session")}
      >
        <IconReplay />
      </ClusterBtn>
      <Popover open={swapOpen} onOpenChange={onSwapOpenChange}>
        <PopoverTrigger asChild>
          <ClusterBtn
            className={`icon-btn hover-btn${offClass}`}
            title={label("Swap character")}
            disabled={off}
          >
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
          // Portaled content still bubbles synthetic events through the
          // REACT tree — without these stops, a click on popover padding
          // would reach the card's grant/PTT handlers (Sol #8). data-no-grant
          // is the second belt: the gesture rejects targets inside it.
          data-no-grant=""
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
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
                <img
                  className="avatar swap-chip-img"
                  src={p.avatarSrc}
                  alt=""
                  onError={hideBrokenAvatar}
                />
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
 * `.icon-btn` buttons stop mousedown/click propagation so the card's
 * grant/PTT hold detector (usePttGrant on the card element) never fires
 * from a button press — same contract as bindHoverActions had.
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
