/**
 * Project voices (#97): the GET /project-voices payload and the
 * set_project_voice command. Transports (mobile-http, panel-ws) stay thin;
 * the store lives in config.ts, resolution in session-voice.ts.
 */
import { existsSync, readdirSync, statSync } from "fs";
import { basename, dirname, join } from "path";
import { loadProjectVoices, saveProjectVoices } from "../config.js";
import { allCatalogSessions, listProjectsDirs } from "../session-catalog.js";
import { bumpSnapshot, buildPanelSnapshot } from "../state-watch.js";
import { isCharacterVoice, loadCharacterEntries, projectNameForDir } from "../session-voice.js";
import { log } from "../logger.js";
import { isValidProjectName, isValidVoiceIdField } from "../protocol/index.js";

export interface ProjectVoiceRow {
  name: string;
  /** ~/projects/<name>, or null for a project known only from a session or a voice entry. */
  dir: string | null;
  /** ISO time of the newest Claude session activity in this project, else the dir mtime. */
  lastActivityAt: string | null;
  /** The project's voice pick, null when unset (or no longer in characters.json). */
  voiceId: string | null;
  /** Character name for voiceId. */
  character: string | null;
}

export interface ProjectVoicesPayload {
  projects: ProjectVoiceRow[];
  characters: { voiceId: string; name: string }[];
}

/** A ~/projects child that only holds git worktrees of another repo
 *  (e.g. comic-reader-wt/, room-of-devs-worktrees/): not a project itself.
 *  Sessions inside one map to the main repo (session-voice.ts). */
function isWorktreeContainer(dir: string): boolean {
  if (existsSync(join(dir, ".git"))) return false;
  // "<repo>-wt" / "<repo>-worktrees" beside "<repo>", even when emptied out.
  const stem = /^(.+?)-(wt|worktrees)$/.exec(basename(dir))?.[1];
  if (stem && existsSync(join(dirname(dir), stem))) return true;
  try {
    let checked = 0;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      try {
        if (statSync(join(dir, entry.name, ".git")).isFile()) return true;
      } catch {
        /* not a checkout */
      }
      if (++checked >= 5) break;
    }
  } catch {
    /* unreadable: treat as a plain dir */
  }
  return false;
}

function maxTs(map: Map<string, number>, key: string, ts: number): void {
  if (!Number.isFinite(ts)) return;
  if (ts > (map.get(key) ?? Number.NEGATIVE_INFINITY)) map.set(key, ts);
}

export function projectVoicesPayload(): ProjectVoicesPayload {
  const chars = loadCharacterEntries();
  const voices = loadProjectVoices();

  // Newest activity per project: transcript mtimes from the catalog's memoized
  // scan (no second traversal), plus live room cards' last hook touch.
  const activity = new Map<string, number>();
  for (const s of allCatalogSessions()) {
    const project = projectNameForDir(s.dir);
    if (project) maxTs(activity, project, s.mtimeMs);
  }
  const activeProjects = new Set<string>();
  for (const agent of buildPanelSnapshot().agents) {
    if (!agent.project) continue;
    activeProjects.add(agent.project);
    if (agent.lastActivityAt) maxTs(activity, agent.project, Date.parse(agent.lastActivityAt));
  }

  const rows = new Map<string, { name: string; dir: string | null; dirMtime: number | null }>();
  for (const { name, dir } of listProjectsDirs()) {
    if (isWorktreeContainer(dir)) continue;
    let dirMtime: number | null = null;
    try {
      dirMtime = statSync(dir).mtimeMs;
    } catch {
      /* vanished between list and stat */
    }
    rows.set(name, { name, dir, dirMtime });
  }
  for (const name of [...Object.keys(voices), ...activeProjects]) {
    if (!rows.has(name)) rows.set(name, { name, dir: null, dirMtime: null });
  }

  const projects = [...rows.values()].map((r) => {
    const ts = activity.get(r.name) ?? r.dirMtime;
    const stored = voices[r.name];
    const voiceId = stored && isCharacterVoice(stored) ? stored : null;
    return {
      name: r.name,
      dir: r.dir,
      lastActivityAt: ts != null && Number.isFinite(ts) ? new Date(ts).toISOString() : null,
      voiceId,
      character: voiceId ? (chars[voiceId]?.name?.trim() ?? null) : null,
      sortTs: ts ?? null,
    };
  });
  projects.sort((a, b) => {
    if (a.sortTs !== b.sortTs) {
      if (a.sortTs == null) return 1;
      if (b.sortTs == null) return -1;
      return b.sortTs - a.sortTs;
    }
    return a.name.localeCompare(b.name);
  });

  const characters = Object.entries(chars)
    .filter(([, c]) => c?.hidden !== true && typeof c?.name === "string" && c.name.trim())
    .map(([voiceId, c]) => ({ voiceId, name: c.name!.trim() }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { projects: projects.map(({ sortTs: _s, ...row }) => row), characters };
}

export type SetProjectVoiceResult = "ok" | "bad_message" | "bad_persona";

/**
 * Set or clear (voiceId "") one project's voice. Unknown voiceIds are
 * rejected so a typo can't silently route a project to the default voice.
 * A successful write pokes a snapshot rebroadcast (the watcher also sees
 * project_voices.json) so cards, avatars and car tiles update at once.
 */
export function setProjectVoice(project: unknown, voiceId: unknown): SetProjectVoiceResult {
  if (!isValidProjectName(project) || !isValidVoiceIdField(voiceId)) return "bad_message";
  if (voiceId && !isCharacterVoice(voiceId)) return "bad_persona";
  // Null-prototype copy: a project literally named "__proto__" stays a key.
  const map: Record<string, string> = Object.assign(Object.create(null), loadProjectVoices());
  if (voiceId) {
    if (map[project] === voiceId) return "ok";
    map[project] = voiceId;
  } else {
    if (!Object.hasOwn(map, project)) return "ok";
    delete map[project];
  }
  try {
    saveProjectVoices(map);
  } catch (err: any) {
    log("commands", `set_project_voice write failed: ${err?.message ?? err}`);
    return "bad_message";
  }
  log("commands", `project voice ${project} → ${voiceId || "(cleared)"}`);
  bumpSnapshot();
  return "ok";
}
