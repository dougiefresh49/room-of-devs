import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

// T3 Code's local orchestration store. Its "Settle" button only reclassifies
// the thread (settled_override) + stops any idle provider session — no signal
// reaches the Claude Code harness that we could hook, so the room reads the
// thread state straight from T3's projection tables (read-only).
// Mapping: provider_session_runtime.resume_cursor_json.$.resume is the Claude
// Code sessionId (persists across T3's stop/resume cycles) → thread_id →
// projection_threads settled/archived/deleted flags.
const T3_STATE_DB = join(homedir(), ".t3", "userdata", "state.sqlite");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve a Claude Code session to its one active T3 thread. T3 may retain
 * multiple historical runtime rows for a resume cursor, so settled/archived/
 * deleted threads are excluded and ambiguous active matches fail closed.
 */
export function t3ThreadIdForSession(sessionId: string): string | null {
  if (!UUID_RE.test(sessionId) || !existsSync(T3_STATE_DB)) return null;
  const sql = `SELECT DISTINCT r.thread_id
FROM provider_session_runtime r
JOIN projection_threads t ON t.thread_id = r.thread_id
WHERE json_extract(r.resume_cursor_json,'$.resume')='${sessionId}'
  AND t.deleted_at IS NULL
  AND t.archived_at IS NULL
  AND t.settled_override IS NOT 'settled'
LIMIT 2;`;
  try {
    const r = spawnSync("sqlite3", [`file:${T3_STATE_DB}?mode=ro`, sql], {
      encoding: "utf-8",
      timeout: 3000,
    });
    if (r.status !== 0) return null;
    const ids = r.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    return ids.length === 1 ? ids[0]! : null;
  } catch {
    return null;
  }
}

/**
 * Of the given Claude sessionIds, the ones whose T3 thread the owner is done
 * with (explicitly settled, archived, or deleted). Sessions with no T3 thread
 * row are NOT returned — absence means unknown, not done. Best-effort: any
 * sqlite failure returns the empty set (the inactivity TTL still governs).
 */
export function t3DoneSessionIds(sessionIds: string[]): Set<string> {
  const done = new Set<string>();
  const ids = sessionIds.filter((s) => UUID_RE.test(s));
  if (ids.length === 0 || !existsSync(T3_STATE_DB)) return done;
  const inList = ids.map((s) => `'${s}'`).join(",");
  const sql = `SELECT json_extract(r.resume_cursor_json,'$.resume')
FROM provider_session_runtime r
JOIN projection_threads t ON t.thread_id = r.thread_id
WHERE json_extract(r.resume_cursor_json,'$.resume') IN (${inList})
GROUP BY 1
HAVING SUM(CASE WHEN t.settled_override='settled'
                  OR t.archived_at IS NOT NULL
                  OR t.deleted_at IS NOT NULL THEN 0 ELSE 1 END) = 0;`;
  try {
    const r = spawnSync("sqlite3", [`file:${T3_STATE_DB}?mode=ro`, sql], {
      encoding: "utf-8",
      timeout: 3000,
    });
    if (r.status !== 0) return done;
    for (const line of r.stdout.split("\n")) {
      const s = line.trim();
      if (s) done.add(s);
    }
  } catch {
    /* best-effort */
  }
  return done;
}
