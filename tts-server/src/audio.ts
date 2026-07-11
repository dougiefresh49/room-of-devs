import { spawn, ChildProcess } from "child_process";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  mkdirSync,
  readdirSync,
  renameSync,
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
export type AlignmentTuples = [string, number][];

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

export interface NowPlaying {
  sessionId: string;
  text: string;
  startedAt: string;
  approxCharsPerSec: number;
  // Word-level karaoke timings (ElevenLabs timestamps). When present the panel
  // highlights the current word instead of running the time-paced marquee.
  alignment?: AlignmentTuples;
  // Post-EL atempo factor only (1.0 when none). Speed ≤1.2 is baked into the
  // streamed audio + timestamp alignment together at synthesis time.
  playbackRate?: number;
  // The pre-Gemini original message (what the agent actually wrote) — the
  // panel's summary bubble shows this, not the character rewrite.
  rawText?: string;
  // Present once playback finished: the file lingers as "last spoken" so the
  // bubble can keep showing the previous message until the next one starts.
  endedAt?: string;
  // "ack" = short prompt acknowledgment — the panel keeps it off the stage
  // (no spotlight/card growth); absent/"update" = full treatment.
  kind?: "ack" | "update";
}

function writeNowPlaying(
  sessionId: string,
  meta?: ReplayMeta,
  alignment?: AlignmentTuples,
  startedAt?: string,
  playbackRate = 1.0
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
  };
  const tmp = `${NOW_PLAYING_PATH}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(data));
  renameSync(tmp, NOW_PLAYING_PATH);
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

    let settled = false;
    const settle = (code: number) => {
      if (settled) return;
      settled = true;
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
  // "ack" keeps short prompt acknowledgments off the panel's stage.
  kind?: "ack" | "update";
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
  ctx: PlaybackContext = "meta",
  replayMeta?: ReplayMeta,
  // When provided (timestamps path), poll accumulated word timings and thread
  // them into .now-playing.json (live) + the replay sidecar (persisted).
  getWords?: () => WordTiming[]
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

    let settled = false;
    const settle = (code: number, saveReplay: boolean) => {
      if (settled) return;
      settled = true;
      if (currentProcess === child) currentProcess = null;
      cleanup();
      if (saveReplay && replayChunks.length > 0) {
        if (captioned && replayMeta) {
          replayMeta.alignment = toTuples(getWords!());
          replayMeta.playbackRate = tempoRate;
        }
        saveReplayFile(replayChunks, queueFile, replayMeta);
      }
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
        pushAlignment();
      }
      child.stdin?.end();
      // Network stream finishes well ahead of realtime playback — flush the
      // full alignment now so the panel has every word before audio drains.
      pushAlignment(true);
    } catch (err: any) {
      log("audio", `Stream pipe error: ${err.message}`);
      child.kill("SIGTERM");
    }
  });
}

export function replayLast(nth = 1, speedFactor = 1.0): Promise<number> {
  try {
    if (!existsSync(REPLAY_DIR)) return Promise.resolve(1);
    const files = readdirSync(REPLAY_DIR)
      .filter((f) => f.endsWith(".mp3"))
      .sort();
    if (files.length === 0) return Promise.resolve(1);
    const target = files[Math.max(0, files.length - nth)];
    const filePath = join(REPLAY_DIR, target);
    log("audio", `Replaying: ${target}${speedFactor !== 1.0 ? ` (speed×${speedFactor})` : ""}`);

    // Session-attributed when the sidecar names a still-alive session; otherwise
    // meta (orphan/corrupt/missing sidecar — same as pre-attribution behavior).
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

    return playFile(filePath, ctx, speedFactor, meta);
  } catch (err: any) {
    log("audio", `Replay error: ${err.message}`);
    return Promise.resolve(1);
  }
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
    const settle = (code: number) => {
      if (settled) return;
      settled = true;
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
