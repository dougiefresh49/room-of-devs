import { Sheet, SheetContent, SheetTitle } from "@room/ui";
import { Led } from "@room/ui/rig";
import { LayoutGrid } from "lucide-react";
import { roomShortLabel } from "../chrome/MastheadTabs";
import { useFleet } from "../mock/store";
import type { RoomBerth, RoomId } from "../mock/types";

function RoomRow({ room, coupled, onPress }: {
  room: RoomBerth;
  coupled?: boolean;
  onPress: () => void;
}) {
  return (
    <button type="button" className={coupled ? "is-coupled" : undefined} onClick={onPress}>
      <Led tone={room.counts.needsYou > 0 ? "red" : room.berth != null ? "amber" : "dim"} />
      <span>
        <b>{roomShortLabel(room.id)}</b>
        <small>{room.manifest.name}</small>
      </span>
      <em>{room.salience.clearPct}%</em>
    </button>
  );
}

export function FieldPlaceSheet({
  open,
  onOpenChange,
  onCouple,
  onOpenHangar,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCouple: (roomId: RoomId) => void;
  onOpenHangar: () => void;
}) {
  const fleet = useFleet();
  const coupled = fleet.rooms.find((room) => room.id === fleet.activeRoomId);
  const others = fleet.rooms
    .filter((room) => room.id !== fleet.activeRoomId)
    .sort((a, b) => b.counts.needsYou - a.counts.needsYou || a.salience.clearPct - b.salience.clearPct);
  const berthCount = fleet.rooms.filter((room) => room.berth != null).length;
  const scratchCount = fleet.rooms.length - berthCount;
  const redCount = fleet.rooms.filter((room) => room.counts.needsYou > 0).length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showClose={false}
        className="screenbed field-bounds-sheet field-placesheet field-sheet-open"
        overlayClassName="field-sheet-overlay"
      >
        <button type="button" className="nodesheet-pull" aria-label="Close room menu" onClick={() => onOpenChange(false)}>
          <span aria-hidden />
        </button>
        <SheetTitle className="visually-hidden">Rooms</SheetTitle>
        <div className="froom-pop-cap">COUPLED</div>
        {coupled ? <RoomRow room={coupled} coupled onPress={() => onOpenChange(false)} /> : null}
        <div className="froom-rule" />
        <div className="froom-pop-cap">OTHER ROOMS</div>
        {others.map((room) => (
          <RoomRow
            key={room.id}
            room={room}
            onPress={() => {
              onOpenChange(false);
              onCouple(room.id);
            }}
          />
        ))}
        <div className="froom-rule" />
        <button
          type="button"
          className="froom-hangar-entry"
          onClick={() => {
            onOpenChange(false);
            onOpenHangar();
          }}
        >
          <LayoutGrid size={16} aria-hidden />
          <span>
            <b>THE HANGAR</b>
            <small>{berthCount} BERTHS · {scratchCount} SCRATCH · {redCount} RED</small>
          </span>
          <em>▸</em>
        </button>
        <div className="froom-rule" />
        <div className="froom-pop-cap">LINK</div>
        <div className="froom-link"><Led tone="green" /> SSE LINK · CONNECTED</div>
      </SheetContent>
    </Sheet>
  );
}
