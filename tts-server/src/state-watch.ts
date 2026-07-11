import { watch } from "chokidar";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "fs";
import { join, basename } from "path";
import {
  STATE_DIR,
  QUEUE_DIR,
  PLAYED_DIR,
  TTS_DIR,
  SESSION_VOICES_PATH,
  NICKNAMES_PATH,
  loadSessionVoices,
  loadMutedSessions,
  loadNicknames,
} from "./config.js";
import { getCharacter } from "./dynamic-response.js";
import { resolveVoiceId } from "./elevenlabs.js";
import type { SessionState } from "./state.js";
import type { NowPlaying } from "./audio.js";
import { NOW_PLAYING_PATH } from "./audio.js";
import { log } from "./logger.js";
import { TEAM_MAP_PATH, teamSessionIds } from "./team-map.js";
import { TRIAGE_PATH, readTriageFocus } from "./triage.js";

const HOLD_ROOM_PATH = join(TTS_DIR, ".hold-room.json");
const PAUSED_FLAG_PATH = join(TTS_DIR, ".playback-paused");

export interface AgentView {
  sessionId: string;
  name: string;
  label: string;
  state: SessionState;
  raisedAt: string | null;
  character: string | null;
  raisedCount: number;
  supersededCount: number;
  muted: boolean;
  isTeam: boolean;
}

export interface PanelSnapshot {
  agents: AgentView[];
  nowPlaying: NowPlaying | null;
  roomHeld: boolean;
  triageFocus: string | null;
  // pause.sh's SIGSTOP flag — panel freezes the mouth and shows resume.
  paused: boolean;
}

interface StateFile {
  sessionId: string;
  name: string;
  state: SessionState;
  raisedAt: string | null;
  updatedAt: string;
}

type NotifyCallback = () => void;

const subscribers = new Set<NotifyCallback>();
let watcher: ReturnType<typeof watch> | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

const DEBOUNCE_MS = 150;

function safe(fn: () => void): void {
  try {
    fn();
  } catch (err: any) {
    log("state-watch", `callback error: ${err?.message ?? err}`);
  }
}

function notify(): void {
  for (const cb of subscribers) safe(() => cb());
}

function scheduleNotify(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    notify();
  }, DEBOUNCE_MS);
}

function readStateFile(sessionId: string): StateFile | null {
  try {
    const p = join(STATE_DIR, `${sessionId}.json`);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf-8")) as StateFile;
  } catch {
    return null;
  }
}

function countQueued(shortSession: string): number {
  try {
    if (!existsSync(QUEUE_DIR)) return 0;
    const suffix = `-cc-${shortSession}.json`;
    return readdirSync(QUEUE_DIR).filter((f) => f.endsWith(suffix)).length;
  } catch {
    return 0;
  }
}

function countSuperseded(shortSession: string, raisedAt: string | null): number {
  if (!raisedAt) return 0;
  try {
    const threshold = Date.parse(raisedAt);
    if (Number.isNaN(threshold)) return 0;
    if (!existsSync(PLAYED_DIR)) return 0;
    const suffix = `-cc-${shortSession}.json`;
    let count = 0;
    for (const f of readdirSync(PLAYED_DIR)) {
      if (!f.endsWith(suffix)) continue;
      try {
        const mtime = statSync(join(PLAYED_DIR, f)).mtimeMs;
        if (mtime > threshold) count++;
      } catch {
        /* skip unreadable file */
      }
    }
    return count;
  } catch {
    return 0;
  }
}

export function buildSnapshot(): AgentView[] {
  const muted = new Set(loadMutedSessions());
  const teamIds = teamSessionIds();
  const nicknames = loadNicknames();
  const agents: AgentView[] = [];

  try {
    if (!existsSync(STATE_DIR)) return agents;
    for (const f of readdirSync(STATE_DIR)) {
      if (!f.endsWith(".json")) continue;
      const sessionId = f.slice(0, -5);
      const state = readStateFile(sessionId);
      if (!state) continue;

      const shortSession = sessionId.slice(0, 12);
      const voiceId = resolveVoiceId(sessionId);
      const character = voiceId ? getCharacter(voiceId) : null;

      const displayName = state.name || shortSession;
      // A killed turn (usage limit, crash) never fires the Stop hook, so
      // "working" can stick forever. Hooks refresh updatedAt on every prompt
      // and stop; a working state untouched for 90+ min is presented as idle
      // (display-only demotion — the file is left alone for late hooks).
      let shownState = state.state;
      if (shownState === "working") {
        const age = Date.now() - new Date(state.updatedAt).getTime();
        if (Number.isFinite(age) && age > 90 * 60 * 1000) shownState = "idle";
      }
      agents.push({
        sessionId,
        name: displayName,
        label: nicknames[sessionId] ?? displayName,
        state: shownState,
        raisedAt: state.raisedAt ?? null,
        character: character?.name ?? null,
        raisedCount: countQueued(shortSession),
        supersededCount: countSuperseded(shortSession, state.raisedAt ?? null),
        muted: muted.has(sessionId),
        isTeam: teamIds.has(sessionId),
      });
    }
  } catch (err: any) {
    log("state-watch", `buildSnapshot failed: ${err?.message ?? err}`);
  }

  return agents;
}

export function readNowPlaying(): NowPlaying | null {
  try {
    if (!existsSync(NOW_PLAYING_PATH)) return null;
    const raw = JSON.parse(readFileSync(NOW_PLAYING_PATH, "utf-8")) as NowPlaying;
    if (!raw?.sessionId || typeof raw.text !== "string") return null;
    return raw;
  } catch {
    return null;
  }
}

export function isRoomHeld(): boolean {
  return existsSync(HOLD_ROOM_PATH);
}

export function buildPanelSnapshot(): PanelSnapshot {
  return {
    agents: buildSnapshot(),
    nowPlaying: readNowPlaying(),
    roomHeld: isRoomHeld(),
    triageFocus: readTriageFocus(),
    paused: existsSync(PAUSED_FLAG_PATH),
  };
}

export function subscribe(cb: NotifyCallback): () => void {
  subscribers.add(cb);
  startStateWatch();
  return () => {
    subscribers.delete(cb);
  };
}

export function startStateWatch(): void {
  if (watcher) return;
  try {
    // Root-level files (.triage.json etc.) are replaced via atomic tmp+rename,
    // which orphans a per-FILE watch (new inode). Watch their parent DIRECTORY
    // shallowly instead and filter by basename — directory watches survive
    // rename-replacement.
    const ROOT_FILES = new Set(
      [
        TEAM_MAP_PATH,
        NOW_PLAYING_PATH,
        HOLD_ROOM_PATH,
        TRIAGE_PATH,
        // Voice + nickname changes must re-broadcast or the panel shows the
        // old character until an unrelated state change comes along.
        SESSION_VOICES_PATH,
        NICKNAMES_PATH,
        PAUSED_FLAG_PATH,
      ].map((p) => basename(p))
    );
    const relevant = (path: string) =>
      path.startsWith(STATE_DIR) || ROOT_FILES.has(basename(path));
    watcher = watch([STATE_DIR, TTS_DIR], {
      ignoreInitial: true,
      depth: 0,
    });
    watcher.on("add", (p) => relevant(p) && scheduleNotify());
    watcher.on("change", (p) => relevant(p) && scheduleNotify());
    watcher.on("unlink", (p) => relevant(p) && scheduleNotify());
    watcher.on("error", (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      log("state-watch", `watcher error: ${msg}`);
    });
  } catch (err: any) {
    log("state-watch", `start failed: ${err?.message ?? err}`);
  }
}

export function stopStateWatch(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (watcher) {
    watcher.close().catch(() => {});
    watcher = null;
  }
}
