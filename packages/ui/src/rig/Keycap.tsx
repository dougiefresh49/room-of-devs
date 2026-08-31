import { cn } from "../lib/cn.js";

export interface KeycapProps {
  glyph: string;
  label: string;
  /** Right-aligned spoken phrase hint (board `.odim`). */
  hint?: string;
  /** Amber border + needglow pulse — Mikey's recommendation. */
  armed?: boolean;
  onPress?: () => void;
  className?: string;
}

/**
 * Machined option key — board `.optbtn` + `.keycap` (22px face).
 */
export function Keycap({ glyph, label, hint, armed = false, onPress, className }: KeycapProps) {
  return (
    <button
      type="button"
      className={cn("rig-keycap", armed && "rig-keycap--armed", className)}
      onClick={onPress}
    >
      <span className="rig-keycap-glyph">{glyph}</span>
      <span className="rig-keycap-label">{label}</span>
      {hint ? <span className="rig-keycap-hint">{hint}</span> : null}
    </button>
  );
}
