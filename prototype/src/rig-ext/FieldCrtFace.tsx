import type { ReactNode } from "react";
import { CrtFace, type CrtFaceSize } from "@room/ui/rig";

/**
 * CrtFace sized for field wells (40 thread chip, 148 listen face) that aren't
 * in the library's CrtFaceSize union. Picks the nearest library size for the
 * typed prop, then fills the wrapper so the well stays pixel-sized.
 *
 * // candidate for @room/ui/rig — extend CrtFaceSize with 40 | 148
 */
export function FieldCrtFace({
  size,
  children,
  halo = false,
  scanlines = true,
  className,
}: {
  size: number;
  children?: ReactNode;
  halo?: boolean;
  scanlines?: boolean;
  className?: string;
}) {
  const libSize = nearestCrtSize(size);
  return (
    <div
      className={className}
      style={{ width: size, height: size, position: "relative", flex: "none" }}
    >
      <CrtFace
        size={libSize}
        halo={halo}
        scanlines={scanlines}
        className="field-crt-fill"
      >
        {children}
      </CrtFace>
    </div>
  );
}

function nearestCrtSize(n: number): CrtFaceSize {
  const sizes: CrtFaceSize[] = [26, 52, 58, 104, 158, 176];
  let best: CrtFaceSize = sizes[0]!;
  let bestDist = Math.abs(n - best);
  for (const s of sizes) {
    const d = Math.abs(n - s);
    if (d < bestDist) {
      best = s;
      bestDist = d;
    }
  }
  return best;
}
