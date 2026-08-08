import { CrtFace, Led, SalienceBar } from "@room/ui/rig";
import { ChevronRight } from "lucide-react";
import { AvatarFace } from "../avatars/AvatarFace";
import { PartNo } from "../map/PartNo";
import { replayLastMikey, setAudioRoute, stopPlayback } from "../mock/scenario";
import { useAppState, useFleet, useRoom } from "../mock/store";
import { roomShortLabel } from "../chrome/MastheadTabs";
import { NowPlaying } from "../rig-ext/NowPlaying";

export function DockMiniBar() {
  const fleet = useFleet();
  const room = useRoom();
  const app = useAppState();
  const floorRoom = fleet.audioFloor.roomId ? app.rooms[fleet.audioFloor.roomId] : null;
  const transportRoom = floorRoom ?? room;
  const worst = fleet.rooms.reduce(
    (current, room) =>
      !current || room.salience.clearPct < current.salience.clearPct ? room : current,
    fleet.rooms[0],
  );
  if (!worst) return null;
  const mikeySpeaking = transportRoom.nowPlaying?.persona === "mikey";
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
            <b>
              {roomShortLabel(worst.id)} <ChevronRight size={10} aria-hidden />
            </b>{" "}
            {worst.ticker}
          </span>
        </div>
        <div className="dled">
          <Led tone="green" />
          <Led tone="amber" pulse={mikeySpeaking} />
          <Led tone={needsYou ? "red" : "dim"} pulse={needsYou} />
        </div>
      </div>
      <NowPlaying
        variant="dock"
        nowPlaying={transportRoom.nowPlaying}
        route={fleet.audioFloor.route}
        gateStartedAt={transportRoom.audio.gateStartedAt}
        onStop={stopPlayback}
        onReplay={replayLastMikey}
        onRoute={setAudioRoute}
      />
    </div>
  );
}
