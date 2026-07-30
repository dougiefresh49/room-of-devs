import type { CSSProperties, ReactNode } from "react";
import { cn } from "../lib/cn.js";

export type CrtFaceSize = 26 | 52 | 58 | 104 | 158 | 176;

export interface CrtFaceProps {
  size: CrtFaceSize;
  /**
   * Consumer-owned `<img>` (or AvatarImg). Never a `src` prop — the panel
   * stage engine mutates its own img ref; frame-flipping never goes through React.
   */
  children?: ReactNode;
  halo?: boolean;
  scanlines?: boolean;
  className?: string;
}

/**
 * Amber-CRT avatar housing — board `.facewrap` + `.screenbed` grade
 * (`sepia(.5) hue-rotate(-12deg) saturate(1.5)`) and optional facehalo.
 */
export function CrtFace({
  size,
  children,
  halo = false,
  scanlines = true,
  className,
}: CrtFaceProps) {
  const style: CSSProperties = { width: size, height: size };
  return (
    <div className={cn("rig-crt", className)} style={style}>
      {children}
      {scanlines ? <span className="rig-crt-scan" aria-hidden /> : null}
      {halo ? <span className="rig-crt-halo" aria-hidden /> : null}
    </div>
  );
}
