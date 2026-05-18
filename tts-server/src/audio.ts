import { spawn, ChildProcess, execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from "fs";
import {
  STREAM_PID_FILE,
  STREAM_LOCK,
  PROCESSING_DIR,
  TTS_DIR,
  loadConfig,
} from "./config.js";
import { log } from "./logger.js";
import { join } from "path";

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

export function markProcessing(basename: string): void {
  mkdirSync(PROCESSING_DIR, { recursive: true });
  writeFileSync(join(PROCESSING_DIR, basename), String(process.pid));
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

export function waitForLock(timeoutMs = 120_000): Promise<boolean> {
  return new Promise((resolve) => {
    if (acquireLock()) return resolve(true);
    const start = Date.now();
    const interval = setInterval(() => {
      if (acquireLock()) {
        clearInterval(interval);
        resolve(true);
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(interval);
        writeFileSync(STREAM_LOCK, String(process.pid));
        log("audio", "Lock timeout — stealing");
        resolve(true);
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
  try {
    execSync("pkill -f 'ffplay.*cursor-tts' 2>/dev/null || true", {
      stdio: "ignore",
    });
  } catch {}
  try {
    execSync("pkill -f afplay 2>/dev/null || true", { stdio: "ignore" });
  } catch {}
  cleanup();
}

function cleanup(): void {
  for (const f of [STREAM_PID_FILE, PAUSED_FLAG, AUDIO_REF, PLAYBACK_FILE_REF]) {
    try { unlinkSync(f); } catch {}
  }
}

export function playFile(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    const config = loadConfig();
    const speed = config.default_speed;
    const args = [filePath];
    if (speed !== 1.0) args.push("-r", String(speed));

    const child = spawn("afplay", args, { stdio: "ignore" });
    currentProcess = child;
    child.on("close", (code) => {
      if (currentProcess === child) currentProcess = null;
      resolve(code ?? 0);
    });
  });
}

export function playStreamBuffer(
  audioStream: AsyncIterable<Uint8Array>,
  queueFile: string
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

    writeFileSync(STREAM_PID_FILE, String(child.pid));
    writeFileSync(PLAYBACK_FILE_REF, queueFile);
    writeFileSync(AUDIO_REF, "streaming");

    child.on("close", (code) => {
      if (currentProcess === child) currentProcess = null;
      cleanup();
      resolve(code ?? 0);
    });

    try {
      for await (const chunk of audioStream) {
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

export function playMp3Buffer(buf: Buffer): Promise<number> {
  return new Promise((resolve) => {
    const ffplayArgs = [
      "-nodisp",
      "-autoexit",
      "-loglevel",
      "quiet",
      "-i",
      "pipe:0",
    ];

    const child = spawn("ffplay", ffplayArgs, {
      stdio: ["pipe", "ignore", "ignore"],
    });
    currentProcess = child;

    child.on("close", (code) => {
      if (currentProcess === child) currentProcess = null;
      resolve(code ?? 0);
    });

    child.stdin?.write(buf);
    child.stdin?.end();
  });
}
