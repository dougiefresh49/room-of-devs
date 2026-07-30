import type { CSSProperties, ReactNode } from "react";
import { cn } from "../lib/cn.js";

export type CutScale = "l" | "m" | "s";

export interface CutFrameProps {
  scale: CutScale;
  /** Optional drop-shadow — clip-path swallows box-shadows (board cohesion pass). */
  glow?: string;
  className?: string;
  innerClassName?: string;
  children?: ReactNode;
  style?: CSSProperties;
}

/**
 * Corner-grammar wrapper: unclipped outer owns `filter: drop-shadow`,
 * clipped inner owns chamfer + asymmetric radius (design-ui-target §2.3;
 * board `.chassis` / `.screenbed` clip-path polygons).
 */
export function CutFrame({
  scale,
  glow,
  className,
  innerClassName,
  children,
  style,
}: CutFrameProps) {
  const outerStyle: CSSProperties = {
    ...style,
    ...(glow ? { filter: `drop-shadow(${glow})` } : null),
  };
  return (
    <div className={cn("rig-cut", `rig-cut--${scale}`, className)} style={outerStyle}>
      <div className={cn("rig-cut-inner", innerClassName)}>{children}</div>
    </div>
  );
}
