import type { GuardWindow } from "../mock/types";
import { useRoom } from "../mock/store";

function odoDigits(n: number): string[] {
  return String(Math.max(0, Math.floor(n))).padStart(5, "0").split("");
}

/** One window's fill bar. Red once it's inside the last 15% of its cap. */
function GuardBar({ w }: { w: GuardWindow }) {
  const frac = Math.max(0, Math.min(1, w.fraction));
  const hot = frac >= 0.85;
  return (
    <div className={`gbar${hot ? " hot" : ""}`}>
      <div className="gbar-head">
        <span className="gw">{w.window}</span>
        <span className="gv">{w.readout}</span>
      </div>
      <div className="gtrack">
        <i style={{ width: `${Math.round(frac * 100)}%` }} />
        <u />
      </div>
    </div>
  );
}

export function GaugesScreen() {
  const room = useRoom();
  const { spend, turnChip } = room;
  const digits = odoDigits(spend.voiceCharsToday);
  const burning = spend.burning;

  return (
    <div className="screen-body">
      <div className="dotmx ghost gboard-cap">GUARD BOARD · BY PROVIDER</div>

      <div className="gboard">
        {spend.guards.map((g) => (
          <div
            key={g.id}
            className={`gtile${
              g.windows.some((w) => w.fraction >= 0.85) ? " hot" : ""
            }`}
          >
            <div className="gname">{g.label}</div>
            {g.windows.map((w) => (
              <GuardBar key={w.window} w={w} />
            ))}
          </div>
        ))}
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
        DIALS · READ-ONLY
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
    </div>
  );
}
