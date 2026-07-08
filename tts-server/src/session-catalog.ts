import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { basename, join } from "path";
import { homedir } from "os";

const PROJECTS_DIR = join(homedir(), ".claude", "projects");
const LIVE_SESSIONS_DIR = join(homedir(), ".claude", "sessions");
const MIN_JSONL_BYTES = 1024;
const MAX_RESUMABLE = 30;
const CWD_SCAN_LINES = 100;

export interface ResumableSession {
  sessionId: string;
  dir: string;
  project: string;
  mtimeMs: number;
  sizeBytes: number;
}

function decodeProjectDir(encoded: string): string {
  if (!encoded.startsWith("-")) return encoded;
  return encoded.replace(/^-/, "/").replace(/-/g, "/");
}

function cwdFromJsonl(jsonlPath: string): string | null {
  let content: string;
  try {
    content = readFileSync(jsonlPath, "utf-8");
  } catch {
    return null;
  }
  for (const line of content.split("\n").slice(0, CWD_SCAN_LINES)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed) as { cwd?: unknown };
      if (typeof obj.cwd === "string" && obj.cwd.trim()) return obj.cwd;
    } catch {
      /* skip malformed line */
    }
  }
  return null;
}

function liveSessionIds(): Set<string> {
  const ids = new Set<string>();
  if (!existsSync(LIVE_SESSIONS_DIR)) return ids;
  for (const name of readdirSync(LIVE_SESSIONS_DIR)) {
    if (!name.endsWith(".json")) continue;
    try {
      const data = JSON.parse(readFileSync(join(LIVE_SESSIONS_DIR, name), "utf-8")) as {
        sessionId?: unknown;
      };
      if (typeof data.sessionId === "string" && data.sessionId) ids.add(data.sessionId);
    } catch {
      /* skip */
    }
  }
  return ids;
}

function listJsonlInProject(projectFolder: string): string[] {
  const paths: string[] = [];
  for (const name of readdirSync(projectFolder)) {
    if (!name.endsWith(".jsonl")) continue;
    paths.push(join(projectFolder, name));
  }
  return paths;
}

function projectDirCwd(projectFolder: string, jsonlPaths: string[]): string {
  for (const p of jsonlPaths) {
    const cwd = cwdFromJsonl(p);
    if (cwd) return cwd;
  }
  return decodeProjectDir(basename(projectFolder));
}

function scanSessions(): ResumableSession[] {
  if (!existsSync(PROJECTS_DIR)) return [];

  const sessions: ResumableSession[] = [];

  for (const entry of readdirSync(PROJECTS_DIR)) {
    const projectFolder = join(PROJECTS_DIR, entry);
    try {
      if (!statSync(projectFolder).isDirectory()) continue;
    } catch {
      continue;
    }

    const jsonlPaths = listJsonlInProject(projectFolder);
    if (jsonlPaths.length === 0) continue;

    const folderCwd = projectDirCwd(projectFolder, jsonlPaths);

    for (const jsonlPath of jsonlPaths) {
      let sizeBytes: number;
      let mtimeMs: number;
      try {
        const s = statSync(jsonlPath);
        sizeBytes = s.size;
        mtimeMs = s.mtimeMs;
      } catch {
        continue;
      }
      if (sizeBytes < MIN_JSONL_BYTES) continue;

      const sessionId = basename(jsonlPath, ".jsonl");
      const dir = cwdFromJsonl(jsonlPath) ?? folderCwd;
      sessions.push({
        sessionId,
        dir,
        project: basename(dir),
        mtimeMs,
        sizeBytes,
      });
    }
  }

  return sessions;
}

export function listResumable(): ResumableSession[] {
  const live = liveSessionIds();
  return scanSessions()
    .filter((s) => !live.has(s.sessionId))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, MAX_RESUMABLE);
}

export function knownDirs(): string[] {
  if (!existsSync(PROJECTS_DIR)) return [];

  const seen = new Set<string>();
  const dirs: string[] = [];

  for (const entry of readdirSync(PROJECTS_DIR)) {
    const projectFolder = join(PROJECTS_DIR, entry);
    try {
      if (!statSync(projectFolder).isDirectory()) continue;
    } catch {
      continue;
    }

    const jsonlPaths = listJsonlInProject(projectFolder);
    if (jsonlPaths.length === 0) continue;

    const dir = projectDirCwd(projectFolder, jsonlPaths);
    if (seen.has(dir)) continue;
    seen.add(dir);
    dirs.push(dir);
  }

  dirs.sort((a, b) => a.localeCompare(b));
  return dirs;
}

export function isResumableSession(sessionId: string): boolean {
  return listResumable().some((s) => s.sessionId === sessionId);
}
