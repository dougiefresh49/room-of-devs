import { useRoom } from "../mock/store";

function odoDigits(n: number): string[] {
  return String(Math.max(0, Math.floor(n))).padStart(5, "0").split("");
}

export function GaugesScreen() {
  const room = useRoom();
  const { spend, turnChip } = room;
  const elFrac = Math.min(1, spend.elevenlabsUsd / spend.elevenlabsCap);
  const gemFrac = Math.min(1, spend.geminiCalls / spend.geminiRedline);
  const elNeedle = -90 + elFrac * 180;
  const gemNeedle = -90 + gemFrac * 180;
  const elDash = `${Math.round(elFrac * 100)} ${100 - Math.round(elFrac * 100)}`;
  const gemDash = `${Math.round(gemFrac * 85)} ${100 - Math.round(gemFrac * 85)}`;
  const digits = odoDigits(spend.voiceCharsToday);
  const burning = spend.burning;

  return (
    <div className="screen-body">
      <div className="gaugerow">
        <div className={`dial${burning ? " burning" : ""}`}>
          <svg viewBox="0 0 132 76">
            <path
              d="M14 62 A52 52 0 0 1 118 62"
              fill="none"
              stroke="#3a2f1c"
              strokeWidth="9"
              pathLength="100"
              strokeDasharray="1.6 1"
            />
            <path
              d="M14 62 A52 52 0 0 1 118 62"
              fill="none"
              stroke="#ffb347"
              strokeWidth="9"
              pathLength="100"
              strokeDasharray={elDash}
            />
            <g transform={`rotate(${elNeedle} 66 62)`}>
              <line
                x1="66"
                y1="62"
                x2="66"
                y2="18"
                stroke="#ffd894"
                strokeWidth="2.5"
              />
            </g>
            <circle
              cx="66"
              cy="62"
              r="7"
              fill="#2b3036"
              stroke="#12151a"
              strokeWidth="1.5"
            />
          </svg>
          <div className="cap2">
            ELEVENLABS · MONTH
            <br />
            <b>
              ${spend.elevenlabsUsd.toFixed(2)} / ${spend.elevenlabsCap} CAP
            </b>
          </div>
        </div>
        <div className={`dial${burning ? " burning" : ""}`}>
          <svg viewBox="0 0 132 76">
            <path
              d="M14 62 A52 52 0 0 1 118 62"
              fill="none"
              stroke="#3a2f1c"
              strokeWidth="9"
              pathLength="100"
              strokeDasharray="1.6 1"
            />
            <path
              d="M14 62 A52 52 0 0 1 118 62"
              fill="none"
              stroke="#ffb347"
              strokeWidth="9"
              pathLength="100"
              strokeDasharray={gemDash}
            />
            <path
              d="M14 62 A52 52 0 0 1 118 62"
              fill="none"
              stroke="#ff5340"
              strokeWidth="9"
              pathLength="100"
              strokeDasharray="12 88"
              strokeDashoffset="-85"
              opacity=".8"
            />
            <g transform={`rotate(${gemNeedle} 66 62)`}>
              <line
                x1="66"
                y1="62"
                x2="66"
                y2="18"
                stroke="#ffd894"
                strokeWidth="2.5"
              />
            </g>
            <circle
              cx="66"
              cy="62"
              r="7"
              fill="#2b3036"
              stroke="#12151a"
              strokeWidth="1.5"
            />
          </svg>
          <div className="cap2">
            GEMINI · TODAY
            <br />
            <b>
              {spend.geminiCalls} CALLS · REDLINE {spend.geminiRedline}
            </b>
          </div>
        </div>
      </div>

      <div
        className="spendfoot"
        style={{
          border: "1px solid rgba(255,179,71,.15)",
          borderRadius: 5,
          background: "rgba(0,0,0,.3)",
        }}
      >
        <span>VOICE CHARS TODAY</span>
        <span className="odo amberodo">
          {digits.map((d, i) => (
            <b
              key={i}
              className={
                burning && i === digits.length - 1 ? "tick" : undefined
              }
            >
              {burning && i === digits.length - 1 ? (
                <i>
                  0<br />1<br />2<br />3<br />4<br />5<br />6<br />7<br />8<br />
                  9<br />0
                </i>
              ) : (
                <i>{d}</i>
              )}
            </b>
          ))}
        </span>
      </div>

      <div
        className="dotmx ghost"
        style={{ margin: "14px 2px 2px", fontSize: 8, letterSpacing: ".2em" }}
      >
        THE THREE DIALS — READ-ONLY OUT HERE
      </div>

      <div className="knobs">
        <div className="knob k1">
          <div className="kface" />
          <div className="kl">1 · CEREMONY</div>
          <div className="kv">FULL</div>
          <div className="khome">
            <b>HOME: PLAN CARD</b>
          </div>
        </div>
        <div className="knob k2">
          <div className="kface" />
          <div className="kl">2 · VOICE</div>
          <div className="kv">MIKEY</div>
          <div className="khome">
            <b>HOME: FACEPLATE</b>
          </div>
        </div>
        <div className="knob k3">
          <div className="kface" />
          <div className="kl">3 · BRAIN</div>
          <div className="kv">FLASH→OPUS</div>
          <div className="khome">
            <b>
              HOME: TURN CHIP · {turnChip.model} ${turnChip.costUsd.toFixed(3)}
            </b>
          </div>
        </div>
      </div>

      <div
        className="watchchip"
        style={{ borderColor: "#3a3f45", color: "var(--steel-dim)" }}
      >
        <span
          className="eye"
          style={{ background: "var(--steel-dim)", boxShadow: "none", animation: "none" }}
        />
        TO CHANGE A DIAL: SAY IT — “LIGHT CEREMONY ON 0009” · EVERY STEP-UP LOGGED
        WITH COST
      </div>

      <div className="routechip" style={{ marginTop: "auto" }}>
        <span
          className="led"
          style={{
            flex: "none",
            background: "var(--haz)",
            boxShadow: "0 0 6px rgba(217,160,33,.7)",
          }}
        />
        DEEP SURFACES — TAILS, DIFFS, BLUEPRINTS — LIVE ON THE RIG.{" "}
        <b>MIKEY: “IT&apos;S ON THE BIG BOARD.”</b>
      </div>
    </div>
  );
}
