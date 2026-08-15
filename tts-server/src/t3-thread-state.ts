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

/**
 * Of the given Claude sessionIds, the ones whose T3 thread the owner is done
 * with (explicitly settled, archived, or deleted). Sessions with no T3 thread
 * row are NOT returned — absence means unknown, not done. Best-effort: any
 * sqlite failure returns the empty set (the inactivity TTL still governs).
 */
export function t3DoneSessionIds(sessionIds: string[]): Set<string> {
  const done = new Set<string>();
  const ids = sessionIds.filter((s) => /^[0-9a-f-]{36}$/.test(s));
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
