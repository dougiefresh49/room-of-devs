/**
 * One dispatcher for every action-cluster command (card, dock, spotlight)
 * — the same single-path rule the Phase 3 island host enforced. Kill keeps
 * its two-click arm semantics via the ui-state store.
 */
import { client } from "../client.js";
import type { ClusterAction } from "./ActionCluster.js";
import { armKill, disarmKill, isKillArmed } from "./ui-state.js";
import { isSpotlightWorthy } from "../stage/engine.js";
import type { ClusterMode } from "./ActionCluster.js";

export function clusterMode(sessionId: string): ClusterMode {
  return isSpotlightWorthy(sessionId) ? "stage" : "idle";
}

export function handleClusterAction(sessionId: string, action: ClusterAction): void {
  switch (action) {
    case "focus":
      client.send({ type: "focus_terminal", sessionId });
      return;
    case "status":
      client.send({ type: "status_say", sessionId });
      return;
    case "pause":
      client.send({ type: "pause" });
      return;
    case "stop":
      client.send({ type: "stop" });
      return;
    case "restart":
      client.send({ type: "restart" });
      return;
    case "replay":
      client.send({ type: "replay" });
      return;
    case "replay_slower":
      client.send({ type: "replay_slower" });
      return;
    case "replay_session":
      client.send({ type: "replay_session", sessionId });
      return;
    case "kill":
      // Two-click confirm, same semantics as the legacy killArmed map.
      if (isKillArmed(sessionId)) {
        disarmKill(sessionId);
        client.send({ type: "kill_team", sessionId });
      } else {
        armKill(sessionId);
      }
      return;
  }
}
