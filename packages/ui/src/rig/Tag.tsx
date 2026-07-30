import type { ReactNode } from "react";
import { cn } from "../lib/cn.js";

export type TagTone = "amber" | "red" | "green" | "dim" | "hot";

export interface TagProps {
  tone?: TagTone;
  className?: string;
  children?: ReactNode;
}

/**
 * Chamfered mini tag — board `.tag` / `.tag.red` / `.tag.grn` / `.tag.dim`.
 * Tone `"hot"` = amber-hot speaking peak (P2).
 */
export function Tag({ tone = "amber", className, children }: TagProps) {
  return (
    <span
      className={cn(
        "rig-tag",
        tone === "red" && "rig-tag--red",
        tone === "green" && "rig-tag--green",
        tone === "dim" && "rig-tag--dim",
        tone === "hot" && "rig-tag--hot",
        className,
      )}
    >
      {children}
    </span>
  );
}
