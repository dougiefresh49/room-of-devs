import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

// T3 Code's local orchestration store. Its "Settle" button only reclassifies
// the thread (settledOverride) + stops any idle provider session — no signal
// reaches the Claude Code harness that we could hook, so the room reads the
// thread state straight from T3's projection tables (read-only).
// T3's v2 orchestration (2026-10) moved the store to statev2.sqlite: the
// Claude Code sessionId is a provider thread's nativeThreadRef.nativeId, and
// settledOverride lives in the v2 thread's payload_json. Threads migrated
// from v1 keep their old sessionId in provider_session_runtime, so both maps
// feed the join. The v1 file (state.sqlite) lingers stale after migration,
// so it is read only when no v2 store exists.
const T3_USERDATA = join(homedir(), ".t3", "userdata");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Both shapes expose s(sid, thread_id) and t(thread_id, project_id, title,
// settled, archived_at, deleted_at) to the queries below.
const V2_CTE = `WITH s(sid, thread_id) AS (
  SELECT json_extract(payload_json,'$.nativeThreadRef.nativeId'), thread_id
  FROM orchestration_v2_projection_provider_threads WHERE thread_id IS NOT NULL
  UNION
  SELECT json_extract(resume_cursor_json,'$.resume'), thread_id FROM provider_session_runtime
), t(thread_id, project_id, title, settled, archived_at, deleted_at) AS (
  SELECT thread_id, project_id, title, json_extract(payload_json,'$.settledOverride'),
    archived_at, deleted_at
  FROM orchestration_v2_projection_threads
)`;
const V1_CTE = `WITH s(sid, thread_id) AS (
  SELECT json_extract(resume_cursor_json,'$.resume'), thread_id FROM provider_session_runtime
), t(thread_id, project_id, title, settled, archived_at, deleted_at) AS (
  SELECT thread_id, project_id, title, settled_override, archived_at, deleted_at
  FROM projection_threads
)`;

/** The live T3 store and its CTE, re-checked per call (T3 can migrate under us). */
function t3Store(): { db: string; cte: string } | null {
  const v2 = join(T3_USERDATA, "statev2.sqlite");
  if (existsSync(v2)) return { db: v2, cte: V2_CTE };
  const v1 = join(T3_USERDATA, "state.sqlite");
  if (existsSync(v1)) return { db: v1, cte: V1_CTE };
  return null;
}

function queryT3(db: string, sql: string, extra: string[] = []): string[] | null {
  const r = spawnSync("sqlite3", [...extra, `file:${db}?mode=ro`, sql], {
    encoding: "utf-8",
    timeout: 3000,
  });
  if (r.status !== 0) return null;
  return r.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Resolve a Claude Code session to its one active T3 thread. T3 may retain
 * multiple historical runtime rows for a resume cursor, so settled/archived/
 * deleted threads are excluded and ambiguous active matches fail closed.
 */
export function t3ThreadIdForSession(sessionId: string): string | null {
  const store = t3Store();
  if (!UUID_RE.test(sessionId) || !store) return null;
  const sql = `${store.cte}
SELECT DISTINCT s.thread_id
FROM s JOIN t ON t.thread_id = s.thread_id
WHERE s.sid='${sessionId}'
  AND t.deleted_at IS NULL
  AND t.archived_at IS NULL
  AND t.settled IS NOT 'settled'
LIMIT 2;`;
  try {
    const ids = queryT3(store.db, sql);
    return ids?.length === 1 ? ids[0]! : null;
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
  const store = t3Store();
  if (ids.length === 0 || !store) return done;
  const inList = ids.map((s) => `'${s}'`).join(",");
  const sql = `${store.cte}
SELECT s.sid
FROM s JOIN t ON t.thread_id = s.thread_id
WHERE s.sid IN (${inList})
GROUP BY 1
HAVING SUM(CASE WHEN t.settled='settled'
                  OR t.archived_at IS NOT NULL
                  OR t.deleted_at IS NOT NULL THEN 0 ELSE 1 END) = 0;`;
  try {
    for (const s of queryT3(store.db, sql) ?? []) done.add(s);
  } catch {
    /* best-effort */
  }
  return done;
}

export interface T3ThreadLabel {
  title: string;
  project: string;
  /** The T3 project's workspace root (repo checkout), when T3 recorded one. */
  root?: string | null;
}

const LABEL_TTL_MS = 15_000;
let labelCache: { key: string; at: number; labels: Map<string, T3ThreadLabel> } | null = null;

/**
 * Thread and project titles for the given Claude sessionIds' active T3
 * threads, for display. Sessions with zero or several active threads are
 * omitted. Cached briefly: snapshot builds call this on every state change.
 */
export function t3ThreadLabels(sessionIds: string[]): Map<string, T3ThreadLabel> {
  const ids = sessionIds.filter((s) => UUID_RE.test(s)).sort();
  // Nothing to look up (a CLI session's voice resolution): answer without
  // touching the cache, so the snapshot's batch survives for the next build.
  if (ids.length === 0) return new Map();
  const key = ids.join(",");
  if (labelCache && Date.now() - labelCache.at < LABEL_TTL_MS) {
    if (labelCache.key === key) return labelCache.labels;
    // A single-session lookup (voice resolution at speak time) is answered
    // from the snapshot's batch instead of evicting it with a one-id query.
    const cached = new Set(labelCache.key.split(","));
    if (ids.length > 0 && ids.every((id) => cached.has(id))) {
      const subset = new Map<string, T3ThreadLabel>();
      for (const id of ids) {
        const hit = labelCache.labels.get(id);
        if (hit) subset.set(id, hit);
      }
      return subset;
    }
  }
  const labels = new Map<string, T3ThreadLabel>();
  const store = t3Store();
  if (store) {
    const inList = ids.map((s) => `'${s}'`).join(",");
    const sql = `${store.cte}
SELECT s.sid,
  json_object('title', t.title, 'project', p.title, 'root', p.workspace_root)
FROM s
JOIN t ON t.thread_id = s.thread_id
JOIN projection_projects p ON p.project_id = t.project_id
WHERE s.sid IN (${inList})
  AND t.deleted_at IS NULL
  AND t.archived_at IS NULL
  AND t.settled IS NOT 'settled'
GROUP BY 1
HAVING COUNT(DISTINCT t.thread_id) = 1;`;
    try {
      for (const line of queryT3(store.db, sql, ["-separator", "\t"]) ?? []) {
        const tab = line.indexOf("\t");
        if (tab < 0) continue;
        try {
          const row = JSON.parse(line.slice(tab + 1)) as T3ThreadLabel;
          if (row.title) labels.set(line.slice(0, tab), row);
        } catch {
          /* skip malformed row */
        }
      }
    } catch {
      /* best-effort: tiles fall back to the session name */
    }
  }
  labelCache = { key, at: Date.now(), labels };
  return labels;
}
