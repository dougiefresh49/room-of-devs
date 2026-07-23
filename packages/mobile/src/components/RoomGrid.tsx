/**
 * The room: one AgentCard per visible (non-hidden) agent. Pure presentational
 * fan-out — App owns the store reads and passes derived props/callbacks.
 */
import type { AgentView, NowPlaying } from "@room/protocol";
import type { OutputDevice } from "../prefs.js";
import { AgentCard } from "./AgentCard.js";

interface RoomGridProps {
  agents: AgentView[];
  nowPlaying: NowPlaying | null;
  clock: number;
  output: OutputDevice;
  isGrantPending: (sessionId: string) => boolean;
  onGrant: (sessionId: string) => void;
  onReplayLast: (agent: AgentView) => void;
  onChat: (agent: AgentView) => void;
  onHide: (rawName: string) => void;
}

export function RoomGrid({
  agents,
  nowPlaying,
  clock,
  output,
  isGrantPending,
  onGrant,
  onReplayLast,
  onChat,
  onHide,
}: RoomGridProps) {
  if (agents.length === 0) {
    return <p className="px-1 py-8 text-center text-sm text-fg-muted">No agents in the room</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      {agents.map((agent) => (
        <AgentCard
          key={agent.sessionId}
          agent={agent}
          nowPlaying={nowPlaying}
          clock={clock}
          output={output}
          grantPending={isGrantPending(agent.sessionId)}
          onGrant={() => onGrant(agent.sessionId)}
          onReplayLast={() => onReplayLast(agent)}
          onChat={() => onChat(agent)}
          onHide={() => onHide(agent.name)}
        />
      ))}
    </div>
  );
}
