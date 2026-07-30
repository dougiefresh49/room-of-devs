import { cn } from "../lib/cn.js";

export interface OdometerProps {
  value: number;
  digits?: number;
  /** Amber phosphor digits (board `.amberodo`) vs steel. */
  tone?: "amber" | "steel";
  /** Animate the last digit via steps(10) roll. */
  rolling?: boolean;
  className?: string;
}

/**
 * Mechanical drum readout — board `.odo` / `.amberodo` / `.tick`.
 */
export function Odometer({
  value,
  digits = 5,
  tone = "amber",
  rolling = true,
  className,
}: OdometerProps) {
  const safe = Math.max(0, Math.floor(value));
  const padded = String(safe).padStart(digits, "0").slice(-digits);
  const chars = padded.split("");

  return (
    <span
      className={cn("rig-odo", tone === "amber" && "rig-odo--amber", className)}
      aria-label={String(safe)}
    >
      {chars.map((ch, i) => {
        const isLast = i === chars.length - 1;
        if (isLast && rolling) {
          // Board tick strip: current digit then 9 following (wrap) for steps(10).
          const start = Number(ch);
          const strip = Array.from({ length: 11 }, (_, n) => (start + n) % 10).join("\n");
          return (
            <b key={i} className="rig-odo-digit rig-odo-digit--tick">
              <i>{strip}</i>
            </b>
          );
        }
        return (
          <b key={i} className="rig-odo-digit">
            <i>{ch}</i>
          </b>
        );
      })}
    </span>
  );
}
