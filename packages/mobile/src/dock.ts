/**
 * Dock playback model — what the docked player + its expanded sheet are
 * currently showing, derived from the AudioController snapshot and the room
 * snapshot's `nowPlaying`.
 *
 * The controller owns the PHONE plane; MAC playback lives only in `nowPlaying`
 * (output !== "phone"). This derivation unifies both so ONE docked surface can
 * offer the Mac↔phone handoff device row (chunk E, item 3) — the piece that
 * activates the controller's dormant beginMacToPhone / beginPhoneToMac
 * initiators.
 */
import type { AgentView, NowPlaying } from "@room/protocol";
import type { PlayerSnapshot } from "./audio/controller.js";
import { avatarDir } from "./avatar.js";

export type DockKind = "phone" | "mac";

export interface DockState {
  kind: DockKind;
  /** The room frame backing a MAC clip (null for a phone clip). */
  np: NowPlaying | null;
  agent: AgentView | undefined;
  name: string;
  /** Avatar character folder for the handoff meta ("default" when unassigned). */
  character: string;
}

/** True for a genuine MAC-spoken clip that's still playing (handoff source). */
function isActiveMacClip(np: NowPlaying | null): np is NowPlaying {
  return !!(
    np &&
    !np.endedAt &&
    np.text &&
    np.output !== "phone" &&
    np.kind !== "live" &&
    np.kind !== "ack"
  );
}

/**
 * The current dock state, or null when nothing plays. Phone playback (the
 * controller has a loaded clip) wins; otherwise a live Mac clip surfaces so it
 * can be moved to the phone.
 */
export function deriveDock(
  player: PlayerSnapshot,
  nowPlaying: NowPlaying | null,
  agents: AgentView[],
): DockState | null {
  if (player.status !== "idle" && player.entry) {
    const sid = player.entry.sessionId;
    const agent = sid ? agents.find((a) => a.sessionId === sid) : undefined;
    const name =
      agent?.label ||
      agent?.name ||
      player.entry.sessionName ||
      (sid ? sid.slice(0, 8) : "Unknown");
    return {
      kind: "phone",
      np: null,
      agent,
      name,
      character: agent ? avatarDir(agent) : (player.entry.character ?? "default"),
    };
  }
  if (isActiveMacClip(nowPlaying)) {
    const agent = agents.find((a) => a.sessionId === nowPlaying.sessionId);
    const name = agent?.label || agent?.name || nowPlaying.sessionId.slice(0, 8);
    return {
      kind: "mac",
      np: nowPlaying,
      agent,
      name,
      character: agent ? avatarDir(agent) : "default",
    };
  }
  return null;
}

/**
 * Natural-file offset (seconds) a Mac clip has reached — legacy macElapsedMs:
 * wall time since startedAt × the atempo playback rate, clamped to an estimated
 * duration. Used as the seek target when moving Mac → phone.
 */
export function macOffsetSec(np: NowPlaying, now = Date.now()): number {
  const started = Date.parse(np.startedAt);
  if (!Number.isFinite(started)) return 0;
  const rate = np.playbackRate && np.playbackRate > 0 ? np.playbackRate : 1;
  const elapsed = Math.max(0, ((now - started) * rate) / 1000);
  const dur = macDurationSec(np);
  return dur > 0 ? Math.min(elapsed, dur) : elapsed;
}

function macDurationSec(np: NowPlaying): number {
  const alignment = np.alignment;
  if (Array.isArray(alignment) && alignment.length) {
    const maxMs = Math.max(0, ...alignment.map((row) => (typeof row[1] === "number" ? row[1] : 0)));
    if (maxMs > 0) return maxMs / 1000 + 0.4;
  }
  const cps = np.approxCharsPerSec > 0 ? np.approxCharsPerSec : 15;
  const guess = (np.text || "").length / cps;
  return guess > 0 ? guess : 0;
}
