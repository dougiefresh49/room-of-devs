import {
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  renameSync,
} from "fs";
import { TTS_DIR } from "./config.js";
import { setSessionState, recomputeAfterPlayback } from "./state.js";
import { join } from "path";
import type { AlignmentTuples, NowPlaying } from "./protocol/index.js";
import type { ReplayMeta } from "./replay-store.js";

// Every audible path declares who it belongs to: a session id for
// session-attributed audio (queue items, dynamic acks, ask-user readouts,
// session-attributed replay) or the literal "meta" for room-level audio
// (announce chimes, phrases, orphan/legacy replay, `say`). Session context
// sets `speaking` on start and recomputes state after close; meta audio
// never touches session state — it only respects the lock.
export type PlaybackContext = { sessionId: string } | "meta";

export function beginSessionSpeaking(ctx: PlaybackContext): void {
  if (ctx !== "meta" && ctx.sessionId) setSessionState(ctx.sessionId, "speaking");
}

export function endSessionPlayback(ctx: PlaybackContext, excludeFile?: string): void {
  if (ctx !== "meta" && ctx.sessionId) {
    recomputeAfterPlayback(ctx.sessionId, excludeFile);
  }
}

export const NOW_PLAYING_PATH = join(TTS_DIR, ".now-playing.json");

// NowPlaying now lives in the shared protocol package (see import above) —
// full shape + field docs in packages/protocol/src/snapshot.ts.

export function writeNowPlaying(
  sessionId: string,
  meta?: ReplayMeta,
  alignment?: AlignmentTuples,
  startedAt?: string,
  playbackRate = 1.0,
  phone?: { replayFile: string; grantId: string; synthesisComplete?: boolean }
): void {
  const data: NowPlaying = {
    sessionId,
    text: meta?.spokenText ?? meta?.textPreview ?? "",
    ...(meta?.rawText ? { rawText: meta.rawText } : {}),
    startedAt: startedAt ?? new Date().toISOString(),
    approxCharsPerSec: 15,
    ...(alignment && alignment.length ? { alignment } : {}),
    ...(meta?.kind ? { kind: meta.kind } : {}),
    ...(playbackRate !== 1.0 ? { playbackRate } : { playbackRate: 1.0 }),
    ...(phone
      ? {
          output: "phone" as const,
          replayFile: phone.replayFile,
          grantId: phone.grantId,
          ...(phone.synthesisComplete !== undefined
            ? { synthesisComplete: phone.synthesisComplete }
            : {}),
        }
      : {}),
  };
  const tmp = `${NOW_PLAYING_PATH}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(data));
  renameSync(tmp, NOW_PLAYING_PATH);
}

/** Duration estimate for phone-grant timeout / refuse window (ms). */
export function phoneGrantDurationMs(alignment?: AlignmentTuples): number {
  if (alignment?.length) {
    const last = alignment[alignment.length - 1];
    if (typeof last[1] === "number" && Number.isFinite(last[1]) && last[1] > 0) {
      return last[1];
    }
  }
  return 60_000;
}

export const PHONE_GRANT_SLACK_MS = 5_000;

/** grantId of the phone grant whose playback window is still open, else null. */
export function activePhoneGrantId(): string | null {
  try {
    if (!existsSync(NOW_PLAYING_PATH)) return null;
    const np = JSON.parse(readFileSync(NOW_PLAYING_PATH, "utf-8")) as NowPlaying;
    if (!np || np.endedAt || np.output !== "phone" || !np.grantId) return null;
    // Synthesis still writing the replay file — the window can't expire yet
    // (the 60s no-alignment default would cut long messages off mid-stream).
    if (np.synthesisComplete === false) return np.grantId;
    const start = Date.parse(np.startedAt);
    if (!Number.isFinite(start)) return null;
    const open =
      Date.now() < start + phoneGrantDurationMs(np.alignment) + PHONE_GRANT_SLACK_MS;
    return open ? np.grantId : null;
  } catch {
    return null;
  }
}

/** True while a phone grant's now-playing window has not yet expired. */
export function isUnexpiredPhoneGrant(): boolean {
  return activePhoneGrantId() !== null;
}

/**
 * An explicit user grant supersedes an active phone grant (e.g. paused Mikey
 * mid-message, tapped Donnie): close the old window now so the new grant can
 * start. Returns false only while the old grant is still SYNTHESIZING — the
 * stream lock is held and the writer owns now-playing; superseding then would
 * let the finalize re-stamp hijack the new grant's record.
 */
export function supersedePhoneGrant(): boolean {
  try {
    if (!existsSync(NOW_PLAYING_PATH)) return true;
    const np = JSON.parse(readFileSync(NOW_PLAYING_PATH, "utf-8")) as NowPlaying;
    if (!np || np.endedAt || np.output !== "phone" || !np.grantId) return true;
    if (np.synthesisComplete === false) return false;
    clearNowPlaying();
    return true;
  } catch {
    return true;
  }
}

/** Phone reports a routed clip finished: stamp endedAt IF the current frame
 *  is still that phone playback (never clobbers a newer/other playback). The
 *  5-min client staleness belt remains the fallback when this never arrives. */
export function markPhonePlaybackDone(file: string): boolean {
  try {
    const cur = JSON.parse(readFileSync(NOW_PLAYING_PATH, "utf-8"));
    if (cur?.endedAt || cur?.output !== "phone" || cur?.replayFile !== file) return false;
    cur.endedAt = new Date().toISOString();
    const tmp = `${NOW_PLAYING_PATH}.tmp.${process.pid}`;
    writeFileSync(tmp, JSON.stringify(cur));
    renameSync(tmp, NOW_PLAYING_PATH);
    return true;
  } catch {
    return false;
  }
}

// Playback over: don't delete — stamp endedAt so the panel can keep showing
// the last message. The next playback overwrites the file.
export function clearNowPlaying(): void {
  try {
    const cur = JSON.parse(readFileSync(NOW_PLAYING_PATH, "utf-8"));
    if (!cur.endedAt) {
      cur.endedAt = new Date().toISOString();
      const tmp = `${NOW_PLAYING_PATH}.tmp.${process.pid}`;
      writeFileSync(tmp, JSON.stringify(cur));
      renameSync(tmp, NOW_PLAYING_PATH);
    }
  } catch {
    try { unlinkSync(NOW_PLAYING_PATH); } catch {}
  }
}

export function beginSessionPlayback(
  ctx: PlaybackContext,
  meta?: ReplayMeta,
  startedAt?: string,
  // Rate actually applied to this playback (afplay -r / ffplay atempo), not
  // a sidecar's original rate — the panel maps wall time via this factor.
  playbackRate = 1.0
): void {
  beginSessionSpeaking(ctx);
  if (ctx !== "meta" && ctx.sessionId)
    writeNowPlaying(ctx.sessionId, meta, meta?.alignment, startedAt, playbackRate);
}

/**
 * Compare-and-set: stamp replayFile into .now-playing.json only if the record
 * still belongs to this playback (sessionId + startedAt). Works for live or
 * endedAt records — never clobbers a newer playback.
 *
 * Known limit: read→rename isn't atomic across processes; another writer in
 * that microsecond window of sync fs calls could be resurrected-over. Accepted
 * for this single-user tool — a real conditional write would need a mutex.
 */
export function stampReplayFileCas(
  sessionId: string,
  startedAt: string,
  replayFile: string
): void {
  try {
    if (!existsSync(NOW_PLAYING_PATH)) return;
    const cur = JSON.parse(readFileSync(NOW_PLAYING_PATH, "utf-8")) as NowPlaying;
    if (cur.sessionId !== sessionId || cur.startedAt !== startedAt) return;
    if (cur.replayFile === replayFile) return;
    cur.replayFile = replayFile;
    const tmp = `${NOW_PLAYING_PATH}.tmp.${process.pid}`;
    writeFileSync(tmp, JSON.stringify(cur));
    renameSync(tmp, NOW_PLAYING_PATH);
  } catch {}
}
