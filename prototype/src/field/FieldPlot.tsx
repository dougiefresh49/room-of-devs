import type { Craft, Plan } from "../mock/types";
import { useRoom } from "../mock/store";

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
  const cx = 150;
  const cy = 128;
  const maxR = 118;
  const thrR = (room.salience.threshold / 100) * maxR;
  const crafts = room.crafts.filter((c) => c.state !== "empty");
  const plans = room.plans.filter((p) => p.dock !== "birth");
  const livePlan = plans.find((p) => p.dock === "live");

  const spineX = 272;
  const spineTop = 52;

  const planBlocks = plans.slice(0, 4).map((p: Plan, i) => ({
    plan: p,
    y: spineTop + 34 + i * 22,
  }));

  return (
    <svg viewBox="0 0 300 256" style={{ display: "block", width: "100%" }}>
      <g fill="none" stroke="#3a2f1c" strokeWidth="1">
        <circle cx={cx} cy={cy} r="52" strokeDasharray="2 4" />
        <circle cx={cx} cy={cy} r="86" strokeDasharray="2 4" />
        <circle cx={cx} cy={cy} r="118" strokeDasharray="2 4" stroke="#4a3c22" />
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
      <text
        x="10"
        y="26"
        fontFamily="monospace"
        fontSize="8.5"
        fill="#ff5340"
        letterSpacing="1.2"
      >
        RED RING = SPEAK GATE · {room.salience.threshold}
      </text>
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

      <g transform={`translate(${spineX},${spineTop})`}>
        <rect
          x="0"
          y="0"
          width="8"
          height="150"
          rx="2"
          fill="#31363c"
          stroke="#12151a"
        />
        {planBlocks.map(({ plan, y }, i) => (
          <g key={plan.id}>
            <rect
              className={plan.dock === "live" ? "splan" : undefined}
              x="-30"
              y={y - spineTop}
              width="26"
              height={plan.dock === "live" ? 14 : 11}
              rx="2"
              fill={
                plan.dock === "live"
                  ? "rgba(255,150,30,.08)"
                  : plan.dock === "queued"
                    ? "#23272c"
                    : "#1a1d21"
              }
              stroke={plan.dock === "live" ? "#ffb347" : "#15181c"}
            />
            {i === 0 || plan.dock === "live" ? (
              <text
                x="-30"
                y={y - spineTop - 3}
                fontFamily="monospace"
                fontSize="8.5"
                fill="#ffb347"
                letterSpacing="1"
              >
                {plan.id}
              </text>
            ) : null}
          </g>
        ))}
      </g>

      <g className="pl-conduit" fill="none" strokeWidth="1">
        {crafts.map((c) => {
          const { x, y } = polar(cx, cy, c.salience, c.plotAngle, maxR);
          const liveY =
            planBlocks.find((b) => b.plan.id === (c.planId ?? livePlan?.id))?.y ??
            spineTop + 40;
          return (
            <path
              key={`conduit-${c.id}`}
              d={`M${spineX} ${liveY} L${x} ${y}`}
            />
          );
        })}
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
          y={cy + 25}
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
          c.state === "needs-you"
            ? "blip red"
            : c.state === "settled"
              ? "blip grn"
              : "blip";
        const label =
          c.state === "needs-you"
            ? `${c.callsign} ${fmtHoldShort(c.holdSeconds)}`
            : c.watched
              ? `${c.callsign} · WATCHED`
              : c.state === "settled"
                ? `${c.callsign} · SETTLED`
                : c.state === "spawning"
                  ? `${c.callsign} · LAUNCH`
                  : `${c.callsign} · QUIET`;
        const lx = x < cx ? x - 66 : x + 8;
        const ly = y < cy ? y - 8 : y + 18;
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
            <text
              x={lx}
              y={ly}
              fontSize="8.5"
              fill={
                c.state === "needs-you"
                  ? "#ff5340"
                  : c.state === "settled"
                    ? "#3d6b2c"
                    : "#ffb347"
              }
              letterSpacing="1"
              style={{ pointerEvents: "none" }}
            >
              {label}
            </text>
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
