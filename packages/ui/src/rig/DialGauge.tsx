import type { ReactNode } from "react";
import { cn } from "../lib/cn.js";

export interface DialGaugeProps {
  /** 0–1 fill along the half-moon arc. */
  fraction: number;
  /** Optional redline start (0–1); paints a red arc segment from there. */
  redlineFrom?: number;
  /** Caption lines under the dial (board `.cap2`). */
  caption?: ReactNode;
  className?: string;
}

/**
 * Half-moon SVG gauge — board `.dial` (viewBox 0 0 132 76, pathLength 100).
 * Needle angle: −90° + fraction×180° about (66,62).
 */
export function DialGauge({
  fraction,
  redlineFrom,
  caption,
  className,
}: DialGaugeProps) {
  const f = Math.min(1, Math.max(0, fraction));
  const filled = Math.round(f * 100);
  const rest = 100 - filled;
  const needleDeg = -90 + f * 180;

  let redline: { dash: string; offset: number } | null = null;
  if (redlineFrom != null) {
    const rf = Math.min(1, Math.max(0, redlineFrom));
    const redLen = Math.round((1 - rf) * 100);
    const offset = -Math.round(rf * 100);
    redline = { dash: `${redLen} ${100 - redLen}`, offset };
  }

  return (
    <div className={cn("rig-dial", className)}>
      <svg viewBox="0 0 132 76" aria-hidden>
        {/* Track — board stroke-dasharray 1.6 1 */}
        <path
          d="M14 62 A52 52 0 0 1 118 62"
          fill="none"
          stroke="#3a2f1c"
          strokeWidth="9"
          pathLength="100"
          strokeDasharray="1.6 1"
        />
        {/* Value arc */}
        <path
          d="M14 62 A52 52 0 0 1 118 62"
          fill="none"
          stroke="#ffb347"
          strokeWidth="9"
          pathLength="100"
          strokeDasharray={`${filled} ${rest}`}
          style={{ filter: "drop-shadow(0 0 4px rgba(255,160,40,.6))" }}
        />
        {redline ? (
          <path
            d="M14 62 A52 52 0 0 1 118 62"
            fill="none"
            stroke="#ff5340"
            strokeWidth="9"
            pathLength="100"
            strokeDasharray={redline.dash}
            strokeDashoffset={redline.offset}
            opacity={0.8}
          />
        ) : null}
        <g className="rig-dial-needle" transform={`rotate(${needleDeg} 66 62)`}>
          <line x1="66" y1="62" x2="66" y2="18" stroke="#ffd894" strokeWidth="2.5" />
        </g>
        <circle cx="66" cy="62" r="7" fill="#2b3036" stroke="#12151a" strokeWidth="1.5" />
      </svg>
      {caption != null ? <div className="rig-dial-cap">{caption}</div> : null}
    </div>
  );
}
