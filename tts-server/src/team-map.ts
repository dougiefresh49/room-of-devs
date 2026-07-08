import { existsSync, readFileSync, renameSync, writeFileSync } from "fs";
import { join } from "path";
import { TTS_DIR } from "./config.js";

export const TEAM_MAP_PATH = join(TTS_DIR, "team_map.json");

export interface TeamEntry {
  tmux?: string;
  sessionId?: string;
  createdAt?: string;
}

export function loadTeamMap(): Record<string, TeamEntry> {
  try {
    if (!existsSync(TEAM_MAP_PATH)) return {};
    return JSON.parse(readFileSync(TEAM_MAP_PATH, "utf-8"));
  } catch {
    return {};
  }
}

export function writeTeamMap(data: Record<string, TeamEntry>): void {
  const tmp = `${TEAM_MAP_PATH}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  renameSync(tmp, TEAM_MAP_PATH);
}

export function teamSessionIds(): Set<string> {
  const ids = new Set<string>();
  for (const entry of Object.values(loadTeamMap())) {
    if (entry?.sessionId) ids.add(entry.sessionId);
  }
  return ids;
}

export function isTeamSession(sessionId: string): boolean {
  return teamSessionIds().has(sessionId);
}

export function tmuxForSession(sessionId: string): string | null {
  for (const entry of Object.values(loadTeamMap())) {
    if (entry?.sessionId === sessionId && entry.tmux) return entry.tmux;
  }
  return null;
}

export function removeSessionFromTeamMap(sessionId: string): boolean {
  const team = loadTeamMap();
  let removed = false;
  for (const [persona, entry] of Object.entries(team)) {
    if (entry?.sessionId === sessionId) {
      delete team[persona];
      removed = true;
      break;
    }
  }
  if (removed) writeTeamMap(team);
  return removed;
}
