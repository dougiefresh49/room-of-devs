/**
 * Which project a session belongs to, and which voice it speaks in (#97).
 *
 * One project derivation feeds both the snapshot's `AgentView.project` and
 * voice resolution, so the name on a car tile is the key project_voices.json
 * uses. Voice resolution order:
 *   session_voices[sid]  (explicit: team.sh persona spawn, panel voice pick)
 *   → project_voices[project(sid)]  (only voiceIds present in characters.json)
 *   → config.elevenlabs_voice_id
 *
 * Writers keep using the raw maps; every reader that means "the voice this
 * session speaks in" goes through here.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { basename, dirname, join, resolve, sep } from "path";
import { homedir } from "os";
import {
  STATE_DIR,
  getActiveSessions,
  loadConfig,
  loadProjectVoices,
  loadSessionVoices,
} from "./config.js";
import { CHARACTERS_PATH } from "./characters-path.js";
import { t3ThreadLabels } from "./t3-thread-state.js";

const HOME = homedir();
const MAX_WALK_UP = 12;
const MEMO_CAP = 2000;

// ── Project derivation ──────────────────────────────────────────────────

/** dir → project name. Directory → repo mapping doesn't change under us, so
 *  the memo has no TTL; the cap only bounds a pathological cwd churn. */
const dirProjectMemo = new Map<string, string>();

/** Repo folder for a git checkout at or above `dir`, worktrees mapped to the
 *  main repo (their `.git` file points at `<repo>/.git/worktrees/<name>`). */
function gitRepoName(dir: string): string | null {
  let p = dir;
  for (let i = 0; i < MAX_WALK_UP; i++) {
    // Never treat $HOME (a dotfiles repo) or the filesystem root as a project.
    if (p === HOME || p === dirname(p)) return null;
    const dotGit = join(p, ".git");
    try {
      const st = statSync(dotGit);
      if (st.isDirectory()) return basename(p);
      if (st.isFile()) {
        const line = readFileSync(dotGit, "utf-8").trim();
        const m = /^gitdir:\s*(.+)$/m.exec(line);
        if (m) {
          const gitdir = resolve(p, m[1]!.trim());
          const wt = /^(.*)[\\/]\.git[\\/]worktrees[\\/][^\\/]+[\\/]?$/.exec(gitdir);
          if (wt?.[1]) return basename(wt[1]);
        }
        // Submodule or unusual layout: the checkout itself is the project.
        return basename(p);
      }
    } catch {
      /* no .git here; keep walking */
    }
    p = dirname(p);
  }
  return null;
}

/** Path-shape fallback for checkouts that no longer exist on disk. */
function patternProjectName(dir: string): string {
  const parts = dir.split(sep).filter(Boolean);
  const claudeWt = dir.indexOf(`${sep}.claude${sep}worktrees${sep}`);
  if (claudeWt > 0) return basename(dir.slice(0, claudeWt));
  if (dir.startsWith(HOME + sep)) {
    const rel = dir.slice(HOME.length + 1).split(sep);
    if ((rel[0] === ".cursor" || rel[0] === ".t3") && rel[1] === "worktrees" && rel[2]) {
      return rel[2];
    }
    if (rel[0] === "projects" && rel[1]) {
      // ~/projects/<repo>-wt/<branch>, ~/projects/<repo>-worktrees/<branch>
      const m = /^(.+?)-(wt|worktrees)$/.exec(rel[1]);
      if (m && rel[2] && existsSync(join(HOME, "projects", m[1]!))) return m[1]!;
      return rel[1];
    }
  }
  return parts[parts.length - 1] ?? dir;
}

/** Project name for a working directory: the repo it is a checkout of. */
export function projectNameForDir(dir: string): string | null {
  if (!dir) return null;
  const abs = resolve(dir);
  const memo = dirProjectMemo.get(abs);
  if (memo !== undefined) return memo;
  const name = gitRepoName(abs) ?? patternProjectName(abs);
  if (dirProjectMemo.size >= MEMO_CAP) dirProjectMemo.clear();
  dirProjectMemo.set(abs, name);
  return name;
}

export interface SessionProject {
  project: string | null;
  /** T3 Code thread title for SDK cards, else null. */
  threadTitle: string | null;
}

/** Last project seen per session, so a card keeps its project (and voice)
 *  after its registry file disappears (T3 idle teardown, dead pid). */
const lastKnownProject = new Map<string, string>();

/**
 * Batch project derivation: one registry read and one T3 query for the set.
 * T3 cards use their project's workspace root (falling back to its title),
 * everything else the registry cwd.
 */
export function projectsForSessions(
  sessions: ReadonlyArray<{ sessionId: string; sdk?: boolean }>,
): Map<string, SessionProject> {
  const out = new Map<string, SessionProject>();
  if (sessions.length === 0) return out;
  const cwds = new Map(getActiveSessions().map((s) => [s.sessionId, s.cwd]));
  const t3 = t3ThreadLabels(sessions.filter((s) => s.sdk).map((s) => s.sessionId));
  for (const { sessionId } of sessions) {
    const cwd = cwds.get(sessionId);
    let project = cwd ? projectNameForDir(cwd) : null;
    const label = t3.get(sessionId);
    if (label) {
      project = (label.root ? projectNameForDir(label.root) : null) || label.project || project;
    }
    if (project) {
      if (lastKnownProject.size >= MEMO_CAP) lastKnownProject.clear();
      lastKnownProject.set(sessionId, project);
    } else {
      project = lastKnownProject.get(sessionId) ?? null;
    }
    out.set(sessionId, { project, threadTitle: label?.title ?? null });
  }
  return out;
}

function stateSdkFlag(sessionId: string): boolean {
  try {
    const p = join(STATE_DIR, `${sessionId}.json`);
    if (!existsSync(p)) return false;
    return (JSON.parse(readFileSync(p, "utf-8")) as { sdk?: unknown }).sdk === true;
  } catch {
    return false;
  }
}

function withSdkFlags(sessionIds: readonly string[]): { sessionId: string; sdk: boolean }[] {
  return sessionIds.map((sessionId) => ({ sessionId, sdk: stateSdkFlag(sessionId) }));
}

export function projectForSession(sessionId: string): string | null {
  return projectsForSessions(withSdkFlags([sessionId])).get(sessionId)?.project ?? null;
}

/** Session ids with a room card (state file). */
export function roomSessionIds(): string[] {
  try {
    if (!existsSync(STATE_DIR)) return [];
    return readdirSync(STATE_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.slice(0, -5));
  } catch {
    return [];
  }
}

// ── Characters ──────────────────────────────────────────────────────────

export interface CharacterEntry {
  name?: string;
  hidden?: boolean;
}

let charCache: { mtime: number; map: Record<string, CharacterEntry> } | null = null;

/** characters.json keyed by voiceId; re-read when the file changes. */
export function loadCharacterEntries(): Record<string, CharacterEntry> {
  try {
    const mtime = statSync(CHARACTERS_PATH).mtimeMs;
    if (charCache && charCache.mtime === mtime) return charCache.map;
    const raw = JSON.parse(readFileSync(CHARACTERS_PATH, "utf-8")) as unknown;
    const map =
      raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as Record<string, CharacterEntry>)
        : {};
    charCache = { mtime, map };
    return map;
  } catch {
    return {};
  }
}

/** True when characters.json has an entry for this voiceId (own key only). */
export function isCharacterVoice(voiceId: string): boolean {
  return !!voiceId && Object.hasOwn(loadCharacterEntries(), voiceId);
}

// ── Voice resolution ────────────────────────────────────────────────────

export type VoiceSource = "session" | "project" | "default";

export interface EffectiveVoice {
  voiceId: string;
  source: VoiceSource;
}

/**
 * Effective voice per session. Pass `projects` when the caller already
 * derived them (the snapshot build); otherwise they're derived here in one
 * batch, and only when a project voice could apply.
 */
export function resolveEffectiveVoices(
  sessionIds: readonly string[],
  projects?: Map<string, SessionProject>,
): Map<string, EffectiveVoice> {
  const out = new Map<string, EffectiveVoice>();
  const sessionVoices = loadSessionVoices();
  const projectVoices = loadProjectVoices();
  const fallback = loadConfig().elevenlabs_voice_id;

  const needProject = sessionIds.filter((id) => !sessionVoices[id]);
  let derived = projects;
  if (!derived && needProject.length > 0 && Object.keys(projectVoices).length > 0) {
    derived = projectsForSessions(withSdkFlags(needProject));
  }
  for (const id of sessionIds) {
    const explicit = sessionVoices[id];
    if (explicit) {
      out.set(id, { voiceId: explicit, source: "session" });
      continue;
    }
    const project = derived?.get(id)?.project;
    const projectVoice = project ? projectVoices[project] : undefined;
    if (projectVoice && isCharacterVoice(projectVoice)) {
      out.set(id, { voiceId: projectVoice, source: "project" });
      continue;
    }
    if (fallback) out.set(id, { voiceId: fallback, source: "default" });
  }
  return out;
}

/** The voice one session speaks in; config default when nothing applies. */
export function resolveSessionVoice(sessionId?: string): string {
  if (!sessionId) return loadConfig().elevenlabs_voice_id;
  return (
    resolveEffectiveVoices([sessionId]).get(sessionId)?.voiceId ?? loadConfig().elevenlabs_voice_id
  );
}

/**
 * sessionId → effective voiceId for the given sessions (default: every
 * session with an explicit voice or a room card). Read-side replacement for
 * loadSessionVoices() wherever "the voice this session speaks in" is meant.
 */
export function effectiveSessionVoices(sessionIds?: readonly string[]): Record<string, string> {
  const ids = sessionIds ?? voiceHolderIds();
  const out: Record<string, string> = {};
  for (const [id, v] of resolveEffectiveVoices(ids)) out[id] = v.voiceId;
  return out;
}

/** Explicitly voiced sessions plus every room card. */
export function voiceHolderIds(): string[] {
  return [...new Set([...Object.keys(loadSessionVoices()), ...roomSessionIds()])];
}
