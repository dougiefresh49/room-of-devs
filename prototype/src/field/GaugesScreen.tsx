import { SessionDial } from "../rig-ext/SessionDial";
import type { GuardWindow } from "../mock/types";
import { useRoom } from "../mock/store";
import { CutFrame, Odometer } from "@room/ui/rig";
import { Popover, PopoverContent, PopoverTrigger } from "@room/ui";

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
    <div className="screen-body gauges-body" data-part="F-05">
      <div className="dotmx ghost gboard-cap gauge-cap-info">
        <span>SPEND DIALS</span>
        <Popover>
          <PopoverTrigger className="gauge-info-trigger" aria-label="About spend dials">
            ⓘ
          </PopoverTrigger>
          <PopoverContent className="gauge-info-popover" align="start" sideOffset={6}>
            <p><b>AMBER ARC</b> — the provider&apos;s window meter, keeps climbing until its cycle resets.</p>
            <p><b>BLUE ARC</b> — this session&apos;s usage; resets each session. Only Claude and Codex have sessions.</p>
            <p><b>CURSOR / ELEVENLABS</b> — 30-day rolling cycles.</p>
            <p><b>GEMINI</b> — month-to-date spend against OUR OWN goal, not a provider cap. Real billing-cycle data TBD.</p>
          </PopoverContent>
        </Popover>
      </div>

      <div className="fdialrow">
        {claude && claudeLong ? (
          <SessionDial
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
          <SessionDial
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
        GUARD BOARD
      </div>

      <div className="gboard">
        {boardGuards.map((g) => (
          <CutFrame
            key={g.id}
            scale="s"
            className={
              g.windows.some((w) => w.fraction >= 0.85) ? "gtile-wrap hot" : "gtile-wrap"
            }
            innerClassName="gtile"
          >
            <div className="gname">{g.label}</div>
            {g.windows.map((w) => (
              <GuardBar key={w.window} w={w} />
            ))}
          </CutFrame>
        ))}
      </div>

      <CutFrame scale="s" className="spendfoot-wrap" innerClassName="spendfoot fcard">
        <span>VOICE CHARS TODAY</span>
        <Odometer
          value={spend.voiceCharsToday}
          digits={5}
          rolling={burning}
        />
      </CutFrame>

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
