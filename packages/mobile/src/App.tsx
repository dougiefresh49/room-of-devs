import { useSyncExternalStore } from "react";
import { selectConnected, selectVisibleAgents } from "@room/room-client";
import { StateBadge } from "@room/ui";
import { client } from "./client.js";

/**
 * Chunk B scaffold — connection indicator + visible agents with StateBadge.
 * Enough to prove snapshot flow and shared tokens on a phone; Chunk C owns
 * the real room/picker UI.
 */
export function App() {
  const state = useSyncExternalStore(client.subscribe, client.getState);
  const connected = selectConnected(state);
  const agents = selectVisibleAgents(state);

  return (
    <div className="min-h-dvh bg-bg text-fg">
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <span
          className={`inline-block size-2.5 rounded-full ${
            connected ? "bg-accent" : "bg-fg-faint"
          }`}
          aria-label={connected ? "Connected" : "Disconnected"}
          title={connected ? "Connected" : "Disconnected"}
        />
        <h1 className="text-sm font-semibold tracking-wide">Room</h1>
      </header>
      <main className="px-4 py-3">
        {agents.length === 0 ? (
          <p className="text-sm text-fg-muted">No agents yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {agents.map((agent) => (
              <li key={agent.sessionId} className="min-w-0">
                <div className="truncate text-sm font-medium">{agent.name}</div>
                <StateBadge state={agent.state} />
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
