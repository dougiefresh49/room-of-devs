import { Led, Waveform } from "@room/ui/rig";
import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { roomShortLabel } from "../chrome/MastheadTabs";
import { useAppState, useFleet, useRoom } from "../mock/store";
import { MacGlyph, PhoneGlyph, formatElapsed } from "../rig-ext/NowPlaying";
import type { FieldScreen } from "./FieldDock";

export function FieldTopBar({
  screen,
  hangarOpen,
  onOpenPlaces,
  onOpenFloor,
}: {
  screen: FieldScreen;
  hangarOpen: boolean;
  onOpenPlaces: () => void;
  onOpenFloor: () => void;
}) {
  const room = useRoom();
  const fleet = useFleet();
  const app = useAppState();
  const [now, setNow] = useState(() => Date.now());
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const floorRoom = fleet.audioFloor.roomId ? app.rooms[fleet.audioFloor.roomId] : null;
  const transportRoom = floorRoom ?? room;
  const nowPlaying = transportRoom.nowPlaying;

  useEffect(() => {
    if (!nowPlaying) return;
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [nowPlaying]);

  const rooms = [...fleet.rooms].sort(
    (a, b) => b.counts.needsYou - a.counts.needsYou || a.salience.clearPct - b.salience.clearPct,
  );
  const shownRooms = rooms.length > 4 ? rooms.slice(0, 3) : rooms.slice(0, 4);
  const redCount = rooms.filter((candidate) => candidate.counts.needsYou > 0).length;
  const roomLabel = roomShortLabel(fleet.activeRoomId);
  const elapsed = nowPlaying ? formatElapsed(nowPlaying.startedAt, now) : null;
  const cancelPress = () => {
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  };

  return (
    <header className="ftop">
      <button
        type="button"
        className="ftop-room"
        aria-label={`Room ${roomLabel}; ${redCount} rooms need you; open room and screen menu`}
        onPointerDown={(event) => {
          start.current = { x: event.clientX, y: event.clientY };
          suppressClick.current = false;
          timer.current = window.setTimeout(() => {
            suppressClick.current = true;
            start.current = null;
            window.dispatchEvent(new CustomEvent("field:open-deck"));
          }, 600);
        }}
        onPointerMove={(event) => {
          const origin = start.current;
          if (origin && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 8) cancelPress();
        }}
        onPointerUp={cancelPress}
        onPointerCancel={cancelPress}
        onClick={(event) => {
          if (suppressClick.current) {
            event.preventDefault();
            suppressClick.current = false;
            return;
          }
          onOpenPlaces();
        }}
      >
        <span className="ftop-fleet" aria-hidden>
          {shownRooms.map((candidate) => {
            const coupled = candidate.id === fleet.activeRoomId;
            return (
              <Led
                key={candidate.id}
                tone={candidate.counts.needsYou > 0 ? "red" : candidate.berth != null ? "amber" : "dim"}
                pulse={candidate.counts.needsYou > 0}
                className={coupled ? "is-coupled" : undefined}
              />
            );
          })}
          {rooms.length > 4 ? <i>+{rooms.length - 3}</i> : null}
        </span>
        <b>{roomLabel}</b>
        <ChevronDown size={10} aria-hidden />
      </button>
      <div className="ftop-title">{hangarOpen ? "HANGAR" : screen.toUpperCase()}</div>
      <button
        type="button"
        className={`ftop-pip${nowPlaying ? " is-playing" : ""}`}
        onClick={onOpenFloor}
        aria-label={nowPlaying
          ? `${nowPlaying.persona} has the floor, ${elapsed}. Open audio floor.`
          : "Audio floor clear. Open audio floor."}
      >
        <span className="ftop-pip-key">
          {nowPlaying ? <Waveform active bars={4} /> : fleet.audioFloor.route === "phone" ? <PhoneGlyph /> : <MacGlyph />}
        </span>
        {elapsed ? <span className="sseg">{elapsed}</span> : null}
      </button>
    </header>
  );
}
