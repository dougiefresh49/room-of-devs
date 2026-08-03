import { HexLayer } from "@room/ui/rig";
import { ChevronRight } from "lucide-react";
import { PartNo } from "../map/PartNo";
import { useRoom } from "../mock/store";
import { PlanCard } from "./PlanCard";
import { ThreadNode } from "./ThreadNode";

export function SpineRail() {
  const room = useRoom();
  const live = room.plans.find((p) => p.dock === "live");
  const queued = room.plans.filter((p) => p.dock === "queued" || p.dock === "birth");
  const settled = room.plans.filter((p) => p.dock === "settled");
  const liveCrafts = room.crafts.filter(
    (c) => c.planId === live?.id && c.state !== "empty",
  );
  const empty = room.crafts.find((c) => c.state === "empty");
  const oneOffs = room.crafts.filter((c) => c.oneOff);

  return (
    <div className="bay spinebay">
      <PartNo partNo="S-03" />
      <div className="baylabel">
        <span>THE SPINE // ENERGIZED RAIL — PLANS DOCK TO IT, MORTAL THREADS FLY THEM</span>
        <span>PLANS 0004–0008</span>
      </div>
      <div className="legendstrip">
        <span style={{ color: "var(--steel)", fontWeight: 700 }}>HOW TO READ A NODE:</span>
        <span className="lgitem">
          <span>
            <b>PILOT</b> = PERSONA
          </span>
        </span>
        <span className="arr">
          <ChevronRight size={11} aria-hidden />
        </span>
        <span className="lgitem">
          <span>
            <b>CRAFT</b> = T-####
          </span>
        </span>
        <span className="arr">
          <ChevronRight size={11} aria-hidden />
        </span>
        <span className="lgitem">
          <span>
            <b>DOCK</b> = PLAN ON RAIL
          </span>
        </span>
      </div>
      <div className="spine-grid">
        <div className="rail">
          <div className="railcap">
            <span className="rivet" />
          </div>
          <div className="railshaft">
            <div className="railchannel" />
            <div className="railbeam" />
            <HexLayer intensity="dim" className="railhex" />
            <HexLayer intensity="bright" banded className="railhex bright" />
            <div className="railword">THE&nbsp;SPINE</div>
          </div>
          <div className="railbase">
            <div className="haz" />
          </div>
        </div>
        <div className="spinecol">
          {queued.map((p) => (
            <PlanCard key={p.id} plan={p} />
          ))}
          {live ? <PlanCard plan={live} /> : null}
          <div className="threads">
            {liveCrafts.map((c) => (
              <ThreadNode key={c.id} craft={c} />
            ))}
            {oneOffs.map((c) => (
              <ThreadNode key={c.id} craft={c} />
            ))}
            {empty ? <ThreadNode craft={empty} /> : null}
          </div>
          {settled.map((p) => (
            <PlanCard key={p.id} plan={p} />
          ))}
        </div>
      </div>
    </div>
  );
}
