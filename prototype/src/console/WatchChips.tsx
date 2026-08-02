import { PartNo } from "../map/PartNo";
import { useRoom } from "../mock/store";

export function WatchChips() {
  const room = useRoom();
  const watched = room.crafts.filter((c) => c.watched);
  if (watched.length === 0 && !room.liveClip) return null;
  return (
    <>
      <PartNo partNo="S-09" bindHousing={false} />
      {watched.map((c) => (
        <div className="watchchip" key={c.id}>
          <span className="eye" /> WATCH ORDER · {c.ticket} {c.task.split(":")[0]?.toUpperCase()} ·
          SAY “STAND DOWN” TO CANCEL
        </div>
      ))}
      {room.liveClip ? (
        <div className="watchchip">
          <span className="eye" /> {room.liveClip}
        </div>
      ) : null}
    </>
  );
}
