import { spawn, spawnSync, ChildProcess } from "child_process";
import {
  createWriteStream,
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync,
  type WriteStream,
} from "fs";
import {
  STREAM_PID_FILE,
  PLAYBACK_PID_FILE,
  STREAM_LOCK,
  PROCESSING_DIR,
  TTS_DIR,
  STATE_DIR,
  loadConfig,
} from "./config.js";
import { log } from "./logger.js";
import { setSessionState, recomputeAfterPlayback } from "./state.js";
import type { WordTiming } from "./elevenlabs.js";
import { basename, join } from "path";

// Compact [word, startMs] tuples — what the panel highlights against.
// Shape owned by the shared protocol package; re-exported for daemon callers.
import type { AlignmentTuples, NowPlaying } from "./protocol/index.js";
export type { AlignmentTuples, NowPlaying };

function toTuples(words: WordTiming[]): AlignmentTuples {
  return words.map((w) => [w.word, w.startMs]);
}

// Every audible path declares who it belongs to: a session id for
// session-attributed audio (queue items, dynamic acks, ask-user readouts,
// session-attributed replay) or the literal "meta" for room-level audio
// (announce chimes, phrases, orphan/legacy replay, `say`). Session context
// sets `speaking` on start and recomputes state after close; meta audio
// never touches session state — it only respects the lock.
export type PlaybackContext = { sessionId: string } | "meta";

function beginSessionSpeaking(ctx: PlaybackContext): void {
  if (ctx !== "meta" && ctx.sessionId) setSessionState(ctx.sessionId, "speaking");
}

function endSessionPlayback(ctx: PlaybackContext, excludeFile?: string): void {
  if (ctx !== "meta" && ctx.sessionId) {
    recomputeAfterPlayback(ctx.sessionId, excludeFile);
  }
}

const REPLAY_DIR = join(TTS_DIR, "replay");
export const NOW_PLAYING_PATH = join(TTS_DIR, ".now-playing.json");

// NowPlaying now lives in the shared protocol package (see import above) —
// full shape + field docs in packages/protocol/src/snapshot.ts.

/** Where playStreamBuffer sends synthesized audio. "none" = buffer → replay only. */
export type StreamSink = "ffplay" | "none";

function writeNowPlaying(
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

const PHONE_GRANT_SLACK_MS = 5_000;

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

// Playback over: don't delete — stamp endedAt so the panel can keep showing
// the last message. The next playback overwrites the file.
function clearNowPlaying(): void {
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

function beginSessionPlayback(
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
const MAX_REPLAY_FILES = 20;

const PAUSED_FLAG = join(TTS_DIR, ".playback-paused");
const PLAYBACK_FILE_REF = join(TTS_DIR, ".playback-file");
const AUDIO_REF = join(TTS_DIR, ".playback-audio");

let currentProcess: ChildProcess | null = null;

// Invariant: a SIGSTOPped player is legitimate ONLY while the pause flag
// exists. If the flag disappears without a SIGCONT (crashed pauser, manual
// cleanup), the player wedges forever — the daemon waits on a close event
// that can't come. Self-heal by resuming any orphaned-suspended child.
function healOrphanedSuspend(child: ChildProcess): void {
  try {
    if (!child.pid || child.killed || existsSync(PAUSED_FLAG)) return;
    const out = spawnSync("ps", ["-o", "stat=", "-p", String(child.pid)]);
    if (out.status === 0 && out.stdout.toString().trim().startsWith("T")) {
      child.kill("SIGCONT");
      log("audio", `Player ${child.pid} suspended with no pause flag — resumed (self-heal)`);
    }
  } catch {}
}

function startSuspendHealer(child: ChildProcess): () => void {
  const timer = setInterval(() => healOrphanedSuspend(child), 3000);
  return () => clearInterval(timer);
}

export function isProcessing(basename: string): boolean {
  const marker = join(PROCESSING_DIR, basename);
  if (!existsSync(marker)) return false;
  const pid = readFileSync(marker, "utf-8").trim();
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

// Atomic claim: exclusive-create the marker so two processes (daemon +
// manual play_node.sh) can't both pass an isProcessing() check and
// double-spend Gemini/ElevenLabs on the same queue file.
export function claimProcessing(basename: string): boolean {
  mkdirSync(PROCESSING_DIR, { recursive: true });
  const marker = join(PROCESSING_DIR, basename);
  try {
    writeFileSync(marker, String(process.pid), { flag: "wx" });
    return true;
  } catch {
    if (isProcessing(basename)) return false; // live holder
    try {
      unlinkSync(marker); // stale marker from a dead process
      writeFileSync(marker, String(process.pid), { flag: "wx" });
      return true;
    } catch {
      return false;
    }
  }
}

export function clearProcessing(basename: string): void {
  try {
    unlinkSync(join(PROCESSING_DIR, basename));
  } catch {}
}

export function acquireLock(): boolean {
  if (existsSync(STREAM_LOCK)) {
    const pid = readFileSync(STREAM_LOCK, "utf-8").trim();
    try {
      process.kill(Number(pid), 0);
      return false;
    } catch {}
  }
  writeFileSync(STREAM_LOCK, String(process.pid));
  return true;
}

// Timeout must exceed the longest possible playback (~4-5 min for a
// 4,800-char message), otherwise we steal the lock from a live holder
// and talk over it.
export function waitForLock(timeoutMs = 600_000): Promise<boolean> {
  return new Promise((resolve) => {
    if (acquireLock()) return resolve(true);
    const start = Date.now();
    const interval = setInterval(() => {
      if (acquireLock()) {
        clearInterval(interval);
        resolve(true);
      } else if (Date.now() - start > timeoutMs) {
        // Only steal from a dead holder; if it's alive, keep waiting.
        let holderAlive = false;
        try {
          const pid = Number(readFileSync(STREAM_LOCK, "utf-8").trim());
          process.kill(pid, 0);
          holderAlive = true;
        } catch {}
        if (!holderAlive) {
          clearInterval(interval);
          writeFileSync(STREAM_LOCK, String(process.pid));
          log("audio", "Lock timeout — holder dead, stealing");
          resolve(true);
        }
      }
    }, 500);
  });
}

export function releaseLock(): void {
  try {
    const stored = readFileSync(STREAM_LOCK, "utf-8").trim();
    if (stored === String(process.pid)) unlinkSync(STREAM_LOCK);
  } catch {}
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
function stampReplayFileCas(
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

// Early-stop drains outlive playStreamBuffer's resolution. The `once` process
// exits right after playback settles — it must await this first, or the drain
// (and the complete replay file) dies with the process.
let pendingDrain: Promise<void> | null = null;
export function awaitPendingDrain(capMs = 95_000): Promise<void> {
  if (!pendingDrain) return Promise.resolve();
  // The drain's 90s cap only ticks per received chunk — a fully stalled
  // stream would never resolve it. Cap the wait so `once` always exits.
  return Promise.race([
    pendingDrain,
    new Promise<void>((r) => setTimeout(r, capMs).unref?.()),
  ]);
}

export function stopCurrent(): void {
  if (currentProcess && !currentProcess.killed) {
    // A paused (SIGSTOPped) player never receives SIGTERM — resume first,
    // or the close event never fires and the session wedges on "speaking".
    currentProcess.kill("SIGCONT");
    currentProcess.kill("SIGTERM");
    currentProcess = null;
  }
  // Kill by PID file — works even from a fresh process where
  // currentProcess is null (e.g. `tsx src/index.ts stop`).
  for (const pidFile of [STREAM_PID_FILE, PLAYBACK_PID_FILE]) {
    try {
      const pid = Number(readFileSync(pidFile, "utf-8").trim());
      if (pid > 0) {
        process.kill(pid, "SIGCONT");
        process.kill(pid, "SIGTERM");
      }
    } catch {}
  }
  cleanup();
}

// Both PID files hold the same player PID: STREAM_PID_FILE is the server's
// own reference; PLAYBACK_PID_FILE is what pause.sh / media_control.sh /
// the SwiftBar plugin / hammerspoon read.
function writePidFiles(pid: number | undefined): void {
  if (!pid) return;
  writeFileSync(STREAM_PID_FILE, String(pid));
  writeFileSync(PLAYBACK_PID_FILE, String(pid));
}

function removePidFiles(): void {
  for (const f of [STREAM_PID_FILE, PLAYBACK_PID_FILE]) {
    try { unlinkSync(f); } catch {}
  }
}

function cleanup(): void {
  removePidFiles();
  clearNowPlaying();
  for (const f of [PAUSED_FLAG, AUDIO_REF, PLAYBACK_FILE_REF]) {
    try { unlinkSync(f); } catch {}
  }
}

export function playFile(
  filePath: string,
  ctx: PlaybackContext = "meta",
  speedFactor = 1.0,
  replayMeta?: ReplayMeta
): Promise<number> {
  return new Promise((resolve) => {
    const config = loadConfig();
    // Replay files were saved from ElevenLabs streams, which bake in speed
    // up to the API max of 1.2x. Only the residual factor above 1.2 needs
    // applying here — using the full default_speed would over-speed them.
    const rawSpeed = config.default_speed;
    const residual = rawSpeed > 1.2 ? +(rawSpeed / 1.2).toFixed(4) : 1.0;
    const speed = +(residual * speedFactor).toFixed(4);
    const args = [filePath];
    if (speed !== 1.0) args.push("-r", String(speed));

    beginSessionPlayback(ctx, replayMeta, undefined, speed);
    const child = spawn("afplay", args, { stdio: "ignore" });
    currentProcess = child;
    writePidFiles(child.pid);
    const stopHealer = startSuspendHealer(child);

    let settled = false;
    const settle = (code: number) => {
      if (settled) return;
      settled = true;
      stopHealer();
      if (currentProcess === child) currentProcess = null;
      removePidFiles();
      clearNowPlaying();
      endSessionPlayback(ctx);
      resolve(code);
    };
    child.on("error", (err) => {
      log("audio", `afplay error: ${err.message}`);
      settle(1);
    });
    child.on("close", (code) => settle(code ?? 0));
  });
}

export interface ReplayMeta {
  source: string;
  sessionId?: string;
  sessionName?: string;
  character?: string;
  textPreview?: string;
  spokenText?: string;
  // Pre-Gemini original text (the agent's actual words), for the summary bubble.
  rawText?: string;
  timestamp: string;
  // Persisted word timings so replays can karaoke too (panel reads the sidecar).
  alignment?: AlignmentTuples;
  // Post-EL atempo factor for karaoke sync (see playStreamBuffer tempoRate).
  playbackRate?: number;
  // "ack" keeps short prompt acknowledgments off the panel's stage;
  // "live" marks an intermediate live-mode clip (conversation view dims it).
  kind?: "ack" | "update" | "live";
}

function pruneReplayDir(): void {
  try {
    const files = readdirSync(REPLAY_DIR)
      .filter((f) => f.endsWith(".mp3"))
      .sort();
    while (files.length > MAX_REPLAY_FILES) {
      const oldest = files.shift()!;
      try { unlinkSync(join(REPLAY_DIR, oldest)); } catch {}
      try { unlinkSync(join(REPLAY_DIR, oldest.replace(".mp3", ".json"))); } catch {}
    }
    // Crash leftovers: a .part older than an hour will never finalize.
    for (const f of readdirSync(REPLAY_DIR)) {
      if (!f.endsWith(".part")) continue;
      const p = join(REPLAY_DIR, f);
      try {
        if (Date.now() - statSync(p).mtimeMs > 3_600_000) unlinkSync(p);
      } catch {}
    }
  } catch {}
}

/** Returns the replay filename (not full path), or null on failure. */
function saveReplayFile(
  chunks: Uint8Array[],
  queueFile: string,
  meta?: ReplayMeta
): string | null {
  try {
    mkdirSync(REPLAY_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const label = queueFile.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
    const filename = `${ts}_${label}.mp3`;
    const filePath = join(REPLAY_DIR, filename);
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)), total);
    writeFileSync(filePath, buf);
    if (meta) {
      writeFileSync(
        join(REPLAY_DIR, filename.replace(".mp3", ".json")),
        JSON.stringify(meta, null, 2)
      );
    }
    pruneReplayDir();
    log("audio", `Saved replay: ${filename} (${(total / 1024).toFixed(1)} KB)`);
    return filename;
  } catch (err: any) {
    log("audio", `Failed to save replay: ${err.message}`);
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Progressive replay writer: chunks land in <name>.mp3.part as they stream in
// (the /live-audio/ endpoint tails it); finalize renames to .mp3 + writes the
// full sidecar. Pruning and /replay-list ignore .part files.
interface ReplayWriter {
  filename: string; // final .mp3 name (what gets stamped/served)
  write(chunk: Uint8Array): Promise<void>;
  finalize(meta?: ReplayMeta): Promise<string | null>;
  abort(): void;
}

function openReplayWriter(queueFile: string, meta?: ReplayMeta): ReplayWriter | null {
  try {
    mkdirSync(REPLAY_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const label = queueFile.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
    const filename = `${ts}_${label}.mp3`;
    const filePath = join(REPLAY_DIR, filename);
    const partPath = `${filePath}.part`;
    const stream: WriteStream = createWriteStream(partPath);
    // Without a listener a stream 'error' (disk full, unlinked dir) is an
    // uncaught exception that kills the daemon. Remember it; write/finalize
    // surface it as a failed promise / null result instead.
    let streamErr: Error | null = null;
    stream.on("error", (err) => {
      streamErr = err;
    });
    // Initial sidecar: everything known pre-synthesis, so a client that reads
    // it mid-stream never sees an empty entry. Finalize overwrites with
    // alignment/rate added.
    if (meta) {
      writeFileSync(
        join(REPLAY_DIR, filename.replace(".mp3", ".json")),
        JSON.stringify(meta, null, 2)
      );
    }
    let total = 0;
    return {
      filename,
      write(chunk: Uint8Array): Promise<void> {
        if (streamErr) return Promise.reject(streamErr);
        total += chunk.length;
        return new Promise((res, rej) => {
          stream.write(Buffer.from(chunk), (err) => (err ? rej(err) : res()));
        });
      },
      finalize(finalMeta?: ReplayMeta): Promise<string | null> {
        return new Promise((res) => {
          // An errored/destroyed stream may never run the end() callback —
          // settle immediately instead of wedging the drain.
          if (streamErr) {
            log("audio", `Failed to finalize replay: ${streamErr.message}`);
            try { stream.destroy(); } catch {}
            res(null);
            return;
          }
          stream.end(() => {
            if (streamErr) {
              log("audio", `Failed to finalize replay: ${streamErr.message}`);
              res(null);
              return;
            }
            try {
              renameSync(partPath, filePath);
              if (finalMeta) {
                const tmp = join(REPLAY_DIR, `.${filename}.json.tmp`);
                writeFileSync(tmp, JSON.stringify(finalMeta, null, 2));
                renameSync(tmp, join(REPLAY_DIR, filename.replace(".mp3", ".json")));
              }
              pruneReplayDir();
              log("audio", `Saved replay: ${filename} (${(total / 1024).toFixed(1)} KB)`);
              res(filename);
            } catch (err: any) {
              log("audio", `Failed to finalize replay: ${err.message}`);
              res(null);
            }
          });
        });
      },
      abort(): void {
        try { stream.destroy(); } catch {}
        try { unlinkSync(partPath); } catch {}
        try { unlinkSync(join(REPLAY_DIR, filename.replace(".mp3", ".json"))); } catch {}
      },
    };
  } catch (err: any) {
    log("audio", `Failed to open replay writer: ${err.message}`);
    return null;
  }
}

/** Stream synthesis into a replay file; phone plays it live. No Mac speakers. */
async function playStreamToPhone(
  audioStream: AsyncIterable<Uint8Array>,
  queueFile: string,
  ctx: PlaybackContext,
  replayMeta: ReplayMeta | undefined,
  getWords: (() => WordTiming[]) | undefined,
  tempoRate: number,
  onPersisted?: () => void
): Promise<number> {
  const grantId = basename(queueFile);
  const captioned = !!getWords && ctx !== "meta";
  const sessionId = ctx !== "meta" ? ctx.sessionId : "";

  if (replayMeta) replayMeta.playbackRate = tempoRate;
  const writer = openReplayWriter(queueFile, replayMeta);
  if (!writer) return 1;

  // Stamp on FIRST chunk (file exists on disk from that moment) — the phone
  // starts streaming /live-audio/ within ~1s instead of waiting for the full
  // synthesis. The queue item is NOT retired yet (see onPersisted below).
  let startedAt = "";
  let total = 0;
  try {
    for await (const chunk of audioStream) {
      await writer.write(chunk);
      total += chunk.length;
      if (!startedAt) {
        startedAt = new Date().toISOString();
        beginSessionSpeaking(ctx);
        if (sessionId) {
          writeNowPlaying(sessionId, replayMeta, undefined, startedAt, tempoRate, {
            replayFile: writer.filename,
            grantId,
            synthesisComplete: false,
          });
        }
      }
    }
  } catch (err: any) {
    log("audio", `Phone-sink stream error: ${err.message}`);
    writer.abort();
    if (startedAt && activePhoneGrantId() === grantId) clearNowPlaying();
    endSessionPlayback(ctx, grantId);
    return 1;
  }

  if (total === 0) {
    log("audio", "Phone-sink: empty stream — nothing to save");
    writer.abort();
    return 1;
  }

  const alignment = captioned ? toTuples(getWords!()) : undefined;
  if (replayMeta && captioned) replayMeta.alignment = alignment;

  const replayFile = await writer.finalize(replayMeta);
  if (!replayFile) {
    if (startedAt && activePhoneGrantId() === grantId) clearNowPlaying();
    endSessionPlayback(ctx, grantId);
    return 1;
  }

  const startedAtMs = Date.parse(startedAt);

  // Finalize re-stamp: same startedAt, now with alignment + complete flag —
  // SSE broadcasts it even though nowPlayingKey doesn't change.
  if (sessionId) {
    writeNowPlaying(sessionId, replayMeta, alignment, startedAt, tempoRate, {
      replayFile,
      grantId,
      synthesisComplete: true,
    });
  }

  // Credits are spent and the audio is durably saved — retire the queue item
  // NOW, not after the playback window, so a crash mid-wait can't leave it
  // re-buyable.
  onPersisted?.();

  // Mac audio pipeline is free; phone playback doesn't hold the stream lock.
  releaseLock();

  const waitMs = Math.max(
    0,
    startedAtMs + phoneGrantDurationMs(alignment) + PHONE_GRANT_SLACK_MS - Date.now()
  );
  log(
    "audio",
    `Phone grant ${grantId}: waiting ${Math.round(waitMs / 1000)}s for playback window`
  );
  await sleep(waitMs);

  // Compare-and-set: newer playback (e.g. Mac auto-play) may own now-playing
  // by the time our window closes — never stamp someone else's record.
  if (activePhoneGrantId() === grantId) {
    clearNowPlaying();
  }
  endSessionPlayback(ctx, grantId);
  return 0;
}

export function playStreamBuffer(
  audioStream: AsyncIterable<Uint8Array>,
  queueFile: string,
  ctx: PlaybackContext = "meta",
  replayMeta?: ReplayMeta,
  // When provided (timestamps path), poll accumulated word timings and thread
  // them into .now-playing.json (live) + the replay sidecar (persisted).
  getWords?: () => WordTiming[],
  sink: StreamSink = "ffplay",
  // Called once the replay + now-playing are durably written (phone sink) —
  // the caller retires the queue item here, before the playback-window wait.
  onPersisted?: () => void
): Promise<number> {
  return new Promise(async (resolve) => {
    const config = loadConfig();
    const rawSpeed = config.default_speed;
    const elMax = 1.2;
    const tempoRate = rawSpeed > elMax ? +(rawSpeed / elMax).toFixed(4) : 1.0;

    if (sink === "none") {
      resolve(
        await playStreamToPhone(
          audioStream,
          queueFile,
          ctx,
          replayMeta,
          getWords,
          tempoRate,
          onPersisted
        )
      );
      return;
    }

    const ffplayArgs = [
      "-nodisp",
      "-autoexit",
      "-loglevel",
      "quiet",
      "-i",
      "pipe:0",
    ];
    if (tempoRate > 1.0) {
      ffplayArgs.push("-af", `atempo=${tempoRate}`);
      log("audio", `Applying atempo=${tempoRate} (target=${rawSpeed}x, el=${elMax}x)`);
    }

    // Stable playback start for the whole session so progressive alignment
    // updates keep the same reference point (Date.now() - startedAt).
    const startedAt = new Date().toISOString();
    const captioned = !!getWords && ctx !== "meta";
    const sessionId = ctx !== "meta" ? ctx.sessionId : "";
    let lastNpWrite = 0;
    const pushAlignment = (force = false) => {
      if (!captioned) return;
      const now = Date.now();
      if (!force && now - lastNpWrite < 300) return;
      lastNpWrite = now;
      try {
        writeNowPlaying(sessionId, replayMeta, toTuples(getWords!()), startedAt, tempoRate);
      } catch {}
    };

    beginSessionPlayback(ctx, replayMeta, startedAt, tempoRate);
    const child = spawn("ffplay", ffplayArgs, {
      stdio: ["pipe", "ignore", "ignore"],
    });
    currentProcess = child;

    writePidFiles(child.pid);
    writeFileSync(PLAYBACK_FILE_REF, queueFile);
    writeFileSync(AUDIO_REF, "streaming");

    const replayChunks: Uint8Array[] = [];
    // Early-stop drain: keep consuming ElevenLabs after ffplay dies (credits
    // already spent) so the replay file is complete. Hard-capped at 90s from
    // player-kill (not stream start).
    const DRAIN_CAP_MS = 90_000;
    let streamDone = false;
    let playerClosed = false;
    let replaySaved = false;
    let drainDeadline: number | null = null;
    // Holder object: the resolver is assigned inside the close callback, which
    // TS flow analysis can't see — a plain let narrows to never at the call.
    const drain: { done: (() => void) | null } = { done: null };

    const saveAndStampReplay = () => {
      if (replaySaved || replayChunks.length === 0) return;
      replaySaved = true;
      if (replayMeta) {
        replayMeta.playbackRate = tempoRate;
        if (captioned) replayMeta.alignment = toTuples(getWords!());
      }
      const filename = saveReplayFile(replayChunks, queueFile, replayMeta);
      // B2: stamp into live or endedAt now-playing (CAS on sessionId+startedAt).
      if (filename && sessionId) {
        stampReplayFileCas(sessionId, startedAt, filename);
      }
    };

    let settled = false;
    const stopHealer = startSuspendHealer(child);
    const settle = (code: number) => {
      if (settled) return;
      settled = true;
      stopHealer();
      if (currentProcess === child) currentProcess = null;
      cleanup();
      // The queue file being played is still in queue/ here — the daemon moves
      // it to played/ only after this promise resolves — so exclude it from the
      // recompute scan, or it would re-derive a phantom hand for itself.
      endSessionPlayback(ctx, basename(queueFile));
      resolve(code);
    };

    // Missing ffplay → spawn "error" (close never fires): resolve instead
    // of wedging drainQueue. stdin "error" swallows EPIPE when playback is
    // killed mid-stream, which would otherwise crash the watcher.
    child.on("error", (err) => {
      log("audio", `ffplay spawn error: ${err.message}`);
      playerClosed = true;
      settle(1);
    });
    child.stdin?.on("error", () => {});

    child.on("close", (code) => {
      playerClosed = true;
      if (streamDone) {
        // Normal path: stream already finished (and usually already saved).
        saveAndStampReplay();
        settle(code ?? 0);
        return;
      }
      // Early stop (stop button / handoff): settle now — the caller's finally
      // releases the lock right after resolve, in the correct order (old state
      // published first). A detached drain keeps filling replayChunks and
      // saves on completion/cap. Exit code 130 = stopped, never "success"
      // (SIGTERM yields code null; ?? 0 would fire the victory line).
      drainDeadline = Date.now() + DRAIN_CAP_MS;
      pendingDrain = new Promise<void>((r) => {
        drain.done = r;
      });
      settle(130);
    });

    try {
      for await (const chunk of audioStream) {
        replayChunks.push(chunk);
        if (!playerClosed && child.stdin && !child.stdin.destroyed) {
          child.stdin.write(chunk);
        }
        if (!playerClosed) pushAlignment();
        // Detached drain after player-kill — stop at the hard cap.
        if (
          playerClosed &&
          drainDeadline != null &&
          Date.now() >= drainDeadline
        ) {
          log("audio", "Early-stop drain hit 90s cap — saving what we have");
          break;
        }
      }
      streamDone = true;
      if (!playerClosed) {
        child.stdin?.end();
        // Network stream finishes well ahead of realtime playback — flush the
        // full alignment now so the panel has every word before audio drains.
        pushAlignment(true);
        // Full audio is in hand while ffplay is still playing — save + stamp
        // so a mid-playback handoff already has replayFile on the record.
        saveAndStampReplay();
      } else {
        // Player died first: this is the detached drain completing (or capped).
        saveAndStampReplay();
      }
    } catch (err: any) {
      log("audio", `Stream pipe error: ${err.message}`);
      streamDone = true;
      if (!playerClosed) {
        child.kill("SIGTERM");
      } else {
        // Drain blew up after early stop — still persist what we buffered.
        saveAndStampReplay();
      }
    } finally {
      drain.done?.();
    }
  });
}

function loadReplayAttribution(filePath: string): {
  ctx: PlaybackContext;
  meta?: ReplayMeta;
} {
  let ctx: PlaybackContext = "meta";
  let meta: ReplayMeta | undefined;
  try {
    const sidecarPath = filePath.replace(/\.mp3$/, ".json");
    if (existsSync(sidecarPath)) {
      const parsed = JSON.parse(readFileSync(sidecarPath, "utf-8")) as ReplayMeta;
      meta = parsed;
      if (
        parsed.sessionId &&
        existsSync(join(STATE_DIR, `${parsed.sessionId}.json`))
      ) {
        ctx = { sessionId: parsed.sessionId };
      }
    }
  } catch {
    meta = undefined;
  }
  return { ctx, meta };
}

export function replayLast(
  nth = 1,
  speedFactor = 1.0,
  forSessionId?: string
): Promise<number> {
  try {
    if (!existsSync(REPLAY_DIR)) return Promise.resolve(1);
    let files = readdirSync(REPLAY_DIR)
      .filter((f) => f.endsWith(".mp3"))
      .sort();
    // Per-member replay: keep only files whose sidecar names this session.
    if (forSessionId) {
      files = files.filter((f) => {
        try {
          const sc = JSON.parse(
            readFileSync(join(REPLAY_DIR, f.replace(/\.mp3$/, ".json")), "utf-8")
          );
          return sc?.sessionId === forSessionId;
        } catch {
          return false;
        }
      });
    }
    if (files.length === 0) return Promise.resolve(1);
    const target = files[Math.max(0, files.length - nth)];
    const filePath = join(REPLAY_DIR, target);
    log("audio", `Replaying: ${target}${speedFactor !== 1.0 ? ` (speed×${speedFactor})` : ""}`);

    // Session-attributed when the sidecar names a still-alive session; otherwise
    // meta (orphan/corrupt/missing sidecar — same as pre-attribution behavior).
    const { ctx, meta } = loadReplayAttribution(filePath);
    return playFile(filePath, ctx, speedFactor, meta);
  } catch (err: any) {
    log("audio", `Replay error: ${err.message}`);
    return Promise.resolve(1);
  }
}

/**
 * Mobile play_replay: play a bare filename from ~/.cursor/tts/replay via
 * ffplay -ss <offset>. Free (no synthesis). Returns false if the file is
 * missing or the stream lock is held; otherwise acquires the lock, starts
 * playback (fire-and-forget), and releases on close.
 */
export function startPlayReplay(file: string, offsetSec = 0): boolean {
  const filePath = join(REPLAY_DIR, file);
  if (!existsSync(filePath)) return false;
  if (!acquireLock()) return false;

  const { ctx, meta } = loadReplayAttribution(filePath);
  const config = loadConfig();
  const rawSpeed = config.default_speed;
  const residual = rawSpeed > 1.2 ? +(rawSpeed / 1.2).toFixed(4) : 1.0;

  const ffplayArgs = [
    "-nodisp",
    "-autoexit",
    "-loglevel",
    "quiet",
    "-ss",
    String(offsetSec),
    "-i",
    filePath,
  ];
  if (residual > 1.0) ffplayArgs.push("-af", `atempo=${residual}`);

  log(
    "audio",
    `play_replay: ${file} offset=${offsetSec}s${residual > 1.0 ? ` atempo=${residual}` : ""}`
  );

  // Backdate startedAt by the seek offset (in wall time: file-time ÷ rate) so
  // progress renders the true position and a later Mac→phone hop resumes there.
  const startedAt = new Date(
    Date.now() - (offsetSec * 1000) / residual
  ).toISOString();
  beginSessionPlayback(ctx, meta, startedAt, residual);
  // Surface the file on now-playing so phone handoff can resume the same track.
  if (ctx !== "meta" && ctx.sessionId) {
    stampReplayFileCas(ctx.sessionId, startedAt, file);
  }

  const child = spawn("ffplay", ffplayArgs, { stdio: "ignore" });
  currentProcess = child;
  writePidFiles(child.pid);
  const stopHealer = startSuspendHealer(child);

  let settled = false;
  const settle = () => {
    if (settled) return;
    settled = true;
    stopHealer();
    if (currentProcess === child) currentProcess = null;
    removePidFiles();
    clearNowPlaying();
    endSessionPlayback(ctx);
    releaseLock();
  };
  child.on("error", (err) => {
    log("audio", `play_replay ffplay error: ${err.message}`);
    settle();
  });
  child.on("close", () => settle());
  return true;
}

export function playMp3Buffer(
  buf: Buffer,
  ctx: PlaybackContext = "meta",
  replayMeta?: ReplayMeta
): Promise<number> {
  return new Promise((resolve) => {
    const config = loadConfig();
    // Phrase MP3s are generated once at 1.0x and reused across speed
    // changes, so the full default_speed is applied at playback time.
    const speed = Math.min(2.0, Math.max(0.5, config.default_speed));
    const ffplayArgs = [
      "-nodisp",
      "-autoexit",
      "-loglevel",
      "quiet",
      "-i",
      "pipe:0",
    ];
    if (speed !== 1.0) ffplayArgs.push("-af", `atempo=${speed}`);

    beginSessionPlayback(ctx, replayMeta, undefined, speed);
    const child = spawn("ffplay", ffplayArgs, {
      stdio: ["pipe", "ignore", "ignore"],
    });
    currentProcess = child;
    writePidFiles(child.pid);

    let settled = false;
    const stopHealer = startSuspendHealer(child);
    const settle = (code: number) => {
      if (settled) return;
      settled = true;
      stopHealer();
      if (currentProcess === child) currentProcess = null;
      removePidFiles();
      clearNowPlaying();
      endSessionPlayback(ctx);
      resolve(code);
    };
    child.on("error", (err) => {
      log("audio", `ffplay spawn error: ${err.message}`);
      settle(1);
    });
    child.stdin?.on("error", () => {});
    child.on("close", (code) => settle(code ?? 0));

    child.stdin?.write(buf);
    child.stdin?.end();
  });
}
