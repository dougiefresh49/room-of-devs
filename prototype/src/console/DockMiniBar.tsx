import { CrtFace, Led, SalienceBar } from "@room/ui/rig";
import { AvatarFace } from "../avatars/AvatarFace";
import { useRoom } from "../mock/store";

export function DockMiniBar() {
  const room = useRoom();
  const mikeySpeaking = room.speakingPersona === "mikey";
  const lit = Math.round((room.salience.clearPct / 100) * 16);
  const th = Math.round((room.salience.threshold / 100) * 16);

  return (
    <div className="chassis dock proto-dock">
      <div className="facewrap">
        <CrtFace size={52} scanlines>
          <AvatarFace
            persona="mikey"
            mode={
              room.mood === "the-lull"
                ? "stoked"
                : mikeySpeaking
                  ? "speaking"
                  : "idle"
            }
            size={52}
          />
        </CrtFace>
      </div>
      <div className="dockscr screenbed">
        <SalienceBar lit={lit} threshold={th} segments={16} />
        <div className="tick">
          <span>{room.dockTicker}</span>
        </div>
        <div className="dled">
          <Led tone="green" />
          <Led tone="amber" pulse={mikeySpeaking} />
          <Led tone={room.dockLedRed || room.mood === "arrival" ? "red" : "dim"} pulse={room.mood === "arrival"} />
        </div>
      </div>
    </div>
  );
}
