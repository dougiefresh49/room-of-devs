import { cn } from "../lib/cn.js";

export interface SalienceBarProps {
  segments?: number;
  /** How many segments are lit (amber). */
  lit: number;
  /** Segment index that renders as the red threshold notch (0-based). */
  threshold: number;
  className?: string;
}

/**
 * Dock LED salience bar — board `.dock .salbar` (dim unlit `#3d3325`,
 * red notch `.th`).
 */
export function SalienceBar({
  segments = 16,
  lit,
  threshold,
  className,
}: SalienceBarProps) {
  const litCount = Math.min(segments, Math.max(0, Math.round(lit)));
  const th = Math.min(segments - 1, Math.max(0, Math.round(threshold)));

  return (
    <div className={cn("rig-salbar", className)} role="meter" aria-valuenow={litCount} aria-valuemin={0} aria-valuemax={segments}>
      {Array.from({ length: segments }, (_, i) => {
        const isTh = i === th;
        const isDim = i >= litCount && !isTh;
        return (
          <i
            key={i}
            className={cn(
              "rig-salbar-seg",
              isTh && "rig-salbar-seg--th",
              isDim && "rig-salbar-seg--dim",
            )}
          />
        );
      })}
    </div>
  );
}
