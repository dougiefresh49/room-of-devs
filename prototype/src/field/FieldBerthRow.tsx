import { CutFrame, Led, SalienceBar, Tag } from "@room/ui/rig";
import { AvatarFace } from "../avatars/AvatarFace";
import { roomShortLabel } from "../chrome/MastheadTabs";
import type { RoomBerth, RoomId } from "../mock/types";
import { FieldCrtFace } from "../rig-ext/FieldCrtFace";

interface FieldBerthRowProps {
  berth: RoomBerth;
  activeRoomId: RoomId;
  floorRoomId: RoomId | null;
  onCouple: (roomId: RoomId) => void;
}

export function FieldBerthRow({ berth, activeRoomId, floorRoomId, onCouple }: FieldBerthRowProps) {
  const scratch = berth.berth == null;
  const row = (
    <div
      className={`fberth${scratch ? " is-scratch" : ""}${berth.counts.needsYou ? " needs-you" : ""}`}
    >
      <span className="fberth-num">
        {scratch ? "◇" : `B-${String(berth.berth).padStart(2, "0")}`}
      </span>
      <FieldCrtFace size={32} scanlines>
        <AvatarFace persona={berth.manifest.cast.lead} size={32} />
      </FieldCrtFace>
      <span className="fberth-main">
        <b>{roomShortLabel(berth.id)}</b>
        <small>
          {berth.counts.working} CRAFT · {berth.counts.needsYou} RED · {berth.counts.watchers}{" "}
          WATCHER
        </small>
      </span>
      <span className="fberth-salience">
        <SalienceBar
          lit={Math.round((berth.salience.clearPct / 100) * 7)}
          threshold={Math.round(0.35 * 6)}
          segments={7}
        />
        <b>{berth.salience.clearPct}%</b>
      </span>
      <span className="fberth-flags">
        {floorRoomId === berth.id ? <Led tone="amber" pulse title="Holds audio floor" /> : null}
        {activeRoomId === berth.id ? <Tag>COUPLED</Tag> : null}
      </span>
    </div>
  );

  return (
    <CutFrame scale="s" className="fberth-wrap" innerClassName="fberth-shell">
      {scratch ? (
        row
      ) : (
        <button
          type="button"
          onClick={() => onCouple(berth.id)}
          aria-label={`Couple ${berth.manifest.name}`}
        >
          {row}
        </button>
      )}
    </CutFrame>
  );
}
