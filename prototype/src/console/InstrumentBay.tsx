import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { SalienceRing } from "./SalienceRing";
import { TheCore } from "./TheCore";

interface InstrumentBayProps {
  open: boolean;
  onToggle: () => void;
  clearPct: number;
}

function ThreeDials() {
  return (
    <div className="instr-plate">
      <span className="screw bl" />
      <span className="screw br" />
      <div className="cap">
        <span>THE THREE DIALS</span>
        <b>EACH LIVES SOMEWHERE VISIBLE</b>
      </div>
      <div className="knobs">
        <div className="knob k1">
          <div className="kface" />
          <div className="kl">1 · CEREMONY</div>
          <div className="kv">FULL</div>
          <div className="khome">
            PER THREAD · <b>HOME: THE PLAN CARD</b>
          </div>
        </div>
        <div className="knob k2">
          <div className="kface" />
          <div className="kl">2 · VOICE</div>
          <div className="kv">MIKEY</div>
          <div className="khome">
            ATTACHMENT · <b>HOME: THE FACEPLATE</b>
          </div>
        </div>
        <div className="knob k3">
          <div className="kface" />
          <div className="kl">3 · BRAIN / TURN</div>
          <div className="kv">FLASH → OPUS</div>
          <div className="khome">
            ROUTING TABLE · <b>HOME: THE TURN CHIP</b>
          </div>
        </div>
      </div>
    </div>
  );
}

export function InstrumentBay({ open, onToggle, clearPct }: InstrumentBayProps) {
  const label = open ? "STOW INSTRUMENTS" : "DEPLOY INSTRUMENTS";
  return (
    <section className={`instr-bay${open ? "" : " is-stowed"}`}>
      <header className="bay-cap">
        <button
          type="button"
          className="bay-latch"
          aria-expanded={open}
          aria-label={label}
          title={label}
          onClick={onToggle}
        >
          {open ? <PanelRightClose size={13} /> : <PanelRightOpen size={13} />}
          {open ? <span>STOW</span> : null}
        </button>
        <span className="bay-label">INSTRUMENTS</span>
        <span className="bay-value sseg">
          {clearPct}%<span className="bay-clarity"> CLR</span>
        </span>
      </header>
      {open ? (
        <div className="bay-plates">
          <SalienceRing />
          <TheCore />
          <ThreeDials />
        </div>
      ) : null}
    </section>
  );
}
