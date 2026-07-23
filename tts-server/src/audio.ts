import { spawn } from "child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
} from "fs";
import { loadConfig } from "./config.js";
import { log } from "./logger.js";
import { join } from "path";
import { acquireLock, releaseLock } from "./playback-locks.js";
import {
  REPLAY_DIR,
  loadReplayAttribution,
  type ReplayMeta,
} from "./replay-store.js";
import {
  type PlaybackContext,
  endSessionPlayback,
  clearNowPlaying,
  beginSessionPlayback,
  stampReplayFileCas,
} from "./now-playing.js";
import {
  playerRef,
  writePidFiles,
  removePidFiles,
  startSuspendHealer,
} from "./player-process.js";

// Phase 7 split: locks, now-playing store, replay store, player process,
// and streaming playback live in their own modules (import them directly).
// This file keeps the simple whole-file/buffer players that share playerRef.

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
    playerRef.current = child;
    writePidFiles(child.pid);
    const stopHealer = startSuspendHealer(child);

    let settled = false;
    const settle = (code: number) => {
      if (settled) return;
      settled = true;
      stopHealer();
      if (playerRef.current === child) playerRef.current = null;
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
  playerRef.current = child;
  writePidFiles(child.pid);
  const stopHealer = startSuspendHealer(child);

  let settled = false;
  const settle = () => {
    if (settled) return;
    settled = true;
    stopHealer();
    if (playerRef.current === child) playerRef.current = null;
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
    playerRef.current = child;
    writePidFiles(child.pid);

    let settled = false;
    const stopHealer = startSuspendHealer(child);
    const settle = (code: number) => {
      if (settled) return;
      settled = true;
      stopHealer();
      if (playerRef.current === child) playerRef.current = null;
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
