import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { SalienceRing } from "./SalienceRing";
import { ThreeDials } from "./ThreeDials";
import { TheCore } from "./TheCore";

interface InstrumentBayProps {
  open: boolean;
  onToggle: () => void;
  clearPct: number;
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
