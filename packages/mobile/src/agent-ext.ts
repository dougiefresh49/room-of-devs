/**
 * Phase-A optional agent/live fields — Lane 1 protocol may not be merged yet.
 * Read via safe optional access; never import from packages/protocol edits here.
 */
import type { AgentView } from "@room/protocol";

export type AgentViewExt = AgentView & { sdk?: boolean };

export type AgentLiveExt = NonNullable<AgentView["live"]> & {
  muted?: boolean;
  lastEmitAt?: string | null;
};

export function isChatEligible(agent: AgentView): boolean {
  const ext = agent as AgentViewExt;
  return agent.injectable || ext.sdk === true;
}

export function readLiveMuted(agent: AgentView): boolean {
  const live = agent.live as AgentLiveExt | null;
  return live?.muted === true;
}

/** Fingerprint for live text-freshness thread bumps (convo-state onSnapshot). */
export function liveFreshFingerprint(agent: AgentView): string {
  const live = agent.live as AgentLiveExt | null;
  return [
    live?.lastEmitAt ?? "",
    live?.lastActivity?.at ?? "",
    String(live?.toolCount ?? 0),
    agent.state,
  ].join("\0");
}
