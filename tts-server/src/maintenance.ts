/**
 * Startup housekeeping (Phase 1 recovery slice): log rotation and
 * played/failed retention, enforced by the daemon itself instead of relying
 * on cleanup_played.sh riding along with ingest (which let played/ drift to
 * ~9x its configured cap when ingest was quiet).
 *
 * Everything here is best-effort and side-effect-bounded: failures log and
 * move on — housekeeping must never block the daemon from starting.
 */
import { existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from "fs";
import { join } from "path";
import { LOG_FILE, PLAYED_DIR, FAILED_DIR, QUEUE_DIR, STATE_DIR, loadConfig } from "./config.js";
import { log } from "./logger.js";
import { isProcessing } from "./playback-locks.js";
import { recomputeAfterPlayback } from "./state.js";

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

// Queue items older than this age out as dismissed (moved to played/), never
// failed/, never deleted — a dead session's raised hand shouldn't linger
// forever, but "aged out" is not "the agent failed" (issue #77).
const QUEUE_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * "<anything>-cc-<shortSession>.json" → shortSession, or null. Mirrors
 * ccShortSession in state-watch.ts — kept local rather than imported since
 * that one lives in the state-watch module's private scope.
 */
function ccShortSession(f: string): string | null {
  if (!f.endsWith(".json")) return null;
  const idx = f.lastIndexOf("-cc-");
  if (idx < 0) return null;
  const key = f.slice(idx + 4, -5);
  return key.length === 12 ? key : null;
}

/**
 * shortSession → full sessionId for every state file on disk. State files
 * are named `<fullSessionId>.json`; shortSession is the first 12 chars of
 * that id (same derivation state.ts uses for queue-suffix matching).
 */
function indexStateSessions(): Map<string, string> {
  const bySession = new Map<string, string>();
  try {
    if (!existsSync(STATE_DIR)) return bySession;
    for (const f of readdirSync(STATE_DIR)) {
      if (!f.endsWith(".json")) continue;
      const sid = f.slice(0, -5);
      bySession.set(sid.slice(0, 12), sid);
    }
  } catch {
    /* best-effort */
  }
  return bySession;
}

/**
 * Age out stale queue items as dismissed. Two independent triggers, either
 * moves the file to played/ (never failed/, never unlinked, nothing
 * synthesized):
 *   - older than QUEUE_MAX_AGE_MS, regardless of session.
 *   - orphaned: carries a `-cc-<short>` session marker but no matching state
 *     file exists, so the session that would have granted it is already
 *     gone. Files without a `-cc-` marker (manual/Cursor enqueues) are never
 *     orphan-checked, only aged by mtime — a fresh manual enqueue is safe.
 * A file mid-synthesis (isProcessing) is left alone either way. Sessions
 * that still have a state file get recomputed after their queue shrinks, so
 * the card leaves hand_raised; orphans have no state file to update.
 */
export function ageOutQueue(): void {
  try {
    if (!existsSync(QUEUE_DIR)) return;
    const stateSessions = indexStateSessions();
    const now = Date.now();
    let agedCount = 0;
    let orphanCount = 0;
    const toRecompute = new Set<string>();

    for (const f of readdirSync(QUEUE_DIR)) {
      if (!f.endsWith(".json")) continue;
      if (isProcessing(f)) continue;

      let mtime: number;
      try {
        mtime = statSync(join(QUEUE_DIR, f)).mtimeMs;
      } catch {
        continue;
      }
      const isAged = now - mtime > QUEUE_MAX_AGE_MS;

      const shortSession = ccShortSession(f);
      let reason: "age" | "orphan" | null = null;
      let fullSid: string | undefined;
      if (shortSession) {
        fullSid = stateSessions.get(shortSession);
        if (!fullSid) reason = "orphan";
        else if (isAged) reason = "age";
      } else if (isAged) {
        reason = "age";
      }
      if (!reason) continue;

      try {
        mkdirSync(PLAYED_DIR, { recursive: true });
        renameSync(join(QUEUE_DIR, f), join(PLAYED_DIR, f));
      } catch {
        continue;
      }
      if (reason === "age") {
        agedCount++;
        if (fullSid) toRecompute.add(fullSid);
      } else {
        orphanCount++;
      }
    }

    for (const sid of toRecompute) recomputeAfterPlayback(sid);

    if (agedCount || orphanCount) {
      log(
        "maintenance",
        `aged out ${agedCount + orphanCount} queue item(s) as dismissed (${agedCount} aged, ${orphanCount} orphaned)`,
      );
    }
  } catch (err: any) {
    log("maintenance", `ageOutQueue failed: ${err?.message ?? err}`);
  }
}

/** Enforce played/ + failed/ retention, then age out stale queue items.
 *  Call once at daemon startup. */
export function runStartupRetention(): void {
  const cfg = loadConfig();
  const played = pruneDirByCount(PLAYED_DIR, cfg.played_retention_count);
  // clear_failed parks acked items in failed/acked/; same retention cap so
  // the ack drawer can't grow without bound.
  const failed =
    pruneDirByCount(FAILED_DIR, cfg.failed_retention_count) +
    pruneDirByCount(join(FAILED_DIR, "acked"), cfg.failed_retention_count);
  if (played || failed) {
    log(
      "maintenance",
      `retention pruned ${played} played, ${failed} failed (keep ${cfg.played_retention_count}/${cfg.failed_retention_count})`,
    );
  }
  ageOutQueue();
}

/** Cheap idempotent housekeeping for the 60s reaper (M-9). runStartupRetention
 *  already calls ageOutQueue(), so it runs once per tick here, not twice. */
export function runPeriodicMaintenance(): void {
  rotateLogIfLarge();
  runStartupRetention();
}
