import { CutFrame, SalienceBar, Tag, type TagTone } from "@room/ui/rig";
import { AvatarFace } from "../avatars/AvatarFace";
import { FieldCrtFace } from "../rig-ext/FieldCrtFace";
import type { Craft } from "../mock/types";
import { coupleRoom } from "../mock/scenario";
import { useFleet, useRoom } from "../mock/store";
import { roomShortLabel } from "../chrome/MastheadTabs";
import { PartNo } from "../map/PartNo";
import { FieldPlot } from "./FieldPlot";

export interface GlanceScreenProps {
  onSelectCraft: (craftId: string) => void;
}

function stateTag(c: Craft): { label: string; tone: TagTone } {
  if (c.state === "needs-you") return { label: "NEEDS YOU", tone: "red" };
  if (c.state === "settled") return { label: "SETTLED", tone: "green" };
  if (c.state === "spawning") return { label: "LAUNCHING", tone: "amber" };
  if (c.watched) return { label: "WATCHED", tone: "amber" };
  return { label: "WORKING", tone: "dim" };
}

function rowClass(c: Craft): string {
  const bits = ["trow"];
  if (c.state === "needs-you") bits.push("needsyou");
  if (c.state === "settled") bits.push("settled");
  if (c.state === "spawning") bits.push("spawning");
  return bits.join(" ");
}

export function GlanceScreen({ onSelectCraft }: GlanceScreenProps) {
  const room = useRoom();
  const fleet = useFleet();
  const { clearPct, threshold, contributors } = room.salience;
  const lit = Math.round((clearPct / 100) * 13);
  const thrSeg = Math.min(12, Math.max(0, Math.round((threshold / 100) * 12)));
  const drag = contributors.find((c) => c.delta < 0);

  const crafts = room.crafts.filter((c) => c.state !== "empty");

  return (
    <div className="screen-body">
      <PartNo partNo="F-01" />
      <nav className="field-room-pills" aria-label="Fleet rooms">
        {fleet.rooms
          .filter((berth) => berth.berth != null)
          .sort((a, b) => (a.berth ?? 0) - (b.berth ?? 0))
          .map((berth) => {
            const active = berth.id === fleet.activeRoomId;
            return (
              <button
                type="button"
                key={berth.id}
                className={active ? "is-active" : undefined}
                onClick={() => coupleRoom(berth.id)}
                aria-current={active ? "page" : undefined}
              >
                <span>{roomShortLabel(berth.id)}</span>
                <b>{berth.salience.clearPct}%</b>
                {berth.counts.needsYou > 0 ? <i role="img" aria-label="Needs you" /> : null}
              </button>
            );
          })}
      </nav>

      <div className="salstrip">
        <span className="pct">{clearPct}% CLR</span>
        <SalienceBar lit={lit} threshold={thrSeg} segments={13} />
        <span className="cap">
          SALIENCE
          <br />
          TH {threshold}
          {drag ? (
            <>
              {" · "}
              <b style={{ color: "var(--red)" }}>
                DRAG {drag.delta > 0 ? `+${drag.delta}` : drag.delta}
              </b>
            </>
          ) : null}
        </span>
      </div>

      <CutFrame
        scale="m"
        className="plotbay-f"
        style={{ marginTop: 10, position: "relative" }}
        innerClassName="fcard"
      >
        <div style={{ padding: 4 }}>
          <FieldPlot onSelectCraft={onSelectCraft} />
        </div>
      </CutFrame>

      <div className="trows">
        {crafts.map((c) => {
          const tag = stateTag(c);
          return (
            <button
              type="button"
              key={c.id}
              className={rowClass(c)}
              onClick={() => onSelectCraft(c.id)}
              style={{ width: "100%", textAlign: "left" }}
            >
              <div className="tface">
                <FieldCrtFace size={40} scanlines>
                  <AvatarFace persona={c.persona} size={40} />
                </FieldCrtFace>
              </div>
              <div className="tmid">
                <span className="callsign">{c.callsign}</span>
                <span className="tid">{c.ticket}</span>
                <div className="ttask">{c.task}</div>
              </div>
              <Tag tone={tag.tone}>{tag.label}</Tag>
            </button>
          );
        })}
      </div>

      <CutFrame scale="s" className="field-cross-room-wrap" innerClassName="field-cross-room">
        <div className="field-cross-room-head">OTHER ROOMS — ATTRIBUTED, NOT RENDERED</div>
        {fleet.traffic
          .filter((row) => row.roomId !== fleet.activeRoomId)
          .slice(0, 3)
          .map((row) => (
            <div className="field-cross-room-row" key={`${row.roomId}:${row.craftId ?? row.label}`}>
              <Tag tone={row.belowGate ? "red" : "dim"}>{roomShortLabel(row.roomId)}</Tag>
              <span>{row.label}</span>
              <b className={row.belowGate ? "is-red" : undefined}>
                {row.belowGate ? "BELOW GATE" : `${row.salience}% CLR`}
              </b>
            </div>
          ))}
      </CutFrame>
    </div>
  );
}
