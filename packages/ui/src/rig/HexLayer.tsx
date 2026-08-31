import { cn } from "../lib/cn.js";

export type HexIntensity = "bright" | "dim" | "faint";

export interface HexLayerProps {
  intensity?: HexIntensity;
  /** Banded vertical mask + 9s shieldshift (bright only; board `.railhex.bright`). */
  banded?: boolean;
  className?: string;
}

/**
 * Absolutely-positioned hex texture — board `--hex` / `--hexdim` / `--hexfaint`.
 * Texture never layout.
 */
export function HexLayer({ intensity = "dim", banded = false, className }: HexLayerProps) {
  return (
    <div
      className={cn("rig-hex", `rig-hex--${intensity}`, banded && "rig-hex--banded", className)}
      aria-hidden
    />
  );
}
