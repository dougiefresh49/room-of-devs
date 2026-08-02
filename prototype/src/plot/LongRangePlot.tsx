import { useCallback, useRef } from "react";
import { setThreshold, setView } from "../mock/scenario";
import { PartNo } from "../map/PartNo";
import { useRoom } from "../mock/store";

function polar(cx: number, cy: number, salience: number, angleDeg: number) {
  const r = (salience / 100) * 240;
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

export function LongRangePlot() {
  const room = useRoom();
  const { threshold } = room.salience;
  const cx = 280;
  const cy = 270;
  const thrR = (threshold / 100) * 240;
  const dragging = useRef(false);

  const onDrag = useCallback(
    (clientX: number, clientY: number, svg: SVGSVGElement) => {
      const rect = svg.getBoundingClientRect();
      const sx = ((clientX - rect.left) / rect.width) * 640;
      const sy = ((clientY - rect.top) / rect.height) * 520;
      const dist = Math.hypot(sx - cx, sy - cy);
      setThreshold(Math.round((dist / 240) * 100));
    },
    [],
  );

  const craftBlips = room.crafts.filter(
    (c) => c.state !== "empty" && (c.planId != null || c.oneOff),
  );

  return (
    <div className="plotwrap">
      <PartNo partNo="S-14" />
      <div className="chassis plotbay">
        <span className="screw tl" />
        <span className="screw tr" />
        <span className="screw bl" />
        <span className="screw br" />
        <div className="baylabel">
          <span>LONG-RANGE PLOT // SALIENCE CARTOGRAPHY</span>
          <span>1 BLIP = 1 MORTAL THREAD</span>
        </div>
        <div className="screenbed plotscr">
          <svg
            viewBox="0 0 640 520"
            onPointerDown={(e) => {
              const t = e.target as Element;
              if (t.closest?.(".thr-hit")) {
                dragging.current = true;
                e.currentTarget.setPointerCapture(e.pointerId);
                onDrag(e.clientX, e.clientY, e.currentTarget);
              }
            }}
            onPointerMove={(e) => {
              if (!dragging.current) return;
              onDrag(e.clientX, e.clientY, e.currentTarget);
            }}
            onPointerUp={() => {
              dragging.current = false;
            }}
          >
            <g fill="none" stroke="#3a2f1c" strokeWidth="1">
              <circle cx={cx} cy={cy} r="90" strokeDasharray="2 4" />
              <circle cx={cx} cy={cy} r="140" strokeDasharray="2 4" />
              <circle cx={cx} cy={cy} r="190" strokeDasharray="2 4" />
              <circle cx={cx} cy={cy} r="240" strokeDasharray="2 4" stroke="#4a3c22" />
            </g>
            <g fontFamily="monospace" fontSize="7" fill="#8a5c20" letterSpacing="1">
              <text x="373" y="266">
                25
              </text>
              <text x="423" y="266">
                50
              </text>
              <text x="473" y="266">
                75
              </text>
              <text x="212" y="24">
                100 CLR — SETTLE-SIDE
              </text>
            </g>

            <circle
              className="thrring thr-hit"
              cx={cx}
              cy={cy}
              r={thrR}
              fill="none"
              stroke="#ff5340"
              strokeWidth="1.6"
              strokeDasharray="7 5"
              opacity=".8"
              style={{ cursor: "grab" }}
            />
            <g
              className="thr-hit"
              transform={`rotate(${-38} ${cx} ${cy})`}
              style={{ cursor: "grab" }}
            >
              <rect
                x={cx - 8}
                y={cy - thrR - 8}
                width="16"
                height="12"
                rx="2"
                fill="#454b53"
                stroke="#12151a"
              />
            </g>
            <text
              x={cx + thrR * 0.65}
              y={cy - thrR * 0.55}
              fontFamily="monospace"
              fontSize="7.5"
              fill="#ff5340"
              letterSpacing="1.5"
            >
              SPEAK GATE · {threshold} CLR
            </text>

            <g className="rsweep">
              <path
                d={`M${cx} ${cy} L${cx} ${cy - 240} A240 240 0 0 0 ${cx - 64} ${cy - 231} Z`}
                fill="rgba(255,179,71,.05)"
              />
              <line
                x1={cx}
                y1={cy}
                x2={cx}
                y2={cy - 240}
                stroke="#ffb347"
                strokeWidth="1"
                opacity=".4"
              />
            </g>

            {/* spine structure */}
            <g transform="translate(548,96)">
              <rect x="0" y="0" width="12" height="300" rx="3" fill="#31363c" stroke="#12151a" />
              <g fontFamily="monospace" fontSize="6.5" letterSpacing="1">
                {room.plans
                  .filter((p) => p.dock !== "birth")
                  .slice(0, 5)
                  .map((p, i) => {
                    const y = 18 + i * 42;
                    const live = p.dock === "live";
                    const queued = p.dock === "queued";
                    return (
                      <g key={p.id}>
                        <rect
                          className={live ? "splan" : undefined}
                          x="-46"
                          y={y}
                          width="40"
                          height={live ? 20 : 16}
                          rx="2"
                          fill={
                            live
                              ? "rgba(255,150,30,.08)"
                              : queued
                                ? "none"
                                : "#23272c"
                          }
                          stroke={live ? "#ffb347" : queued ? "#8a5c20" : "#15181c"}
                          strokeDasharray={queued ? "3 3" : undefined}
                        />
                        <text
                          x="-46"
                          y={y - 6}
                          fill={live ? "#ffb347" : queued ? "#8a5c20" : "#565c63"}
                        >
                          {p.id} {p.dock.toUpperCase()}
                        </text>
                        <line
                          x1="-6"
                          y1={y + 8}
                          x2="0"
                          y2={y + 8}
                          stroke={live ? "#ffb347" : "#8a5c20"}
                          strokeDasharray={queued ? "2 2" : undefined}
                        />
                      </g>
                    );
                  })}
                <text x="-46" y="220" fill="#3d6b2c">
                  ▣ ARCHIVE DRIFT
                </text>
              </g>
              <text
                x="24"
                y="80"
                fontFamily="monospace"
                fontSize="8"
                fill="#9aa2ab"
                letterSpacing="3"
                writingMode="tb"
              >
                SPINE // ROOM-OF-DEVS
              </text>
            </g>

            {/* second room */}
            <g transform="translate(60,58)" opacity=".55">
              <rect x="0" y="0" width="8" height="70" rx="2" fill="#2b3036" stroke="#15181c" />
              <rect x="-26" y="12" width="22" height="12" rx="2" fill="#23272c" stroke="#15181c" />
              <text x="-28" y="90" fontFamily="monospace" fontSize="6.5" fill="#565c63" letterSpacing="1">
                ROOM // PODLINK · QUIET
              </text>
            </g>

            {/* conduits from spine active plan to craft */}
            <g className="pl-conduit" fill="none" strokeWidth="1">
              {craftBlips
                .filter((c) => !c.oneOff && c.planId)
                .map((c) => {
                  const p = polar(cx, cy, c.salience, c.plotAngle);
                  return (
                    <path key={c.id} d={`M502 166 L${p.x} ${p.y}`} />
                  );
                })}
            </g>

            {/* YOU */}
            <g>
              <circle
                cx={cx}
                cy={cy}
                r="10"
                fill="none"
                stroke="#ffd894"
                strokeWidth="1.5"
                style={{ filter: "drop-shadow(0 0 6px rgba(255,200,120,.7))" }}
              />
              <line x1={cx} y1={cy - 14} x2={cx} y2={cy + 14} stroke="#ffd894" strokeWidth="1" />
              <line x1={cx - 14} y1={cy} x2={cx + 14} y2={cy} stroke="#ffd894" strokeWidth="1" />
              <text
                x={cx}
                y={cy + 32}
                textAnchor="middle"
                fontFamily="monospace"
                fontSize="8"
                fill="#ffd894"
                letterSpacing="2"
              >
                YOU
              </text>
            </g>

            {craftBlips.map((c) => {
              const p = polar(cx, cy, c.salience, c.plotAngle);
              const red = c.state === "needs-you" || c.salience < threshold;
              const grn = c.state === "settled";
              const cls = `blip${red ? " red" : ""}${grn ? " grn drift" : ""}`;
              return (
                <g
                  key={c.id}
                  className={cls}
                  fontFamily="monospace"
                  onDoubleClick={() => setView("node", c.id)}
                  opacity={c.oneOff ? 0.8 : 1}
                >
                  {c.oneOff ? (
                    <path
                      d={`M${p.x} ${p.y - 8} l6 7 -6 7 -6 -7 z`}
                      fill="none"
                      stroke="#ffb347"
                      strokeWidth="1.2"
                      strokeDasharray="2 2"
                    />
                  ) : (
                    <path
                      className="bcore"
                      d={`M${p.x} ${p.y - 8} l7 8 -7 8 -7 -8 z`}
                      fill={red ? "#ff5340" : grn ? "#8fe86e" : "#ffb347"}
                    />
                  )}
                  {c.watched ? (
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r="14"
                      fill="none"
                      stroke="#ffb347"
                      strokeWidth="1"
                      strokeDasharray="3 3"
                      opacity=".7"
                    />
                  ) : null}
                  <line
                    x1={p.x + 8}
                    y1={p.y + 4}
                    x2={p.x + 28}
                    y2={p.y - 12}
                    stroke={red ? "#ff5340" : "#8a5c20"}
                    strokeWidth="1"
                    opacity=".55"
                  />
                  <text
                    x={p.x + 32}
                    y={p.y - 14}
                    fontSize="7.5"
                    fill={red ? "#ff5340" : grn ? "#8fe86e" : "#ffb347"}
                    letterSpacing="1"
                  >
                    {c.callsign} · {c.ticket}
                  </text>
                  <text
                    x={p.x + 32}
                    y={p.y - 3}
                    fontSize="6.5"
                    fill={red ? "#b0402f" : "#8a5c20"}
                    letterSpacing="1"
                  >
                    {c.oneOff
                      ? "NO CONDUIT — DIES ON DELIVERY"
                      : c.state === "needs-you"
                        ? c.lastStamp
                        : c.watched
                          ? "WATCH ORDER — NARRATED"
                          : c.state.toUpperCase()}
                  </text>
                </g>
              );
            })}

            {/* launch rim */}
            <g fontFamily="monospace">
              <circle
                cx="118"
                cy="424"
                r="7"
                fill="none"
                stroke="#8a5c20"
                strokeWidth="1.2"
                strokeDasharray="3 3"
              />
              <text x="86" y="447" fontSize="6.5" fill="#8a5c20" letterSpacing="1">
                LAUNCH RIM — NEW CRAFT
              </text>
            </g>

            {/* future callout */}
            <g fontFamily="monospace" opacity=".8">
              <circle cx="497" cy="447" r="2.2" fill="none" stroke="#565c63" strokeWidth="1" />
              <line
                x1="499"
                y1="449"
                x2="524"
                y2="472"
                stroke="#565c63"
                strokeWidth="1"
                strokeDasharray="3 3"
              />
              <path
                d="M322 478 h298 l8 8 v14 h-298 l-8 -8 z"
                fill="rgba(0,0,0,.35)"
                stroke="#2f343a"
              />
              <text x="330" y="489" fontSize="6.5" fill="#8a5c20" letterSpacing="1">
                FUTURE: 10,000-FT VIEW — ROOMS AS A STARMAP
              </text>
              <text x="330" y="498" fontSize="6.5" fill="#565c63" letterSpacing="1">
                NOTED FOR LATER · NOT BUILT THIS ROUND
              </text>
            </g>
          </svg>
        </div>
      </div>

      <div className="zoomladder">
        <button
          type="button"
          className={`chassis zstep${room.view === "plot" ? " active-zoom" : ""}`}
          onClick={() => setView("plot")}
        >
          <div className="zcap">
            <span>
              ZOOM 1 · <b>PLOT</b>
            </span>
            <span>ALL ROOMS</span>
          </div>
          <div className="zbody">
            EVERY CRAFT IN FLIGHT · POSITION = SALIENCE · <b>THE GATE AT MAP SCALE</b>.
          </div>
        </button>
        <div className="zlink">▼ HARD CUT ▼</div>
        <button
          type="button"
          className={`chassis zstep${room.view === "console" ? " active-zoom" : ""}`}
          onClick={() => setView("console")}
        >
          <div className="zcap">
            <span>
              ZOOM 2 · <b>RAIL</b>
            </span>
            <span>ONE ROOM</span>
          </div>
          <div className="zbody">
            CONSOLE — PLAN BLOCKS AS BLUEPRINT CARDS, CRAFT AS TERMINAL NODES.
          </div>
        </button>
        <div className="zlink">▼</div>
        <button
          type="button"
          className={`chassis zstep${room.view === "node" ? " active-zoom" : ""}`}
          onClick={() => {
            const id =
              room.focusCraftId ??
              room.crafts.find((c) => c.state !== "empty")?.id ??
              null;
            setView("node", id);
          }}
        >
          <div className="zcap">
            <span>
              ZOOM 3 · <b>NODE</b>
            </span>
            <span>ONE THREAD</span>
          </div>
          <div className="zbody">
            THE OPEN NODE — LIVE TAIL, DIFF, SPEND. <b>A BLIP IS A NODE IS A FACE.</b>
          </div>
        </button>
        <div className="screenbed plotlegend">
          ◆ <b>CRAFT</b> = MORTAL THREAD · ▭ <b>STRUCTURE</b> = PLAN ON A SPINE
          <br />
          ◇ DASHED = ONE-OFF, NO TICKET
          <br />
          <span className="dimx">○ WATCHER CRAFT — GATED ON #75</span>
          <br />
          RED RING = <b>SPEAK GATE</b> · DRAG TO SET · DOUBLE-CLICK BLIP → NODE
        </div>
      </div>
    </div>
  );
}
