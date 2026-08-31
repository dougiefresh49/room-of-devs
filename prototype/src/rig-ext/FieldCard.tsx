import type { CSSProperties, ReactNode } from "react";
import { CutFrame } from "@room/ui/rig";

/**
 * Field card shell — CutFrame scale-s (chamfer chassis) with the field's
 * screen-bed fill. Replaces bespoke `.fcard` clip-path from shape.css.
 *
 * // candidate for @room/ui/rig — a Bay/ScreenBed sibling for compact cards
 */
export function FieldCard({
  className,
  style,
  children,
}: {
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  return (
    <CutFrame scale="s" className={className} innerClassName="fcard" style={style}>
      {children}
    </CutFrame>
  );
}
