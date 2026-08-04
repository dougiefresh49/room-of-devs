import { Popover, PopoverContent, PopoverTrigger } from "@room/ui";
import { Led } from "@room/ui/rig";
import { ChevronDown, ChevronUp, LayoutGrid } from "lucide-react";
import { useState } from "react";
import { roomShortLabel } from "../chrome/MastheadTabs";
import { useFleet } from "../mock/store";
import type { RoomId } from "../mock/types";

interface FieldRoomMenuProps {
  onCouple: (roomId: RoomId) => void;
  onOpenHangar: () => void;
}

export function FieldRoomMenu({ onCouple, onOpenHangar }: FieldRoomMenuProps) {
  const fleet = useFleet();
  const [open, setOpen] = useState(false);
  const coupled = fleet.rooms.find((room) => room.id === fleet.activeRoomId);
  const others = fleet.rooms
    .filter((room) => room.berth != null && room.id !== fleet.activeRoomId)
    .sort(
      (a, b) => b.counts.needsYou - a.counts.needsYou || a.salience.clearPct - b.salience.clearPct,
    );
  const remoteNeedsYou = others.some((room) => room.counts.needsYou > 0);
  const redCount = fleet.rooms.filter((room) => room.counts.needsYou > 0).length;
  const durableCount = fleet.rooms.filter((room) => room.berth != null).length;
  const scratchCount = fleet.rooms.length - durableCount;
  const roomLabel = roomShortLabel(fleet.activeRoomId);
  const berthCount = `${durableCount} BERTHS${scratchCount ? ` · ${scratchCount} SCRATCH` : ""}`;

  return (
    <div className="froom-row">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          className="froom-menu"
          aria-label={`Switch room, current ${roomLabel}${remoteNeedsYou ? ", another room needs you" : ""}`}
        >
          <span title="SSE link — connected" aria-label="SSE link — connected">
            <Led tone="green" />
          </span>
          <b>{roomLabel}</b>
          {open ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
          {remoteNeedsYou ? <i aria-hidden /> : null}
        </PopoverTrigger>
        <PopoverContent
          className="screenbed froom-pop"
          side="bottom"
          align="start"
          sideOffset={4}
          collisionPadding={10}
        >
          <div className="froom-pop-cap">COUPLED</div>
          {coupled ? (
            <button type="button" className="is-coupled" onClick={() => setOpen(false)}>
              <Led tone={coupled.counts.needsYou > 0 ? "red" : "amber"} />
              <span>
                <b>{roomShortLabel(coupled.id)}</b>
                <small>{coupled.manifest.name}</small>
              </span>
              <em>{coupled.salience.clearPct}%</em>
            </button>
          ) : null}
          <div className="froom-rule" />
          {others.map((room) => (
            <button
              type="button"
              key={room.id}
              onClick={() => {
                setOpen(false);
                onCouple(room.id);
              }}
            >
              <Led tone={room.counts.needsYou > 0 ? "red" : "dim"} />
              <span>
                <b>{roomShortLabel(room.id)}</b>
                <small>{room.ticker}</small>
              </span>
              <em>{room.salience.clearPct}%</em>
            </button>
          ))}
          <div className="froom-rule" />
          <button
            type="button"
            className="froom-hangar-entry"
            onClick={() => {
              setOpen(false);
              onOpenHangar();
            }}
          >
            <LayoutGrid size={14} aria-hidden />
            <span>
              <b>THE HANGAR</b>
              <small>
                {berthCount} · {redCount} RED
              </small>
            </span>
            <em>▸</em>
          </button>
        </PopoverContent>
      </Popover>
    </div>
  );
}
