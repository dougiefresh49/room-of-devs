import { DialGauge, Odometer } from "@room/ui/rig";
import { useRoom, worstGuard } from "../mock/store";

export function TheCore() {
  const { spend } = useRoom();
  // The hex shell reads the tightest guard anywhere, not a month average —
  // the month is only the right window for Cursor and ElevenLabs.
  const worst = worstGuard(spend);
  const pct = Math.round((worst?.fraction ?? spend.monthFraction) * 100);

  return (
    <div className="chassis gaugebox">
      <div className="cap">
        <span>THE CORE</span>
        <b>ENERGY / SPEND GUARD</b>
      </div>
      <div className="screenbed" style={{ padding: "12px 6px 10px" }}>
        <div
          className={`harvester${spend.burning ? " burning" : ""}`}
          style={{ ["--hv-pct" as string]: `${pct}%` }}
        >
          <div className="hv-bezel" />
          <div className="hv-core" />
          <div className="hv-shell" />
          <div className="hv-shell lit" />
        </div>
        <div className="hv-cap">
          TIGHTEST GUARD:{" "}
          <b>
            {worst ? `${worst.label} ${worst.window} · ${pct}%` : `${pct}%`}
          </b>{" "}
          · FLARE = SPEAKING NOW
        </div>
        <div className="gaugerow">
          <DialGauge
            fraction={spend.elevenlabsUsd / spend.elevenlabsCap}
            caption={
              <>
                ELEVENLABS · MONTH
                <br />
                <b>
                  ${spend.elevenlabsUsd.toFixed(2)} / ${spend.elevenlabsCap} CAP
                </b>
              </>
            }
          />
          <DialGauge
            fraction={spend.geminiCalls / spend.geminiRedline}
            redlineFrom={0.85}
            caption={
              <>
                GEMINI · TODAY
                <br />
                <b>
                  {spend.geminiCalls} CALLS · REDLINE {spend.geminiRedline}
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
