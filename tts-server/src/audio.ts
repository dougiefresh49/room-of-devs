import { spawn, ChildProcess } from "child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, readdirSync } from "fs";
import {
  STREAM_PID_FILE,
  PLAYBACK_PID_FILE,
  STREAM_LOCK,
  PROCESSING_DIR,
  TTS_DIR,
  loadConfig,
} from "./config.js";
import { log } from "./logger.js";
import { join } from "path";

const REPLAY_DIR = join(TTS_DIR, "replay");
const MAX_REPLAY_FILES = 20;

const PAUSED_FLAG = join(TTS_DIR, ".playback-paused");
const PLAYBACK_FILE_REF = join(TTS_DIR, ".playback-file");
const AUDIO_REF = join(TTS_DIR, ".playback-audio");

let currentProcess: ChildProcess | null = null;

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

export function stopCurrent(): void {
  if (currentProcess && !currentProcess.killed) {
    currentProcess.kill("SIGTERM");
    currentProcess = null;
  }
  // Kill by PID file — works even from a fresh process where
  // currentProcess is null (e.g. `tsx src/index.ts stop`).
  for (const pidFile of [STREAM_PID_FILE, PLAYBACK_PID_FILE]) {
    try {
      const pid = Number(readFileSync(pidFile, "utf-8").trim());
      if (pid > 0) process.kill(pid, "SIGTERM");
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
  for (const f of [PAUSED_FLAG, AUDIO_REF, PLAYBACK_FILE_REF]) {
    try { unlinkSync(f); } catch {}
  }
}

export function playFile(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    const config = loadConfig();
    // Replay files were saved from ElevenLabs streams, which bake in speed
    // up to the API max of 1.2x. Only the residual factor above 1.2 needs
    // applying here — using the full default_speed would over-speed them.
    const rawSpeed = config.default_speed;
    const speed = rawSpeed > 1.2 ? +(rawSpeed / 1.2).toFixed(4) : 1.0;
    const args = [filePath];
    if (speed !== 1.0) args.push("-r", String(speed));

    const child = spawn("afplay", args, { stdio: "ignore" });
    currentProcess = child;
    writePidFiles(child.pid);

    let settled = false;
    const settle = (code: number) => {
      if (settled) return;
      settled = true;
      if (currentProcess === child) currentProcess = null;
      removePidFiles();
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
  timestamp: string;
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
  } catch {}
}

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
    return filePath;
  } catch (err: any) {
    log("audio", `Failed to save replay: ${err.message}`);
    return null;
  }
}

export function playStreamBuffer(
  audioStream: AsyncIterable<Uint8Array>,
  queueFile: string,
  replayMeta?: ReplayMeta
): Promise<number> {
  return new Promise(async (resolve) => {
    const config = loadConfig();
    const rawSpeed = config.default_speed;
    const elMax = 1.2;
    const tempoRate = rawSpeed > elMax ? +(rawSpeed / elMax).toFixed(4) : 1.0;

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

    const child = spawn("ffplay", ffplayArgs, {
      stdio: ["pipe", "ignore", "ignore"],
    });
    currentProcess = child;

    writePidFiles(child.pid);
    writeFileSync(PLAYBACK_FILE_REF, queueFile);
    writeFileSync(AUDIO_REF, "streaming");

    const replayChunks: Uint8Array[] = [];

    let settled = false;
    const settle = (code: number, saveReplay: boolean) => {
      if (settled) return;
      settled = true;
      if (currentProcess === child) currentProcess = null;
      cleanup();
      if (saveReplay && replayChunks.length > 0) {
        saveReplayFile(replayChunks, queueFile, replayMeta);
      }
      resolve(code);
    };

    // Missing ffplay → spawn "error" (close never fires): resolve instead
    // of wedging drainQueue. stdin "error" swallows EPIPE when playback is
    // killed mid-stream, which would otherwise crash the watcher.
    child.on("error", (err) => {
      log("audio", `ffplay spawn error: ${err.message}`);
      settle(1, false);
    });
    child.stdin?.on("error", () => {});

    child.on("close", (code) => settle(code ?? 0, true));

    try {
      for await (const chunk of audioStream) {
        replayChunks.push(chunk);
        if (child.stdin && !child.stdin.destroyed) {
          child.stdin.write(chunk);
        }
      }
      child.stdin?.end();
    } catch (err: any) {
      log("audio", `Stream pipe error: ${err.message}`);
      child.kill("SIGTERM");
    }
  });
}

export function replayLast(nth = 1): Promise<number> {
  try {
    if (!existsSync(REPLAY_DIR)) return Promise.resolve(1);
    const files = readdirSync(REPLAY_DIR)
      .filter((f) => f.endsWith(".mp3"))
      .sort();
    if (files.length === 0) return Promise.resolve(1);
    const target = files[Math.max(0, files.length - nth)];
    const filePath = join(REPLAY_DIR, target);
    log("audio", `Replaying: ${target}`);
    return playFile(filePath);
  } catch (err: any) {
    log("audio", `Replay error: ${err.message}`);
    return Promise.resolve(1);
  }
}

export function playMp3Buffer(buf: Buffer): Promise<number> {
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

    const child = spawn("ffplay", ffplayArgs, {
      stdio: ["pipe", "ignore", "ignore"],
    });
    currentProcess = child;
    writePidFiles(child.pid);

    let settled = false;
    const settle = (code: number) => {
      if (settled) return;
      settled = true;
      if (currentProcess === child) currentProcess = null;
      removePidFiles();
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
