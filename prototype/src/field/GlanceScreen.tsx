import { CutFrame, SalienceBar, Tag, type TagTone } from "@room/ui/rig";
import { AvatarFace } from "../avatars/AvatarFace";
import { FieldCrtFace } from "../rig-ext/FieldCrtFace";
import type { Craft } from "../mock/types";
import { useFleet, useRoom } from "../mock/store";
import type { RoomId } from "../mock/types";
import { roomShortLabel } from "../chrome/MastheadTabs";
import { FieldPlot } from "./FieldPlot";

export interface GlanceScreenProps {
  onOpenNode: (craftId: string) => void;
  onCouple: (roomId: RoomId) => void;
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

export function GlanceScreen({ onOpenNode, onCouple }: GlanceScreenProps) {
  const room = useRoom();
  const fleet = useFleet();
  const { clearPct, threshold, contributors } = room.salience;
  const lit = Math.round((clearPct / 100) * 13);
  const thrSeg = Math.min(12, Math.max(0, Math.round((threshold / 100) * 12)));
  const drag = contributors.find((c) => c.delta < 0);

  const crafts = room.crafts.filter((c) => c.state !== "empty");

  return (
    <div className="screen-body" data-part="F-01">
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
          <FieldPlot onSelectCraft={onOpenNode} />
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
              onClick={() => onOpenNode(c.id)}
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

      {fleet.traffic.filter((row) => row.roomId !== fleet.activeRoomId && row.belowGate).length ? (
        <CutFrame scale="s" className="field-cross-room-wrap" innerClassName="field-cross-room">
          <div className="field-cross-room-head">OTHER ROOMS · ALARM</div>
          {fleet.traffic
            .filter((row) => row.roomId !== fleet.activeRoomId && row.belowGate)
            .slice(0, 2)
            .map((row) => (
              <button
                type="button"
                className="field-cross-room-row"
                key={`${row.roomId}:${row.craftId ?? row.label}`}
                onClick={() => onCouple(row.roomId)}
              >
                <Tag tone="red">{roomShortLabel(row.roomId)}</Tag>
                <span>{row.label}</span>
                <b className="is-red">BELOW GATE</b>
              </button>
            ))}
        </CutFrame>
      ) : null}
    </div>
  );
}
