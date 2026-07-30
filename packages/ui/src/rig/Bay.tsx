import type { ReactNode } from "react";
import { cn } from "../lib/cn.js";
import { Chassis } from "./Chassis.js";

export interface BayProps {
  label: string;
  meta?: ReactNode;
  screws?: boolean;
  className?: string;
  children?: ReactNode;
}

/**
 * Chassis bay with stencil label strip — board `.bay` / `.baylabel`
 * (left label + right meta slot).
 */
export function Bay({ label, meta, screws, className, children }: BayProps) {
  return (
    <Chassis screws={screws} className={cn("rig-bay", className)} glow="0 10px 22px rgba(0,0,0,.45)">
      <div className="rig-bay-body">
        <div className="rig-bay-label">
          <span>{label}</span>
          {meta != null ? <span className="rig-bay-label-meta">{meta}</span> : null}
        </div>
        {children}
      </div>
    </Chassis>
  );
}
