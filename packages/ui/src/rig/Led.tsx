import { cn } from "../lib/cn.js";

export type LedTone = "amber" | "red" | "green" | "dim";

export interface LedProps {
  tone?: LedTone;
  /** Pulse — board speeds: amber 2.2s, red 1.1s; `hot` forces 0.5s. */
  pulse?: boolean;
  pulseSpeed?: "default" | "hot";
  className?: string;
  title?: string;
}

/**
 * Status LED — board `.led` / `.led.on` / `.led.grn` / `.led.red`.
 */
export function Led({
  tone = "amber",
  pulse = false,
  pulseSpeed = "default",
  className,
  title,
}: LedProps) {
  const pulseClass =
    pulse && pulseSpeed === "hot"
      ? "rig-led--pulse-hot"
      : pulse
        ? "rig-led--pulse"
        : null;
  return (
    <span
      className={cn("rig-led", `rig-led--${tone}`, pulseClass, className)}
      title={title}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    />
  );
}
