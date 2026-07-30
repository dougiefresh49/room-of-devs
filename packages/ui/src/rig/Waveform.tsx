import { cn } from "../lib/cn.js";

export interface WaveformProps {
  /** When true, bars animate; when false, flat dim idle bars. */
  active: boolean;
  /** Bar count — board faceplate uses 12. */
  bars?: number;
  className?: string;
}

/**
 * 12-bar talk indicator — board `.wave` / `.wave.flat` (faceplate wavebar).
 * CSS-animated while active (desynced delays); flat dim when idle.
 */
export function Waveform({ active, bars = 12, className }: WaveformProps) {
  const n = Math.max(1, Math.min(24, bars));
  return (
    <div
      className={cn("rig-wave", !active && "rig-wave--flat", className)}
      aria-hidden="true"
    >
      {Array.from({ length: n }, (_, i) => (
        <i key={i} style={{ animationDelay: `${(i * 37) % 400}ms` }} />
      ))}
    </div>
  );
}
