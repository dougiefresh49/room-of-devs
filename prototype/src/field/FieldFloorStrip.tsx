import { useLayoutEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { replayLastMikey, setAudioRoute, stopPlayback } from "../mock/scenario";
import { useAppState, useFleet, useRoom } from "../mock/store";
import { NowPlaying } from "../rig-ext/NowPlaying";

/**
 * Mobile always keeps a route control: truly cold rooms get the minimal
 * route + FLOOR CLEAR hairline. Desktop can omit a cold strip because its
 * faceplate and dock already provide independent route controls.
 */
export function FieldFloorStrip({ portaled = false, raised = false }: { portaled?: boolean; raised?: boolean }) {
  const room = useRoom();
  const fleet = useFleet();
  const app = useAppState();
  const floorRoom = fleet.audioFloor.roomId ? app.rooms[fleet.audioFloor.roomId] : null;
  const transportRoom = floorRoom ?? room;

  const [portalStyle, setPortalStyle] = useState<CSSProperties | null>(null);

  useLayoutEffect(() => {
    if (!portaled) return;
    const screen = document.querySelector<HTMLElement>(".field-root .fscr");
    if (!screen) return;
    const setBounds = () => {
      const rect = screen.getBoundingClientRect();
      setPortalStyle({
        position: "fixed",
        zIndex: 65,
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        padding: 0,
        pointerEvents: "none",
      });
    };
    setBounds();
    const observer = "ResizeObserver" in window ? new ResizeObserver(setBounds) : null;
    observer?.observe(screen);
    window.addEventListener("resize", setBounds);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", setBounds);
    };
  }, [portaled]);

  const strip = (
    <div className={`ffloor-strip${raised ? " is-raised" : ""}`}>
      <NowPlaying
        variant="strip"
        nowPlaying={transportRoom.nowPlaying}
        lastClip={transportRoom.lastClip}
        route={fleet.audioFloor.route}
        gateStartedAt={transportRoom.audio.gateStartedAt}
        onStop={stopPlayback}
        onReplay={replayLastMikey}
        onRoute={setAudioRoute}
      />
    </div>
  );
  if (!portaled) return strip;
  if (!portalStyle) return null;
  return createPortal(
    <div
      className={`field-root field-floor-portal${document.querySelector(".field-root.is-bare") ? " is-bare" : ""}`}
      style={portalStyle}
    >
      {strip}
    </div>,
    document.body,
  );
}
