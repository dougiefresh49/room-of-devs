import type { Craft } from "../mock/types";
import { useRoom } from "../mock/store";
import { useHeldSeconds } from "./useHeldSeconds";

function polar(cx: number, cy: number, salience: number, angleDeg: number, maxR: number) {
  const r = (salience / 100) * maxR;
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

function blipFill(c: Craft): string {
  if (c.state === "needs-you") return "#ff5340";
  if (c.state === "settled") return "#8fe86e";
  if (c.state === "spawning") return "#ffb347";
  return "#ffb347";
}

export interface FieldPlotProps {
  onSelectCraft: (craftId: string) => void;
}

export function FieldPlot({ onSelectCraft }: FieldPlotProps) {
  const room = useRoom();
  const heldSeconds = useHeldSeconds(room.heldQuestion?.heldSince ?? null);
  const cx = 150;
  const cy = 112;
  const maxR = 96;
  const thrR = (room.salience.threshold / 100) * maxR;
  const crafts = room.crafts.filter((c) => c.state !== "empty");

  return (
    <svg viewBox="0 0 300 220" style={{ display: "block", width: "100%" }}>
      <g fill="none" stroke="#3a2f1c" strokeWidth="1">
        <circle cx={cx} cy={cy} r={maxR * 0.44} strokeDasharray="2 4" />
        <circle cx={cx} cy={cy} r={maxR * 0.73} strokeDasharray="2 4" />
        <circle cx={cx} cy={cy} r={maxR} strokeDasharray="2 4" stroke="#4a3c22" />
      </g>
      <circle
        className="thrring"
        cx={cx}
        cy={cy}
        r={thrR}
        fill="none"
        stroke="#ff5340"
        strokeWidth="1.4"
        strokeDasharray="6 5"
        opacity=".8"
      />
      <g className="rsweep">
        <path
          d={`M${cx} ${cy} L${cx} ${cy - maxR} A${maxR} ${maxR} 0 0 0 ${cx - 32} ${cy - maxR + 5} Z`}
          fill="rgba(255,179,71,.05)"
        />
        <line
          x1={cx}
          y1={cy}
          x2={cx}
          y2={cy - maxR}
          stroke="#ffb347"
          strokeWidth="1"
          opacity=".4"
        />
      </g>
      <g>
        <circle
          cx={cx}
          cy={cy}
          r="8"
          fill="none"
          stroke="#ffd894"
          strokeWidth="1.4"
          style={{ filter: "drop-shadow(0 0 6px rgba(255,200,120,.7))" }}
        />
        <line x1={cx} y1={cy - 11} x2={cx} y2={cy + 11} stroke="#ffd894" strokeWidth="1" />
        <line x1={cx - 11} y1={cy} x2={cx + 11} y2={cy} stroke="#ffd894" strokeWidth="1" />
        <text
          x={cx}
          y={cy + 24}
          textAnchor="middle"
          fontFamily="monospace"
          fontSize="8.5"
          fill="#ffd894"
          letterSpacing="1.6"
        >
          YOU
        </text>
      </g>

      {crafts.map((c) => {
        const { x, y } = polar(cx, cy, c.salience, c.plotAngle, maxR);
        const size = c.oneOff ? 4.5 : 6;
        const cls =
          c.state === "needs-you" ? "blip red" : c.state === "settled" ? "blip grn" : "blip";
        const showLabel = c.state === "needs-you" || c.watched || c.state === "spawning";
        const craftHoldSeconds = room.heldQuestion?.craftId === c.id ? heldSeconds : c.holdSeconds;
        const label =
          c.state === "needs-you" ? `${c.callsign} ${fmtHoldShort(craftHoldSeconds)}` : c.callsign;
        const flip = x > cx;
        const anchor = flip ? "end" : "start";
        const rawX = flip ? x - 10 : x + 10;
        const lx = Math.min(Math.max(rawX, 6), 294);
        const ly = y < cy ? y - 10 : y + 20;
        return (
          <g
            key={c.id}
            className={cls}
            fontFamily="monospace"
            role="button"
            tabIndex={0}
            aria-label={`Open ${c.callsign} ${c.ticket}`}
            style={{ cursor: "pointer" }}
            onClick={() => onSelectCraft(c.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelectCraft(c.id);
              }
            }}
          >
            <circle
              className="blip-hit"
              cx={x}
              cy={y + 1}
              r="22"
              fill="transparent"
              pointerEvents="all"
              aria-hidden="true"
            />
            {c.watched ? (
              <circle
                cx={x}
                cy={y + 1}
                r="11"
                fill="none"
                stroke="#ffb347"
                strokeWidth="1"
                strokeDasharray="3 3"
                opacity=".7"
              />
            ) : null}
            {c.state === "spawning" ? (
              <circle
                cx={x}
                cy={y + 1}
                r="10"
                fill="none"
                stroke="#ffb347"
                strokeWidth="1"
                strokeDasharray="2 3"
                opacity=".8"
                style={{ animation: "field-matz 1.4s ease-in-out infinite" }}
              />
            ) : null}
            <path
              className="bcore"
              d={`M${x} ${y} l${size} ${size + 1} -${size} ${size + 1} -${size} -${size + 1} z`}
              fill={blipFill(c)}
            />
            {showLabel ? (
              <text
                x={lx}
                y={ly}
                textAnchor={anchor}
                fontSize="8.5"
                fill={c.state === "needs-you" ? "#ff5340" : "#ffb347"}
                letterSpacing="1"
                style={{ pointerEvents: c.state === "needs-you" || c.watched ? "all" : "none" }}
              >
                {label}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

function fmtHoldShort(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
