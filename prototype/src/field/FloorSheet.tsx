import { Sheet, SheetContent, SheetTitle } from "@room/ui";
import { CutFrame, Tag } from "@room/ui/rig";
import { RotateCcw, Square } from "lucide-react";
import { useEffect, useState } from "react";
import { AvatarFace } from "../avatars/AvatarFace";
import { replayLastMikey, setAudioRoute, stopPlayback } from "../mock/scenario";
import { useAppState, useFleet, useRoom } from "../mock/store";
import { FieldCrtFace } from "../rig-ext/FieldCrtFace";
import { RouteControl, formatElapsed, formatGateRemaining } from "../rig-ext/NowPlaying";

export function FloorSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const room = useRoom();
  const fleet = useFleet();
  const app = useAppState();
  const [now, setNow] = useState(() => Date.now());
  const floorRoom = fleet.audioFloor.roomId ? app.rooms[fleet.audioFloor.roomId] : null;
  const transportRoom = floorRoom ?? room;
  const { nowPlaying, lastClip } = transportRoom;
  const route = fleet.audioFloor.route;

  useEffect(() => {
    if (!nowPlaying && !(route === "phone" && transportRoom.audio.gateStartedAt != null)) return;
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [nowPlaying, route, transportRoom.audio.gateStartedAt]);

  const elapsed = nowPlaying ? formatElapsed(nowPlaying.startedAt, now) : "00:00";
  const live = nowPlaying?.kind === "live-clip";
  const replaying = nowPlaying?.kind === "replay";
  const callsign =
    transportRoom.crew.find((member) => member.id === nowPlaying?.persona)?.callsign ??
    nowPlaying?.persona.toUpperCase();
  const gateLabel =
    route === "phone" && transportRoom.audio.gateStartedAt != null
      ? `GATE HELD ${formatGateRemaining(transportRoom.audio.gateStartedAt, now)}`
      : "GATE OPEN · MAC";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showClose={false}
        className="screenbed field-bounds-sheet field-floorsheet field-sheet-open"
        overlayClassName="field-sheet-overlay"
      >
        <button
          type="button"
          className="nodesheet-pull"
          aria-label="Close audio floor"
          onClick={() => onOpenChange(false)}
        >
          <span aria-hidden />
        </button>
        <SheetTitle className="visually-hidden">Audio floor</SheetTitle>

        {nowPlaying ? (
          <>
            <div className="ffloor-persona">
              <FieldCrtFace size={24} scanlines>
                <AvatarFace persona={nowPlaying.persona} mode="speaking" size={24} />
              </FieldCrtFace>
              <b>{callsign}</b>
              <Tag tone={live ? "red" : replaying ? "green" : "amber"}>
                {live ? "LIVE" : replaying ? "REPLAY · FREE" : "TURN FINAL"}
              </Tag>
            </div>
            <div className="ffloor-hero">
              <FieldCrtFace size={176} halo scanlines>
                <AvatarFace persona={nowPlaying.persona} mode="speaking" size={176} />
              </FieldCrtFace>
            </div>
            <CutFrame scale="m" className="ffloor-clip-wrap" innerClassName="screenbed ffloor-clip">
              <div className={replaying ? "ffloor-clip-cap is-free" : "ffloor-clip-cap"}>
                {replaying ? "REPLAYING · FREE" : "SPEAKING"}
              </div>
              <div className="ffloor-clip-text">{nowPlaying.text}</div>
              <div className="ffloor-clip-foot">{nowPlaying.label}</div>
            </CutFrame>
            <div className="ffloor-transport">
              <div className="ffloor-transport-action">
                <button
                  type="button"
                  className="ffloor-stop-round"
                  aria-label="Stop playback"
                  onClick={stopPlayback}
                >
                  <Square size={22} fill="currentColor" aria-hidden />
                </button>
                <span>STOP</span>
              </div>
              <div className="ffloor-clock">
                <b className="sseg">{elapsed}</b>
                <span>{live ? "LIVE" : "CLIP"}</span>
              </div>
              <div className="ffloor-transport-action">
                <button
                  type="button"
                  className="ffloor-replay-key"
                  aria-label="Replay last clip free"
                  disabled={!lastClip}
                  onClick={replayLastMikey}
                >
                  <RotateCcw size={18} aria-hidden />
                </button>
                <span className="is-free">REPLAY · FREE</span>
              </div>
            </div>
          </>
        ) : (
          <div className="ffloor-idle">
            <b>FLOOR CLEAR</b>
            <button
              type="button"
              className="ffloor-replay-key"
              aria-label="Replay last clip free"
              disabled={!lastClip}
              onClick={replayLastMikey}
            >
              <RotateCcw size={18} aria-hidden />
            </button>
            <span>REPLAY · FREE</span>
          </div>
        )}

        <div className="ffloor-route-row">
          <RouteControl compact={false} route={route} onRoute={setAudioRoute} showLabels />
          <div className={route === "phone" ? "is-held" : undefined}>{gateLabel}</div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
