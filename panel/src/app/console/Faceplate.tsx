/**
 * FACEPLATE // CONCIERGE UNIT — board ~L944.
 * Hero CRT + talk lamp + waveform + dial-2 voice chips + Donnie bay (empty).
 */
import type { AgentView, NowPlaying } from "@room/protocol";
import { Chassis, CrtFace, Led, ScreenBed, SummaryText, Waveform } from "@room/ui";
import { nowPlayingKey } from "@room/room-client";
import { useSyncExternalStore } from "react";
import { AvatarImg } from "../AvatarImg.js";
import { getServerData, subscribeServerData } from "../server-data.js";
import { dismissSummary, openSettings } from "../view-state.js";

interface FaceplateProps {
  agents: AgentView[];
  nowPlaying: NowPlaying | null;
  showTranscript: boolean;
  dismissedKey: string | null;
}

function windowBtnProps(onActivate: () => void) {
  return {
    onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
    onMouseDown: (e: React.MouseEvent) => e.stopPropagation(),
    onClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      onActivate();
    },
  };
}

export function Faceplate({ agents, nowPlaying, showTranscript, dismissedKey }: FaceplateProps) {
  const settings = useSyncExternalStore(subscribeServerData, getServerData).settings;
  const speaking =
    nowPlaying && !nowPlaying.endedAt
      ? (agents.find((a) => a.sessionId === nowPlaying.sessionId) ?? null)
      : null;
  const active = !!speaking;
  const callsign = (speaking?.label ?? speaking?.name ?? "MIKEY").toUpperCase();
  const isMikey =
    !speaking ||
    (speaking.character ?? "").toLowerCase() === "michelangelo" ||
    speaking.name.toLowerCase().includes("mikey") ||
    speaking.name.toLowerCase().includes("michelangelo");
  const role =
    isMikey && !speaking
      ? "ALWAYS ON // STATELESS"
      : speaking
        ? `SPEAKING // ${(speaking.label ?? speaking.name).toUpperCase()}`
        : "ALWAYS ON // STATELESS";

  const dismissed = nowPlaying && dismissedKey === nowPlayingKey(nowPlaying);
  const hasText = nowPlaying && !!nowPlaying.text && !dismissed;

  const mood = settings.mood ?? "normal";
  const playback = settings.playback_mode ?? "auto";
  const speed = settings.speed != null ? `${settings.speed}×` : null;

  return (
    <>
      <Chassis className="console-faceplate" screws>
        <div className="console-fp-label">FACEPLATE // CONCIERGE UNIT · DIAL 2 HOME (VOICE)</div>
        <ScreenBed className="console-fp-screen" scanlines>
          <CrtFace size={176} halo={active} className="console-fp-face">
            {speaking ? (
              <AvatarImg
                agent={speaking}
                imgClassName="avatar"
                fallbackClassName="avatar-fallback"
              />
            ) : (
              <img src="avatars/tmnt/michelangelo/idle.png" alt="" />
            )}
          </CrtFace>
          <div className="console-fp-meta">
            <span className="console-fp-who">{callsign}</span>
            <span className="console-fp-role">{role}</span>
          </div>
          <div className="console-fp-wavebar">
            <Led tone={active ? "amber" : "dim"} pulse={active} pulseSpeed="hot" />
            <Waveform active={active} />
            <span
              className="console-fp-role"
              style={{ marginLeft: "auto", color: active ? "var(--rig-amber)" : undefined }}
            >
              {active ? "SPEAKING" : "STANDBY"}
            </span>
          </div>
        </ScreenBed>
        <div className="console-fp-dial">
          <button
            type="button"
            className="console-fp-dial-chip no-drag"
            title="Open voice settings"
            {...windowBtnProps(openSettings)}
          >
            DIAL 2 · VOICE · {mood}
          </button>
          <button
            type="button"
            className="console-fp-dial-chip no-drag"
            title="Open voice settings"
            {...windowBtnProps(openSettings)}
          >
            PLAYBACK · {playback}
            {speed ? ` · ${speed}` : ""}
          </button>
        </div>
      </Chassis>

      {showTranscript ? (
        <ScreenBed className="console-transcript" hex>
          <div className="console-transcript-head">
            <span>INTERPRETER // TRANSCRIPT</span>
            {hasText && nowPlaying ? (
              <button
                type="button"
                className="icon-btn"
                title="Dismiss"
                style={{ width: 22, height: 22 }}
                {...windowBtnProps(() => dismissSummary(nowPlayingKey(nowPlaying)))}
              >
                ×
              </button>
            ) : null}
          </div>
          {hasText && nowPlaying ? (
            <div className="console-transcript-body">
              <SummaryText text={nowPlaying.text} rawText={nowPlaying.rawText} />
            </div>
          ) : (
            <p className="console-transcript-empty">Nothing spoken yet</p>
          )}
        </ScreenBed>
      ) : null}

      <Chassis className="console-donbay">
        <CrtFace size={58} scanlines={false}>
          <img
            src="avatars/tmnt/donatello/idle.png"
            alt=""
            style={{ filter: "grayscale(1) brightness(.45)" }}
          />
        </CrtFace>
        <div className="console-donbay-info">
          SECOND VOICE // BAY EMPTY
          <br />
          <b>NO CHECKOUT</b>
          <br />
          RETURNS ON “THANKS DONNIE”
        </div>
      </Chassis>
    </>
  );
}
