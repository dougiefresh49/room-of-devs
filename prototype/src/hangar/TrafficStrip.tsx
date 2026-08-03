import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@room/ui";
import { ScreenBed, Tag } from "@room/ui/rig";
import { useState } from "react";
import type { FleetState, FloorState } from "../mock/types";
import { roomShortLabel } from "../chrome/MastheadTabs";

const FLOOR_LABEL: Record<FloorState, string> = {
  has: "HAS FLOOR",
  queued: "QUEUED FOR FLOOR",
  lull: "AT THE LULL",
};

export function TrafficStrip({ fleet }: { fleet: FleetState }) {
  const [open, setOpen] = useState(true);
  const rows = [...fleet.traffic].sort((a, b) => a.salience - b.salience);
  const worst = rows[0];
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <ScreenBed sweep scanlines className="hangar-traffic">
        <div className="hangar-traffic-head">
          <span>ATTENTION QUEUE — ALL ROOMS · WORST FIRST</span>
          <div className="hangar-traffic-tools">
            <Tag tone={fleet.audioFloor.roomId ? "hot" : "dim"}>
              AUDIO FLOOR ·{" "}
              {fleet.audioFloor.roomId ? roomShortLabel(fleet.audioFloor.roomId) : "COLD"}
            </Tag>
            <CollapsibleTrigger asChild>
              <button type="button" className="hangar-traffic-fold">
                {open ? "FOLD −" : "UNFOLD +"}
              </button>
            </CollapsibleTrigger>
          </div>
        </div>
        {!open && worst ? (
          <div className="hangar-traffic-summary">
            <b>{roomShortLabel(worst.roomId)}</b>
            <span>· {worst.salience}% CLR</span>
            <span>· {worst.belowGate ? "BELOW GATE" : "ABOVE GATE"}</span>
            {rows.length > 1 ? <span>· +{rows.length - 1}</span> : null}
          </div>
        ) : null}
        <CollapsibleContent>
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
                <Tag tone={row.floorState === "has" ? "hot" : "dim"}>
                  {FLOOR_LABEL[row.floorState]}
                </Tag>
              </div>
            ))}
          </div>
          <div className="hangar-gate-note">
            ONE GATE, FLEET-WIDE · RED ROWS ARE EXACTLY WHAT MIKEY MAY RAISE UNPROMPTED · THRESHOLD{" "}
            {fleet.threshold}%
          </div>
        </CollapsibleContent>
      </ScreenBed>
    </Collapsible>
  );
}
