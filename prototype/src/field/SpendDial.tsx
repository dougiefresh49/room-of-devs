import type { ReactNode } from "react";

/**
 * Two-arc field dial.
 *
 *  · main amber arc + needle = the GUARD WINDOW meter (the one that keeps
 *    climbing until the window resets)
 *  · thin blue arc, riding outside it = THIS SESSION's share of the same cap
 *    (zeroed every session)
 *
 * Prototype-local on purpose: the shared @room/ui DialGauge is the live app's
 * single-arc dial and this silo must not touch packages/.
 */
export function SpendDial({
  fraction,
  sessionFraction,
  redlineFrom = 0.85,
  caption,
}: {
  fraction: number;
  sessionFraction: number;
  redlineFrom?: number;
  caption?: ReactNode;
}) {
  const f = Math.min(1, Math.max(0, fraction));
  const sf = Math.min(1, Math.max(0, sessionFraction));
  const filled = Math.round(f * 100);
  const needleDeg = -90 + f * 180;
  const redLen = Math.round((1 - redlineFrom) * 100);
  const hot = f >= redlineFrom;

  // Inner arc r=44 (main), outer r=56 (session) — same centre (66, 66).
  const MAIN = "M22 66 A44 44 0 0 1 110 66";
  const SESS = "M10 66 A56 56 0 0 1 122 66";

  return (
    <div className="fdial">
      <svg viewBox="0 0 132 80" aria-hidden>
        {/* session track + arc (outside) */}
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
        {/* window track */}
        <path
          d={MAIN}
          fill="none"
          stroke="#3a2f1c"
          strokeWidth="9"
          pathLength="100"
          strokeDasharray="1.6 1"
        />
        {/* redline zone */}
        <path
          d={MAIN}
          fill="none"
          stroke="#ff5340"
          strokeWidth="9"
          opacity="0.28"
          pathLength="100"
          strokeDasharray={`${redLen} ${100 - redLen}`}
          strokeDashoffset={-Math.round(redlineFrom * 100)}
        />
        {/* window value arc */}
        <path
          d={MAIN}
          fill="none"
          stroke={hot ? "#ff5340" : "#ffb347"}
          strokeWidth="9"
          pathLength="100"
          strokeDasharray={`${filled} ${100 - filled}`}
          style={{ filter: "drop-shadow(0 0 4px rgba(255,160,40,.6))" }}
        />
        <g transform={`rotate(${needleDeg} 66 66)`}>
          <line
            x1="66"
            y1="66"
            x2="66"
            y2="26"
            stroke="#ffd894"
            strokeWidth="2.5"
          />
        </g>
        <circle
          cx="66"
          cy="66"
          r="6"
          fill="#2b3036"
          stroke="#12151a"
          strokeWidth="1.5"
        />
      </svg>
      <div className="fdial-cap">{caption}</div>
    </div>
  );
}
