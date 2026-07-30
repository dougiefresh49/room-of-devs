import type { ReactNode } from "react";
import { CutFrame } from "./CutFrame.js";

export interface ChassisProps {
  /** Corner rivets; BR screw is offset to clear the chamfer (board `.screw.br`). */
  screws?: boolean;
  className?: string;
  children?: ReactNode;
  /** Override CutFrame glow; default chassis drop-shadow from board. */
  glow?: string;
}

/**
 * Gunmetal panel — board `.chassis` gradient + edge + inset highlights,
 * composed on CutFrame scale-m.
 */
export function Chassis({
  screws = false,
  className,
  children,
  glow = "0 12px 26px rgba(0,0,0,.5)",
}: ChassisProps) {
  return (
    <CutFrame scale="m" glow={glow} className={className} innerClassName="rig-chassis">
      {screws ? (
        <>
          <span className="rig-screw rig-screw--tl" aria-hidden />
          <span className="rig-screw rig-screw--tr" aria-hidden />
          <span className="rig-screw rig-screw--bl" aria-hidden />
          <span className="rig-screw rig-screw--br" aria-hidden />
        </>
      ) : null}
      {children}
    </CutFrame>
  );
}
