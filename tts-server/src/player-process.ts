import { spawnSync, type ChildProcess } from "child_process";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from "fs";
import {
  STREAM_PID_FILE,
  PLAYBACK_PID_FILE,
  TTS_DIR,
} from "./config.js";
import { log } from "./logger.js";
import { join } from "path";
import { clearNowPlaying } from "./now-playing.js";

const PAUSED_FLAG = join(TTS_DIR, ".playback-paused");
export const PLAYBACK_FILE_REF = join(TTS_DIR, ".playback-file");
export const AUDIO_REF = join(TTS_DIR, ".playback-audio");

export const playerRef: { current: ChildProcess | null } = { current: null };

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

export function startSuspendHealer(child: ChildProcess): () => void {
  const timer = setInterval(() => healOrphanedSuspend(child), 3000);
  return () => clearInterval(timer);
}

export function stopCurrent(): void {
  if (playerRef.current && !playerRef.current.killed) {
    // A paused (SIGSTOPped) player never receives SIGTERM — resume first,
    // or the close event never fires and the session wedges on "speaking".
    playerRef.current.kill("SIGCONT");
    playerRef.current.kill("SIGTERM");
    playerRef.current = null;
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
// own reference; PLAYBACK_PID_FILE is what pause.sh reads.
export function writePidFiles(pid: number | undefined): void {
  if (!pid) return;
  writeFileSync(STREAM_PID_FILE, String(pid));
  writeFileSync(PLAYBACK_PID_FILE, String(pid));
}

export function removePidFiles(): void {
  for (const f of [STREAM_PID_FILE, PLAYBACK_PID_FILE]) {
    try { unlinkSync(f); } catch {}
  }
}

export function cleanup(): void {
  removePidFiles();
  clearNowPlaying();
  for (const f of [PAUSED_FLAG, AUDIO_REF, PLAYBACK_FILE_REF]) {
    try { unlinkSync(f); } catch {}
  }
}
