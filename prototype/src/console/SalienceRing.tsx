import { useCallback, useRef } from "react";
import { setThreshold } from "../mock/scenario";
import { useRoom } from "../mock/store";

/** Salience ring with draggable red threshold tab. */
export function SalienceRing() {
  const room = useRoom();
  const { clearPct, threshold, contributors } = room.salience;
  const dragging = useRef(false);

  // Fit board: 35% → 126°, 58% → ~208° → slope ≈ 3.565
  const needleAngle = 3.565 * clearPct + 1.2;
  const tabAngle = 3.565 * threshold + 1.2;

  const onPointer = useCallback(
    (clientX: number, clientY: number, svg: SVGSVGElement) => {
      const rect = svg.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const ang = (Math.atan2(clientY - cy, clientX - cx) * 180) / Math.PI;
      // Convert screen angle to threshold pct matching our tabAngle mapping.
      // tabAngle = 3.565*t + 1.2; invert roughly from SVG rotate about center.
      // SVG rotate(tabAngle) with tab at top → use atan2 from top.
      const fromTop = ((ang + 90 + 360) % 360);
      const pct = Math.round((fromTop - 1.2) / 3.565);
      setThreshold(pct);
    },
    [],
  );

  return (
    <div className="chassis gaugebox">
      <span className="screw tl" />
      <span className="screw tr" />
      <div className="cap">
        <span>SALIENCE RING</span>
        <b>DISTANCE FROM NEEDING YOU</b>
      </div>
      <div className="screenbed" style={{ padding: "12px 8px 10px" }}>
        <svg
          className="salring"
          viewBox="0 0 230 230"
          onPointerDown={(e) => {
            dragging.current = true;
            (e.target as Element).setPointerCapture?.(e.pointerId);
            onPointer(e.clientX, e.clientY, e.currentTarget);
          }}
          onPointerMove={(e) => {
            if (!dragging.current) return;
            onPointer(e.clientX, e.clientY, e.currentTarget);
          }}
          onPointerUp={() => {
            dragging.current = false;
          }}
          style={{ cursor: "grab", touchAction: "none" }}
        >
          <circle cx="115" cy="115" r="106" fill="none" stroke="#31363c" strokeWidth="15" />
          <circle cx="115" cy="115" r="106" fill="none" stroke="#454b53" strokeWidth="2" opacity=".6" />
          <g fill="#565e67">
            <circle cx="115" cy="12" r="3.4" />
            <circle cx="218" cy="115" r="3.4" />
            <circle cx="115" cy="218" r="3.4" />
            <circle cx="12" cy="115" r="3.4" />
          </g>
          <circle
            cx="115"
            cy="115"
            r="86"
            fill="none"
            stroke="#3a2f1c"
            strokeWidth="11"
            pathLength="100"
            strokeDasharray="1.4 1"
            transform="rotate(-90 115 115)"
          />
          <circle
            cx="115"
            cy="115"
            r="86"
            fill="none"
            stroke="#ffb347"
            strokeWidth="11"
            pathLength="100"
            strokeDasharray={`${clearPct * 0.9} ${100 - clearPct * 0.9}`}
            transform="rotate(-90 115 115)"
            style={{ filter: "drop-shadow(0 0 5px rgba(255,160,40,.7))" }}
          />
          <circle
            cx="115"
            cy="115"
            r="64"
            fill="none"
            stroke="#8a5c20"
            strokeWidth="7"
            pathLength="100"
            strokeDasharray="0.9 1.6"
            transform="rotate(-90 115 115)"
            opacity=".8"
          />
          <circle
            cx="115"
            cy="115"
            r="64"
            fill="none"
            stroke="#ff5340"
            strokeWidth="7"
            pathLength="100"
            strokeDasharray={`${threshold} ${100 - threshold}`}
            transform="rotate(-90 115 115)"
            opacity=".85"
            style={{ filter: "drop-shadow(0 0 4px rgba(255,83,64,.6))" }}
          />
          <g transform={`rotate(${tabAngle} 115 115)`} style={{ cursor: "ew-resize" }}>
            <line x1="115" y1="58" x2="115" y2="8" stroke="#ff5340" strokeWidth="2.5" />
            <rect x="107" y="2" width="16" height="15" rx="3" fill="#454b53" stroke="#12151a" />
            <line x1="111" y1="6" x2="119" y2="6" stroke="#12151a" strokeWidth="1.4" />
            <line x1="111" y1="9.5" x2="119" y2="9.5" stroke="#12151a" strokeWidth="1.4" />
            <line x1="111" y1="13" x2="119" y2="13" stroke="#12151a" strokeWidth="1.4" />
          </g>
          <g
            className="needle"
            style={{
              transformOrigin: "115px 115px",
              transform: `rotate(${needleAngle}deg)`,
              animation: room.mood === "arrival" ? "none" : undefined,
            }}
          >
            <line
              x1="115"
              y1="115"
              x2="115"
              y2="36"
              stroke="#ffd894"
              strokeWidth="3"
              style={{ filter: "drop-shadow(0 0 5px rgba(255,200,120,.8))" }}
            />
            <line x1="115" y1="115" x2="115" y2="132" stroke="#8a5c20" strokeWidth="3" />
          </g>
          <circle cx="115" cy="115" r="13" fill="#2b3036" stroke="#12151a" strokeWidth="2" />
          <circle cx="115" cy="115" r="5" fill="#565e67" />
          <text x="35" y="182" fontSize="7.5" letterSpacing="1.5" fill="#ff5340" fontFamily="monospace">
            NEEDS YOU
          </text>
        </svg>
        <div className="salreadout">
          <span className="dotmx ghost">SALIENCE</span>
          <span className="pct">{clearPct}% CLR</span>
          <span className="tag red" style={{ fontSize: 8, whiteSpace: "nowrap" }}>
            TH {threshold} · DRAG
          </span>
        </div>
      </div>
      <div className="screenbed salcauses">
        {contributors.map((c) => (
          <div className="r" key={c.label}>
            <span>{c.label}</span>
            <b className={c.delta < 0 ? "neg" : undefined}>
              {c.delta === 0 ? "−0" : c.delta}
            </b>
          </div>
        ))}
      </div>
    </div>
  );
}
