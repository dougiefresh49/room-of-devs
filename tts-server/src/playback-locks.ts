import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, renameSync } from "fs";
import { STREAM_LOCK, PROCESSING_DIR } from "./config.js";
import { log } from "./logger.js";
import { join } from "path";

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

/**
 * Atomically remove a stale lock/marker file so exactly ONE contender may
 * proceed to re-create it. A bare unlink+wx pair races: two processes can
 * both observe the stale file, both unlink (the second deleting the first's
 * fresh claim), and both win. rename() is atomic — only one succeeds; the
 * loser gets ENOENT and must back off.
 */
function takeoverStale(path: string): boolean {
  const quarantine = `${path}.stale.${process.pid}`;
  try {
    renameSync(path, quarantine);
  } catch {
    return false; // another process won the takeover (or holder came back)
  }
  try {
    unlinkSync(quarantine);
  } catch {
    /* best-effort — quarantine files are inert */
  }
  return true;
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
    if (!takeoverStale(marker)) return false; // lost the reclaim race
    try {
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
  // Exclusive-create, like claimProcessing: holders include OTHER processes
  // (phrases.ts, announce.ts, play_node.sh), so a check-then-write here was
  // a real interprocess race — two winners talk over each other and the
  // second releaseLock() deletes the first's lock.
  try {
    writeFileSync(STREAM_LOCK, String(process.pid), { flag: "wx" });
    return true;
  } catch {
    // Lock exists — take over only from a dead holder.
    try {
      process.kill(Number(readFileSync(STREAM_LOCK, "utf-8").trim()), 0);
      return false; // live holder
    } catch {
      /* holder dead or lock unreadable — reclaim below */
    }
    if (!takeoverStale(STREAM_LOCK)) return false; // lost the reclaim race
    try {
      writeFileSync(STREAM_LOCK, String(process.pid), { flag: "wx" });
      return true;
    } catch {
      return false; // a third process created a fresh lock first
    }
  }
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
        if (!holderAlive && acquireLock()) {
          // acquireLock's wx path does the dead-holder takeover atomically —
          // a raw overwrite here could clobber a lock someone else just won.
          clearInterval(interval);
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
