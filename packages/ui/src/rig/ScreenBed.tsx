import type { ReactNode } from "react";
import { cn } from "../lib/cn.js";
import { CutFrame } from "./CutFrame.js";

export interface ScreenBedProps {
  /** Faint hex backdrop under the screen gradient (board gaugebox). */
  hex?: boolean;
  scanlines?: boolean;
  /** 7s sweep — ambience only (board `.screenbed::after`). */
  sweep?: boolean;
  className?: string;
  children?: ReactNode;
}

/**
 * Amber CRT bed — board `.screenbed` (scale-s corner grammar).
 */
export function ScreenBed({
  hex = false,
  scanlines = false,
  sweep = false,
  className,
  children,
}: ScreenBedProps) {
  return (
    <CutFrame
      scale="s"
      className={className}
      innerClassName={cn("rig-screenbed", hex && "rig-screenbed--hex")}
    >
      {scanlines ? <span className="rig-screenbed-scan" aria-hidden /> : null}
      {sweep ? <span className="rig-screenbed-sweep" aria-hidden /> : null}
      <div className="rig-screenbed-body">{children}</div>
    </CutFrame>
  );
}
