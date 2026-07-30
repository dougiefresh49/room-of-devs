/**
 * Static dial homes (ceremony + turn) — visibly inert. Dial 2 lives on the faceplate.
 */
import { Bay, Tag } from "@room/ui";

export function DialChips() {
  return (
    <Bay label="DIAL HOMES" meta="STATIC" className="console-side-bay">
      <div className="console-dial-static">
        <Tag tone="dim">GEAR: STANDARD — DIAL 1</Tag>
        <Tag tone="dim">DIAL 3 · ROUTING: FLASH</Tag>
      </div>
    </Bay>
  );
}
