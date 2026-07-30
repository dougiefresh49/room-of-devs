import { AvatarFace } from "../avatars/AvatarFace";
import type { Craft } from "../mock/types";
import { useRoom } from "../mock/store";
import { FieldPlot } from "./FieldPlot";

export interface GlanceScreenProps {
  onSelectCraft: (craftId: string) => void;
}

function stateTag(c: Craft): { label: string; cls: string } {
  if (c.state === "needs-you") return { label: "NEEDS YOU", cls: "tag red" };
  if (c.state === "settled") return { label: "SETTLED", cls: "tag grn" };
  if (c.state === "spawning") return { label: "LAUNCHING", cls: "tag" };
  if (c.watched) return { label: "WATCHED", cls: "tag" };
  return { label: "WORKING", cls: "tag dim" };
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
  const { clearPct, threshold, contributors } = room.salience;
  const lit = Math.round((clearPct / 100) * 13);
  const thrSeg = Math.min(12, Math.max(0, Math.round((threshold / 100) * 12)));
  const drag = contributors.find((c) => c.delta < 0);

  const crafts = room.crafts.filter((c) => c.state !== "empty");

  return (
    <div className="screen-body">
      <div className="salstrip">
        <span className="pct">{clearPct}% CLR</span>
        <div className="salbar" aria-hidden>
          {Array.from({ length: 13 }, (_, i) => {
            const isTh = i === thrSeg;
            const isDim = i >= lit && !isTh;
            return (
              <i
                key={i}
                className={isTh ? "th" : isDim ? "dim" : undefined}
              />
            );
          })}
        </div>
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

      <div style={{ marginTop: 10, position: "relative" }}>
        <FieldPlot onSelectCraft={onSelectCraft} />
      </div>

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
                <div className="face-crt">
                  <AvatarFace persona={c.persona} size={40} />
                </div>
              </div>
              <div className="tmid">
                <span className="callsign">{c.callsign}</span>
                <span className="tid">{c.ticket}</span>
                <div className="ttask">{c.task}</div>
              </div>
              <span className={tag.cls}>{tag.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
