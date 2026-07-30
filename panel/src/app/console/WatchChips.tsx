/**
 * Watch-order chips — one per agent with live.on. Click → set_live off.
 */
import type { AgentView } from "@room/protocol";
import { Bay, Led } from "@room/ui";
import { dispatchCommand } from "../commands.js";

interface WatchChipsProps {
  agents: AgentView[];
  connected: boolean;
}

export function WatchChips({ agents, connected }: WatchChipsProps) {
  const watching = agents.filter((a) => a.live?.on);
  if (!watching.length) return null;

  return (
    <Bay label="WATCH ORDERS" meta={`${watching.length} LIVE`} className="console-side-bay">
      <div className="console-watch-list">
        {watching.map((a) => {
          const callsign = (a.label ?? a.name).toUpperCase();
          return (
            <button
              key={a.sessionId}
              type="button"
              className="console-watchchip no-drag"
              disabled={!connected}
              title="Stand down live mode"
              onClick={() => {
                dispatchCommand(
                  { type: "set_live", sessionId: a.sessionId, on: false },
                  "Couldn't stand down",
                );
              }}
            >
              <Led tone="amber" pulse />
              WATCH ORDER · {callsign} · CLICK TO STAND DOWN
            </button>
          );
        })}
      </div>
    </Bay>
  );
}
