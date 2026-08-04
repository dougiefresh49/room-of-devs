import { Toaster, toast } from "@room/ui";
import { CutFrame, Led, Tag } from "@room/ui/rig";
import { ArrowLeft, LayoutGrid } from "lucide-react";
import { manifestFromDraft, manifestPath } from "../hangar/commission/ManifestPreview";
import { openCommission, strikeCommission, useFleet } from "../mock/store";
import type { RoomId } from "../mock/types";
import { FieldBerthRow } from "./FieldBerthRow";
import { FieldLamps } from "./FieldRoomMenu";

interface FieldHangarProps {
  returnLabel: string;
  onBack: () => void;
  onCouple: (roomId: RoomId) => void;
}

export function FieldHangar({ returnLabel, onBack, onCouple }: FieldHangarProps) {
  const fleet = useFleet();
  const durable = fleet.rooms
    .filter((room) => room.berth != null)
    .sort(
      (a, b) => b.counts.needsYou - a.counts.needsYou || a.salience.clearPct - b.salience.clearPct,
    );
  const scratch = fleet.rooms.filter((room) => room.berth == null);
  const floor = fleet.rooms.find((room) => room.id === fleet.audioFloor.roomId);
  const berthCount = `${durable.length} BERTHS${scratch.length ? ` · ${scratch.length} SCRATCH` : ""}`;

  const strike = () => {
    const receipt = strikeCommission();
    if (!receipt) return;
    toast(
      receipt.ceremony === "full"
        ? "MANIFEST CHECKED IN · BERTH ADDED"
        : "SCRATCH BERTH STRUCK · DIES ON DELIVERY",
    );
  };

  return (
    <section className="fhangar" aria-label="The Hangar">
      <div className="fhangar-backbar">
        <button type="button" onClick={onBack}>
          <ArrowLeft size={15} /> BACK TO {returnLabel}
        </button>
        <FieldLamps />
      </div>
      <div className="fhangar-scroll screen-body">
        <header className="fhangar-head">
          <span>
            <b>THE HANGAR</b>
            <small>{berthCount}</small>
          </span>
          <span className="fhangar-floor">
            FLOOR <Led tone={floor ? "amber" : "dim"} pulse={Boolean(floor)} />{" "}
            {floor?.manifest.name ?? "CLEAR"}
          </span>
        </header>

        <div className="fhangar-cap">NEEDS YOU FIRST</div>
        <div className="fhangar-berths">
          {durable.map((room) => (
            <FieldBerthRow
              key={room.id}
              berth={room}
              activeRoomId={fleet.activeRoomId}
              floorRoomId={fleet.audioFloor.roomId}
              onCouple={onCouple}
            />
          ))}
        </div>

        {scratch.length ? (
          <>
            <div className="fhangar-cap scratch">◇ SCRATCH · DIES ON DELIVERY</div>
            <div className="fhangar-berths">
              {scratch.map((room) => (
                <FieldBerthRow
                  key={room.id}
                  berth={room}
                  activeRoomId={fleet.activeRoomId}
                  floorRoomId={fleet.audioFloor.roomId}
                  onCouple={onCouple}
                />
              ))}
            </div>
          </>
        ) : null}

        {fleet.commission ? (
          <CutFrame scale="s" className="field-commission-draft" innerClassName="fcard">
            <div className="field-commission-draft-head">
              <span>NEW ROOM DRAFT · READ-ONLY OUT HERE</span>
              <Tag tone="hot">SOURCE · {fleet.commission.source.toUpperCase()}</Tag>
            </div>
            <b className="field-commission-path">{manifestPath(fleet.commission)}</b>
            <pre>{JSON.stringify(manifestFromDraft(fleet.commission), null, 2)}</pre>
            <div className="field-commission-confirm">
              <button type="button" onClick={strike}>
                SAY “STRIKE IT”
              </button>
              <a href="/">ADJUST DIALS AT THE RIG</a>
            </div>
          </CutFrame>
        ) : (
          <button
            type="button"
            className="screenbed fhangar-commission"
            onClick={() => openCommission("voice")}
          >
            <LayoutGrid size={20} />
            <span>
              <b>COMMISSION A ROOM</b>
              <small>Mikey drafts the manifest; lock the dials back at the rig.</small>
            </span>
            <i>▸</i>
          </button>
        )}
      </div>
      <Toaster className="toaster group field-toaster" position="top-center" closeButton />
    </section>
  );
}
