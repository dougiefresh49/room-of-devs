import { Waveform } from "@room/ui/rig";
import type { AudioFloor, RoomBerth } from "../mock/types";
import { roomShortLabel } from "../chrome/MastheadTabs";

export function FloorBus({
  audioFloor,
  rooms,
  holderSpeaking,
}: {
  audioFloor: AudioFloor;
  rooms: RoomBerth[];
  holderSpeaking: boolean;
}) {
  const holderRoomId = audioFloor.roomId;
  const numbered = rooms.filter((room) => room.berth != null);
  const holderIndex = numbered.findIndex((room) => room.id === holderRoomId);
  const stop = holderIndex < 0 ? 50 : ((holderIndex + 0.5) / Math.max(1, numbered.length)) * 100;
  const held = holderRoomId != null;
  const stateClass = !held ? "is-cold" : holderSpeaking ? "is-speaking" : "is-held";

  return (
    <aside
      className={`hangar-floor-bus ${stateClass}`}
      aria-label={`Global audio floor: ${held ? `${roomShortLabel(holderRoomId)} holds${holderSpeaking ? " and is speaking" : " idle"}` : "cold"}`}
    >
      <span className="hangar-floor-core" aria-hidden />
      {held ? (
        <span className="hangar-floor-beam" style={{ top: `${stop}%` }}>
          <span>{roomShortLabel(holderRoomId ?? "").slice(0, 1)}</span>
        </span>
      ) : null}
      <span className="hangar-floor-label">AUDIO FLOOR BUS · ONE VOICE · GLOBAL</span>
      {held ? (
        <div className="hangar-floor-wave" style={{ top: `${stop}%` }}>
          <Waveform active={holderSpeaking} bars={5} />
        </div>
      ) : (
        <span className="hangar-floor-idle" aria-hidden>
          ···
        </span>
      )}
    </aside>
  );
}
