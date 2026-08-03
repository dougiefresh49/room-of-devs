import { CrtFace, Led, SalienceBar } from "@room/ui/rig";
import { AvatarFace } from "../avatars/AvatarFace";
import { PartNo } from "../map/PartNo";
import { useFleet } from "../mock/store";
import { roomShortLabel } from "../chrome/MastheadTabs";

export function DockMiniBar() {
  const fleet = useFleet();
  const worst = fleet.rooms.reduce(
    (current, room) =>
      !current || room.salience.clearPct < current.salience.clearPct ? room : current,
    fleet.rooms[0],
  );
  if (!worst) return null;
  const mikeySpeaking = fleet.audioFloor.persona === "mikey";
  const lit = Math.round((worst.salience.clearPct / 100) * 16);
  const th = Math.round((fleet.threshold / 100) * 16);
  const needsYou = worst.counts.needsYou > 0;

  return (
    <div className="chassis dock proto-dock">
      <PartNo partNo="S-13" />
      <div className="facewrap">
        <CrtFace size={52} scanlines>
          <AvatarFace persona="mikey" mode={mikeySpeaking ? "speaking" : "idle"} size={52} />
        </CrtFace>
      </div>
      <div className="dockscr screenbed">
        <SalienceBar lit={lit} threshold={th} segments={16} />
        <div className="tick">
          <span>
            <b>{roomShortLabel(worst.id)} ▸</b> {worst.ticker}
          </span>
        </div>
        <div className="dled">
          <Led tone="green" />
          <Led tone="amber" pulse={mikeySpeaking} />
          <Led tone={needsYou ? "red" : "dim"} pulse={needsYou} />
        </div>
      </div>
    </div>
  );
}
