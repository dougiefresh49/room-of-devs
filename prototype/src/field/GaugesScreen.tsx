import type { GuardWindow } from "../mock/types";
import { useRoom } from "../mock/store";
import { SpendDial } from "./SpendDial";

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

  // Dials go to the ONLY two providers with a session reset — the blue arc
  // has no meaning anywhere else. Main amber arc = the long window that keeps
  // climbing (Fable 7D / 7D); blue = this session's share, which zeroes.
  const claude = spend.guards.find((g) => g.id === "claude");
  const codex = spend.guards.find((g) => g.id === "codex");
  const sessionIds = new Set(["claude", "codex"]);
  const boardGuards = spend.guards.filter((g) => !sessionIds.has(g.id));

  const longWindow = (g: typeof claude) =>
    g ? (g.windows[g.windows.length - 1] ?? g.windows[0]) : undefined;
  const claudeLong = longWindow(claude);
  const codexLong = longWindow(codex);

  return (
    <div className="screen-body gauges-body">
      <div className="dotmx ghost gboard-cap">
        SESSION RESETS · <b>AMBER</b>=WINDOW · <i>BLUE</i>=SESSION
      </div>

      <div className="fdialrow">
        {claude && claudeLong ? (
          <SpendDial
            fraction={claudeLong.fraction}
            sessionFraction={claude.sessionFraction}
            caption={
              <>
                CLAUDE · FABLE 7D
                <br />
                <b>{claudeLong.readout}</b> · 5H{" "}
                {Math.round((claude.sessionFraction ?? 0) * 100)}%
              </>
            }
          />
        ) : null}
        {codex && codexLong ? (
          <SpendDial
            fraction={codexLong.fraction}
            sessionFraction={codex.sessionFraction}
            caption={
              <>
                CODEX · 7D
                <br />
                <b>{codexLong.readout}</b> · SESS{" "}
                {Math.round((codex.sessionFraction ?? 0) * 100)}%
              </>
            }
          />
        ) : null}
      </div>

      <div className="dotmx ghost gboard-cap" style={{ marginTop: 12 }}>
        GUARD BOARD · ROLLING WINDOWS · NO SESSION RESET
      </div>

      <div className="gboard">
        {boardGuards.map((g) => (
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
        className="dotmx ghost gboard-cap"
        style={{ marginTop: 8, marginBottom: 0, fontSize: 7 }}
      >
        GEMINI END-STOP IS OUR OWN <b>GOAL</b>, NOT A PROVIDER CAP · REAL
        BILLING-CYCLE DATA TBD
      </div>

      <div
        className="spendfoot fcard"
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
