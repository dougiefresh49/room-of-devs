import { useEffect, useState } from "react";
import { Tag, Waveform } from "@room/ui/rig";
import { RotateCcw, Square } from "lucide-react";
import { AvatarFace } from "../avatars/AvatarFace";
import type { NowPlaying as NowPlayingModel } from "../mock/types";
import { FieldCrtFace } from "./FieldCrtFace";

export type NowPlayingVariant = "dock" | "faceplate";

export interface NowPlayingProps {
  variant: NowPlayingVariant;
  nowPlaying: NowPlayingModel | null;
  route: "phone" | "mac";
  gateStartedAt: number | null;
  onStop: () => void;
  onReplay: () => void;
  onRoute: (route: "phone" | "mac") => void;
}

export function PhoneGlyph() {
  return (
    <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden>
      <rect
        x="5.5"
        y="2"
        width="9"
        height="16"
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path d="M8.6 4.4h2.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="10" cy="15.4" r="0.9" fill="currentColor" />
    </svg>
  );
}

export function MacGlyph() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden>
      <rect
        x="3.2"
        y="4"
        width="13.6"
        height="9"
        rx="1.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path d="M1.6 15.6h16.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function formatElapsed(startedAt: number, now: number): string {
  const totalSeconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function formatGateRemaining(startedAt: number | null, now: number): string {
  if (startedAt == null) return "00:00";
  const remaining = Math.max(0, 5 * 60 - Math.floor((now - startedAt) / 1000));
  return `${String(Math.floor(remaining / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`;
}

function RouteGlyph({ route }: { route: "phone" | "mac" }) {
  return route === "phone" ? <PhoneGlyph /> : <MacGlyph />;
}

export function RouteControl({
  compact,
  route,
  onRoute,
  showLabels = false,
}: {
  compact: boolean;
  route: "phone" | "mac";
  onRoute: (route: "phone" | "mac") => void;
  showLabels?: boolean;
}) {
  if (compact) {
    const next = route === "phone" ? "mac" : "phone";
    return (
      <button
        type="button"
        className="ffloor-route ffloor-route--compact"
        onClick={() => onRoute(next)}
        aria-label={`Audio route: ${route === "phone" ? "this phone" : "Mac"}. Switch to ${next}.`}
        title={route === "phone" ? "PLAYING ON THIS PHONE" : "PLAYING ON MAC"}
      >
        <RouteGlyph route={route} />
      </button>
    );
  }

  return (
    <div className="ffloor-route ffloor-route--segments" role="group" aria-label="Audio route">
      <button
        type="button"
        className={route === "phone" ? "is-active" : undefined}
        aria-pressed={route === "phone"}
        aria-label="Play on this phone"
        onClick={() => onRoute("phone")}
      >
        <PhoneGlyph />
        {showLabels ? <span>PHONE</span> : null}
      </button>
      <button
        type="button"
        className={route === "mac" ? "is-active" : undefined}
        aria-pressed={route === "mac"}
        aria-label="Play on Mac speakers"
        onClick={() => onRoute("mac")}
      >
        <MacGlyph />
        {showLabels ? <span>MAC</span> : null}
      </button>
    </div>
  );
}

/**
 * Shared AUDIO FLOOR instrument. It owns only the local elapsed display:
 * the timer exists while a real clip has the floor and is torn down at idle.
 */
export function NowPlaying({
  variant,
  nowPlaying,
  route,
  gateStartedAt,
  onStop,
  onReplay,
  onRoute,
}: NowPlayingProps) {
  const [now, setNow] = useState(() => Date.now());
  const speaking = nowPlaying != null;
  const live = nowPlaying?.kind === "live-clip";
  useEffect(() => {
    if (!nowPlaying && !(route === "phone" && gateStartedAt != null)) return;
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [gateStartedAt, nowPlaying, route]);

  const elapsed = nowPlaying ? formatElapsed(nowPlaying.startedAt, now) : null;
  const gateLabel =
    route === "phone" ? `GATE HELD ${formatGateRemaining(gateStartedAt, now)}` : "GATE OPEN · MAC";
  const showFace = speaking && variant !== "faceplate";
  const showRoute = variant !== "faceplate";

  return (
    <div
      className={`audio-floor audio-floor--${variant}${variant === "dock" ? " screenbed" : ""} ${speaking ? "is-speaking" : "is-idle"}${live ? " is-live" : ""}`}
      aria-label={speaking ? `${nowPlaying.persona} has the audio floor` : "Audio floor clear"}
    >
      {showRoute ? <RouteControl compact={false} route={route} onRoute={onRoute} /> : null}

      {showFace && nowPlaying ? (
        <div className="ffloor-face">
          <FieldCrtFace size={28}>
            <AvatarFace persona={nowPlaying.persona} mode="speaking" size={28} />
          </FieldCrtFace>
        </div>
      ) : null}

      {variant === "faceplate" ? null : speaking && nowPlaying ? (
        <div className="ffloor-copy">
          <b className="ffloor-name">{nowPlaying.persona}</b>
          <span className="ffloor-label">{nowPlaying.label}</span>
        </div>
      ) : (
        <span className="ffloor-clear">FLOOR CLEAR</span>
      )}

      {live ? (
        <Tag tone="red" className="ffloor-live">
          LIVE
        </Tag>
      ) : null}

      {variant === "dock" ? (
        <span className={`ffloor-gate${route === "phone" ? " is-held" : ""}`}>{gateLabel}</span>
      ) : null}

      <div className="ffloor-meter">
        <Waveform active={speaking} bars={variant === "dock" ? 6 : 9} />
        <span className="ffloor-elapsed sseg">{elapsed ?? "IDLE"}</span>
      </div>

      <div className="ffloor-actions">
        <button
          type="button"
          className="ffloor-key ffloor-stop"
          onClick={onStop}
          disabled={!speaking}
          aria-label="STOP"
          title="STOP"
        >
          <Square size={12} fill="currentColor" aria-hidden />
        </button>
        <button
          type="button"
          className="ffloor-key ffloor-replay"
          onClick={onReplay}
          aria-label="REPLAY LAST · FREE"
          title="REPLAY LAST · FREE"
        >
          <RotateCcw size={13} aria-hidden />
        </button>
      </div>
    </div>
  );
}
