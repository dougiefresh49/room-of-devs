import type { AgentLive } from "@room/protocol";

/**
 * Daemon live-mode indicator (owner decision #3: indicator only — no
 * toggle, no chat port on desktop yet). Renders nothing unless live mode
 * is actually on for the agent. Styled by the `.chip.live-mode` rule
 * (accent-derived, like the phone chip).
 */
export function LiveBadge({ live }: { live: AgentLive | null | undefined }) {
  if (!live?.on) return null;
  const detail = [
    `${live.toolCount} tool${live.toolCount === 1 ? "" : "s"}`,
    live.lastActivity?.label,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <span className="chip live-mode" title={detail ? `Live mode on · ${detail}` : "Live mode on"}>
      <span className="live-dot" aria-hidden="true" />
      live
    </span>
  );
}
