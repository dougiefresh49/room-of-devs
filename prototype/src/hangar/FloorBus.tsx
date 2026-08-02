import { Waveform } from "@room/ui/rig";
import type { AudioFloor, RoomBerth } from "../mock/types";
import { roomShortLabel } from "./BerthTabs";

export function FloorBus({ audioFloor, rooms }: { audioFloor: AudioFloor; rooms: RoomBerth[] }) {
  const holderRoomId = audioFloor.roomId;
  const numbered = rooms.filter((room) => room.berth != null);
  const holderIndex = numbered.findIndex((room) => room.id === holderRoomId);
  const stop = holderIndex < 0 ? 50 : ((holderIndex + 0.5) / Math.max(1, numbered.length)) * 100;
  const live = holderRoomId != null;

  return (
    <aside
      className={`hangar-floor-bus${live ? " is-live" : " is-cold"}`}
      aria-label="Global audio floor"
    >
      <span className="hangar-floor-core" aria-hidden />
      {live ? (
        <span className="hangar-floor-beam" style={{ top: `${stop}%` }}>
          <span>{roomShortLabel(holderRoomId ?? "")}</span>
        </span>
      ) : null}
      <span className="hangar-floor-label">AUDIO FLOOR BUS · ONE VOICE · GLOBAL</span>
      {live ? (
        <div className="hangar-floor-wave" style={{ top: `${Math.min(92, stop + 8)}%` }}>
          <Waveform active bars={5} />
        </div>
      ) : null}
    </aside>
  );
}
