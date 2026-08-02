import { DialGauge, Odometer } from "@room/ui/rig";
import { PartNo } from "../map/PartNo";
import { aggregateDraw, useRoom, worstGuard } from "../mock/store";

export function TheCore() {
  const { spend } = useRoom();
  // Hex shell = TOTAL draw: the mean of every guard window we meter, so the
  // shell fills as the room as a whole gets expensive, not as one provider does.
  const pct = Math.round(aggregateDraw(spend) * 100);
  // Energy ball = how much of the 7-day window is still ahead of us.
  const left = Math.min(1, Math.max(0, spend.windowResetFraction));
  const worst = worstGuard(spend);

  return (
    <div className="chassis gaugebox">
      <PartNo partNo="S-07" />
      <div className="cap">
        <span>THE CORE</span>
        <b>ENERGY / SPEND GUARD</b>
      </div>
      <div className="screenbed" style={{ padding: "12px 6px 10px" }}>
        <div
          className={`harvester${spend.burning ? " burning" : ""}`}
          style={{
            ["--hv-pct" as string]: `${pct}%`,
            ["--hv-glow" as string]: left,
          }}
        >
          <div className="hv-bezel" />
          <div className="hv-core" />
          <div className="hv-shell" />
          <div className="hv-shell lit" />
        </div>
        <div className="hv-cap">
          LIT HEXES = TOTAL DRAW <b>{pct}%</b> · BALL = <b>
            {spend.windowResetLabel}
          </b> LEFT IN THE 7-DAY WINDOW
          <br />
          TIGHTEST GUARD:{" "}
          <b>
            {worst
              ? `${worst.label} ${worst.window} · ${Math.round(worst.fraction * 100)}%`
              : "—"}
          </b>{" "}
          · FLARE = SPEAKING · GEMINI DIAL RUNS TO OUR SPEND GOAL, NOT A CAP
        </div>
        <div className="gaugerow">
          <DialGauge
            fraction={spend.elevenlabsUsd / spend.elevenlabsCap}
            caption={
              <>
                ELEVENLABS · 30D CYCLE
                <br />
                <b>
                  ${spend.elevenlabsUsd.toFixed(2)} / ${spend.elevenlabsCap} CAP
                </b>
              </>
            }
          />
          <DialGauge
            fraction={spend.geminiUsd / spend.geminiGoalUsd}
            redlineFrom={0.85}
            caption={
              <>
                GEMINI · MONTH TO DATE
                <br />
                <b>
                  ${spend.geminiUsd.toFixed(2)} / GOAL ${spend.geminiGoalUsd}
                </b>
              </>
            }
          />
        </div>
        <div className="spendfoot">
          <span>VOICE CHARS TODAY</span>
          <Odometer value={spend.voiceCharsToday} digits={5} rolling={spend.burning} />
        </div>
      </div>
    </div>
  );
}
