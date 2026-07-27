/**
 * One dispatcher for every action-cluster command (card, dock, spotlight)
 * — the same single-path rule the Phase 3 island host enforced. Kill keeps
 * its two-click arm semantics via the ui-state store.
 *
 * Every command goes through runCommand (audit Q-10): a dead socket or a
 * daemon refusal is reported, not swallowed. Kill matters most — a dropped
 * kill_team used to disarm the button and look exactly like a successful
 * end-session.
 */
import type { ClusterAction, ClusterMode } from "./ActionCluster.js";
import { dispatchCommand, runCommand } from "./commands.js";
import { armKill, disarmKill, isKillArmed } from "./ui-state.js";
import { isSpotlightWorthy } from "../stage/engine.js";
import { announce } from "./view-state.js";

export function clusterMode(sessionId: string): ClusterMode {
  return isSpotlightWorthy(sessionId) ? "stage" : "idle";
}

export function handleClusterAction(sessionId: string, action: ClusterAction): void {
  switch (action) {
    case "focus":
      dispatchCommand({ type: "focus_terminal", sessionId }, "Couldn't jump to the terminal");
      return;
    case "status":
      dispatchCommand({ type: "status_say", sessionId }, "Couldn't speak status");
      return;
    case "pause":
      dispatchCommand({ type: "pause" }, "Couldn't pause audio");
      return;
    case "stop":
      dispatchCommand({ type: "stop" }, "Couldn't stop audio");
      return;
    case "restart":
      dispatchCommand({ type: "restart" }, "Couldn't restart audio");
      return;
    case "replay":
      dispatchCommand({ type: "replay" }, "Couldn't replay");
      return;
    case "replay_slower":
      dispatchCommand({ type: "replay_slower" }, "Couldn't replay");
      return;
    case "replay_session":
      dispatchCommand({ type: "replay_session", sessionId }, "Couldn't replay their last message");
      return;
    case "kill":
      // Two-click confirm, same semantics as the legacy killArmed map.
      if (isKillArmed(sessionId)) {
        disarmKill(sessionId);
        void runCommand({ type: "kill_team", sessionId }, "Couldn't end the session").then((ok) => {
          // A refused kill must never read as a completed one: the button has
          // already disarmed, so say which of the two happened.
          announce(ok ? "Ending session" : "End session failed");
        });
      } else {
        armKill(sessionId);
      }
      return;
  }
}
