/**
 * The panel's one command-dispatch path — correlated, with a real failure
 * branch (audit Q-10 / U-2 / U-9 / M-31).
 *
 * Every panel action used to be `client.send()`, whose `false` return (socket
 * down) and whose server-side `command_result{ok:false}` were both discarded:
 * with the daemon gone, Pause/Kill/Replay/Swap all looked exactly like
 * success. Mobile already does this right (`App.tsx` requestSpawn,
 * `ConvoSheet.tsx` handleSend) and this mirrors it:
 *
 *   - `client.request()`, so a rejection code (`bad_persona`, `not_team`, …)
 *     from ANY surface — not just the picker — reaches the user;
 *   - a transport-down rejection reports "the room is offline" immediately,
 *     because no server frame is coming to explain it;
 *   - otherwise the toast is deferred briefly and SUPPRESSED if the daemon's
 *     own `error`/`notice` frame already explained the failure (server-data
 *     toasts those). One failure, one message.
 */
import type { Command } from "@room/protocol";
import { TransportError } from "@room/room-client";
import { client } from "../client.js";
import { lastErrorToastAt, showErrorToast } from "./view-state.js";

/**
 * Wait for the daemon's own explanation before falling back to ours. The
 * `error` frame is written to the socket in the same tick as the
 * `command_result`, so this only needs to outlast a render pass.
 */
const EXPLAIN_GRACE_MS = 350;

/** Rejection codes the daemon can attach to a command_result (panel-ws). */
const CODE_TEXT: Record<string, string> = {
  bad_dir: "Invalid project directory",
  bad_persona: "Unknown persona",
  bad_session: "Session no longer resumable",
  persona_busy: "That character is already in the room",
  stale_session: "That session is gone",
  stale_tmux: "That tmux session is gone",
  not_team: "Team sessions only",
  no_device: "No button device detected",
  bad_message: "The room didn't understand that command",
};

export const OFFLINE_TEXT = "Room is offline — the daemon isn't running";

function failText(code: string | undefined, fallback: string): string {
  return (code && CODE_TEXT[code]) || fallback;
}

/**
 * Dispatch a command and surface failure. Resolves true when the daemon
 * ACCEPTED the command (side effects still arrive via snapshots/notices),
 * false on any refusal, timeout, or dead socket.
 *
 * `fallbackText: null` still reports the outcome to the caller but says
 * nothing to the user — for the follow-up half of a pair whose first half
 * already failed loudly (a `ptt stop` after a `ptt start` that never
 * reached the daemon would otherwise double-toast).
 */
export function runCommand(cmd: Command, fallbackText: string | null): Promise<boolean> {
  const at = Date.now();
  const explain = (text: string) => {
    if (fallbackText === null) return;
    // Suppress ours if the daemon's error/notice frame already toasted.
    setTimeout(() => {
      if (lastErrorToastAt() >= at) return;
      showErrorToast(text);
    }, EXPLAIN_GRACE_MS);
  };

  return client.request(cmd).then(
    (result) => {
      if (result.ok) return true;
      explain(failText(result.code, fallbackText ?? ""));
      return false;
    },
    (err: unknown) => {
      if (err instanceof TransportError && (err.kind === "down" || err.kind === "stopped")) {
        // Never left the panel — nothing on the wire will explain it.
        if (fallbackText !== null) showErrorToast(OFFLINE_TEXT);
      } else {
        explain(`${fallbackText} — no response from the room`);
      }
      return false;
    },
  );
}

/** Fire-and-report variant for handlers that don't await the outcome. */
export function dispatchCommand(cmd: Command, fallbackText: string): void {
  void runCommand(cmd, fallbackText);
}
