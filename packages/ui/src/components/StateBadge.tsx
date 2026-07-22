import type { SessionState } from "@room/protocol";

const STATE_LABELS: Record<SessionState, string> = {
  working: "working",
  hand_raised: "hand raised",
  speaking: "speaking",
  idle: "idle",
};

/**
 * Agent state badge: colored dot + uppercase label. Colors come from the
 * semantic state tokens via the legacy `.state-*` rules (which now alias
 * `--state-*`); markup matches the string-template version exactly.
 */
export function StateBadge({ state }: { state: SessionState }) {
  return (
    <div className={`badge state-${state}`}>
      <span className="dot" />
      <span className="label">{STATE_LABELS[state]}</span>
    </div>
  );
}
