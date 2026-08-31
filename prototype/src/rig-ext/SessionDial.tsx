import type { ReactNode } from "react";
import { DialGauge } from "@room/ui/rig";

/**
 * Field spend dial = rig DialGauge (amber window arc + needle + caption)
 * plus an optional outer blue session arc.
 *
 * DialGauge can't draw the session layer, so we compose it here.
 * // candidate for @room/ui/rig — DialGauge sessionFraction prop
 */
export function SessionDial({
  fraction,
  sessionFraction = null,
  redlineFrom = 0.85,
  caption,
}: {
  fraction: number;
  /** null = this provider has no session reset — no blue arc is drawn. */
  sessionFraction?: number | null;
  redlineFrom?: number;
  caption?: ReactNode;
}) {
  const sf = sessionFraction == null ? null : Math.min(1, Math.max(0, sessionFraction));
  // Outer arc around DialGauge's centre (66, 62) / main r=52 — ride outside it.
  const SESS = "M6 62 A60 60 0 0 1 126 62";

  return (
    <div className="fdial session-dial">
      {sf != null ? (
        <svg className="session-dial-arc" viewBox="0 0 132 76" aria-hidden>
          <path d={SESS} fill="none" stroke="#16242e" strokeWidth="4" />
          <path
            d={SESS}
            fill="none"
            stroke="#5fd0ff"
            strokeWidth="4"
            strokeLinecap="round"
            pathLength="100"
            strokeDasharray={`${Math.round(sf * 100)} 100`}
            style={{ filter: "drop-shadow(0 0 4px rgba(95,208,255,.7))" }}
          />
        </svg>
      ) : null}
      <DialGauge fraction={fraction} redlineFrom={redlineFrom} caption={caption} />
    </div>
  );
}
