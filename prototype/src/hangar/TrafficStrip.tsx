import { ScreenBed, Tag } from "@room/ui/rig";
import type { FleetState, FloorState } from "../mock/types";
import { roomShortLabel } from "./BerthTabs";

const FLOOR_LABEL: Record<FloorState, string> = {
  has: "HAS FLOOR",
  queued: "QUEUED FOR FLOOR",
  lull: "AT THE LULL",
};

export function TrafficStrip({ fleet }: { fleet: FleetState }) {
  const rows = [...fleet.traffic].sort((a, b) => a.salience - b.salience);
  return (
    <ScreenBed sweep scanlines className="hangar-traffic">
      <div className="hangar-traffic-head">
        <span>SHARED TRAFFIC — ONE SALIENCE QUEUE · WORST FIRST</span>
        <Tag tone={fleet.audioFloor.roomId ? "hot" : "dim"}>
          AUDIO FLOOR · {fleet.audioFloor.roomId ? roomShortLabel(fleet.audioFloor.roomId) : "COLD"}
        </Tag>
      </div>
      <div className="hangar-traffic-rows">
        {rows.map((row) => (
          <div
            className={`hangar-traffic-row${row.belowGate ? " below-gate" : ""}`}
            key={`${row.roomId}:${row.craftId ?? row.label}`}
          >
            <Tag tone={row.belowGate ? "red" : "amber"}>{roomShortLabel(row.roomId)}</Tag>
            <span className="hangar-traffic-label">{row.label}</span>
            <Tag tone={row.belowGate ? "red" : "dim"}>{row.salience}% CLR</Tag>
            <Tag tone={row.belowGate ? "red" : "dim"}>
              {row.belowGate ? "BELOW GATE" : "ABOVE GATE"}
            </Tag>
            <Tag tone={row.floorState === "has" ? "hot" : "dim"}>{FLOOR_LABEL[row.floorState]}</Tag>
          </div>
        ))}
      </div>
      <div className="hangar-gate-note">
        ONE GATE, FLEET-WIDE · RED ROWS ARE EXACTLY WHAT MIKEY MAY RAISE UNPROMPTED · THRESHOLD{" "}
        {fleet.threshold}%
      </div>
    </ScreenBed>
  );
}
