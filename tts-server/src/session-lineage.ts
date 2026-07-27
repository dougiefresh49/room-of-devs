import { existsSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { pathToFileURL } from "url";
import {
  TTS_DIR,
  STATE_DIR,
  SESSIONS_DIR,
  SESSION_VOICES_PATH,
  MUTED_SESSIONS_PATH,
  NICKNAMES_PATH,
} from "./config.js";
import { loadTeamMap, writeTeamMap } from "./team-map.js";
import { purgeSessionQueue } from "./state.js";
import { log } from "./logger.js";

// Claude Code's /clear (and /resume) keeps the same process — and therefore the
// same ~/.claude/sessions/<pid>.json registry file — but rotates the sessionId
// inside it. Everything in the room is keyed by sessionId (voice, state card,
// nickname, mute, team entry), so without intervention each /clear orphans the
// character binding and spawns a fresh default-voice card. This module tracks
// pid → sessionId lineage and migrates all sessionId-keyed state when the id
// under a pid rotates. startedAt guards against pid reuse: a genuinely new
// process must not inherit a predecessor's persona.
const LINEAGE_PATH = join(TTS_DIR, "session_lineage.json");

interface LineageEntry {
  sessionId: string;
  startedAt: number;
}

type Lineage = Record<string, LineageEntry>;

function atomicWriteJson(path: string, data: unknown): void {
  const tmp = `${path}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  renameSync(tmp, path);
}

function loadLineage(): Lineage {
  try {
    if (!existsSync(LINEAGE_PATH)) return {};
    const raw = JSON.parse(readFileSync(LINEAGE_PATH, "utf-8"));
    const out: Lineage = {};
    for (const [pid, entry] of Object.entries(raw as Record<string, unknown>)) {
      const e = entry as Partial<LineageEntry> | null;
      if (e && typeof e.sessionId === "string" && typeof e.startedAt === "number") {
        out[pid] = { sessionId: e.sessionId, startedAt: e.startedAt };
      }
    }
    return out;
  } catch {
    return {};
  }
}

function readRegistry(): Lineage {
  const out: Lineage = {};
  try {
    if (!existsSync(SESSIONS_DIR)) return out;
    for (const f of readdirSync(SESSIONS_DIR)) {
      if (!f.endsWith(".json")) continue;
      try {
        const data = JSON.parse(readFileSync(join(SESSIONS_DIR, f), "utf-8")) as {
          pid?: unknown;
          sessionId?: unknown;
          startedAt?: unknown;
        };
        if (typeof data.sessionId !== "string" || !data.sessionId) continue;
        const pid = typeof data.pid === "number" ? String(data.pid) : f.slice(0, -5);
        out[pid] = {
          sessionId: data.sessionId,
          startedAt: typeof data.startedAt === "number" ? data.startedAt : 0,
        };
      } catch {
        /* skip malformed registry file */
      }
    }
  } catch {
    /* sessions dir unreadable */
  }
  return out;
}

// Move map[oldId] → map[newId] unless newId already has an explicit entry.
function rekeyJsonMap(path: string, oldId: string, newId: string): boolean {
  try {
    if (!existsSync(path)) return false;
    const data = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
    if (!(oldId in data)) return false;
    if (!(newId in data)) data[newId] = data[oldId];
    delete data[oldId];
    atomicWriteJson(path, data);
    return true;
  } catch {
    return false;
  }
}

function rekeyMutedList(oldId: string, newId: string): boolean {
  try {
    if (!existsSync(MUTED_SESSIONS_PATH)) return false;
    const data = JSON.parse(readFileSync(MUTED_SESSIONS_PATH, "utf-8"));
    if (!Array.isArray(data) || !data.includes(oldId)) return false;
    const next = data.filter((id) => id !== oldId);
    if (!next.includes(newId)) next.push(newId);
    atomicWriteJson(MUTED_SESSIONS_PATH, next);
    return true;
  } catch {
    return false;
  }
}

function rekeyTeamMap(oldId: string, newId: string): boolean {
  const team = loadTeamMap();
  let changed = false;
  for (const entry of Object.values(team)) {
    if (entry?.sessionId === oldId) {
      entry.sessionId = newId;
      changed = true;
    }
  }
  if (changed) writeTeamMap(team);
  return changed;
}

// Carry the room card across: same name/state, new key. If a hook for the new
// session already created a card, the new one wins and the ghost is dropped.
function rekeyStateFile(oldId: string, newId: string): boolean {
  const oldPath = join(STATE_DIR, `${oldId}.json`);
  try {
    if (!existsSync(oldPath)) return false;
    const newPath = join(STATE_DIR, `${newId}.json`);
    if (existsSync(newPath)) {
      unlinkSync(oldPath);
      return true;
    }
    const data = JSON.parse(readFileSync(oldPath, "utf-8")) as Record<string, unknown>;
    data.sessionId = newId;
    atomicWriteJson(newPath, data);
    unlinkSync(oldPath);
    return true;
  } catch {
    return false;
  }
}

function migrate(oldId: string, newId: string): void {
  const moved: string[] = [];
  if (rekeyJsonMap(SESSION_VOICES_PATH, oldId, newId)) moved.push("voice");
  if (rekeyJsonMap(NICKNAMES_PATH, oldId, newId)) moved.push("nickname");
  if (rekeyMutedList(oldId, newId)) moved.push("mute");
  if (rekeyTeamMap(oldId, newId)) moved.push("team");
  if (rekeyStateFile(oldId, newId)) moved.push("state");
  // Queued items from the cleared conversation are stale — dismiss them the
  // same way re-engaging a session does (moved to played/, still replayable).
  const purged = purgeSessionQueue(oldId);
  log(
    "lineage",
    `Session rotated ${oldId.slice(0, 12)} → ${newId.slice(0, 12)}; migrated [${moved.join(", ") || "nothing"}]${purged ? `, dismissed ${purged} queued` : ""}`,
  );
}

// Compare the live registry against the last-seen lineage; migrate any pid
// whose sessionId rotated in place. Cheap (a handful of small files) — safe to
// run on every registry change, debounced by the caller.
export function reconcileSessionLineage(): void {
  try {
    const current = readRegistry();
    const previous = loadLineage();

    for (const [pid, now] of Object.entries(current)) {
      const before = previous[pid];
      if (before && before.sessionId !== now.sessionId && before.startedAt === now.startedAt) {
        migrate(before.sessionId, now.sessionId);
      }
    }

    // Persist current truth (also drops entries for exited processes).
    const changed = JSON.stringify(current) !== JSON.stringify(previous);
    if (changed) atomicWriteJson(LINEAGE_PATH, current);
  } catch (err: any) {
    log("lineage", `reconcile failed: ${err?.message ?? err}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === "reconcile") {
    reconcileSessionLineage();
    process.exit(0);
  }
  console.error("Usage: tsx src/session-lineage.ts reconcile");
  process.exit(1);
}
