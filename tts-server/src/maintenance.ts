/**
 * Startup housekeeping (Phase 1 recovery slice): log rotation and
 * played/failed retention, enforced by the daemon itself instead of relying
 * on cleanup_played.sh riding along with ingest (which let played/ drift to
 * ~9x its configured cap when ingest was quiet).
 *
 * Everything here is best-effort and side-effect-bounded: failures log and
 * move on — housekeeping must never block the daemon from starting.
 */
import { existsSync, readdirSync, renameSync, statSync, unlinkSync } from "fs";
import { join } from "path";
import { LOG_FILE, PLAYED_DIR, FAILED_DIR, loadConfig } from "./config.js";
import { log } from "./logger.js";

const MAX_LOG_BYTES = 5 * 1024 * 1024;

/**
 * Single-slot rotation: hook.log → hook.log.1 (replacing any previous .1).
 * Runs BEFORE the first log() of the session so the rename can't race an
 * append from this process; other writers (hook shells) just start appending
 * to a fresh file after the rename.
 */
export function rotateLogIfLarge(path = LOG_FILE, maxBytes = MAX_LOG_BYTES): void {
  try {
    if (!existsSync(path) || statSync(path).size <= maxBytes) return;
    const rotated = `${path}.1`;
    if (existsSync(rotated)) unlinkSync(rotated);
    renameSync(path, rotated);
  } catch {
    /* best-effort — never block startup on log hygiene */
  }
}

/**
 * Delete the oldest queue-artifact JSONs (by mtime) beyond `keep`. Only
 * *.json is touched — matching cleanup_played.sh, which also treats keep=0
 * as "keep none". Returns count removed.
 */
function pruneDirByCount(dir: string, keep: number): number {
  if (keep < 0 || !existsSync(dir)) return 0;
  let entries: { name: string; mtime: number }[];
  try {
    entries = readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => {
        try {
          const st = statSync(join(dir, name));
          return st.isFile() ? { name, mtime: st.mtimeMs } : null;
        } catch {
          return null;
        }
      })
      .filter((e): e is { name: string; mtime: number } => e !== null);
  } catch {
    return 0;
  }
  if (entries.length <= keep) return 0;
  entries.sort((a, b) => b.mtime - a.mtime); // newest first
  let removed = 0;
  for (const e of entries.slice(keep)) {
    try {
      unlinkSync(join(dir, e.name));
      removed++;
    } catch {
      /* skip unremovable file */
    }
  }
  return removed;
}

/** Enforce played/ + failed/ retention. Call once at daemon startup. */
export function runStartupRetention(): void {
  const cfg = loadConfig();
  const played = pruneDirByCount(PLAYED_DIR, cfg.played_retention_count);
  const failed = pruneDirByCount(FAILED_DIR, cfg.failed_retention_count);
  if (played || failed) {
    log(
      "maintenance",
      `retention pruned ${played} played, ${failed} failed (keep ${cfg.played_retention_count}/${cfg.failed_retention_count})`,
    );
  }
}

/** Cheap idempotent housekeeping for the 60s reaper (M-9). */
export function runPeriodicMaintenance(): void {
  rotateLogIfLarge();
  runStartupRetention();
}
