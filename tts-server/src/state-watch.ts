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
  FAILED_DIR,
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
import type { NowPlaying } from "./protocol/index.js";
import { NOW_PLAYING_PATH } from "./now-playing.js";
import { log } from "./logger.js";
import { TEAM_MAP_PATH, teamSessionIds } from "./team-map.js";
import { TRIAGE_PATH, readTriageFocus } from "./triage.js";
import {
  LIVE_SESSIONS_PATH,
  PHONE_ACK_PATH,
  loadLiveSessions,
  readFreshPhoneAck,
  type PhoneAck,
} from "./live-mode.js";

const HOLD_ROOM_PATH = join(TTS_DIR, ".hold-room.json");
const PAUSED_FLAG_PATH = join(TTS_DIR, ".playback-paused");

// Wire shapes live in the shared protocol package (packages/protocol in the
// repo; staged into src/protocol/ by tts-server.sh). Re-exported so existing
// daemon imports keep working.
import type { AgentView, PanelSnapshot } from "./protocol/index.js";
export type { AgentView, PanelSnapshot };

/** Daemon-local monotonic snapshot revision — stamped on every build so
 *  clients can drop stale/replayed frames (bootstrap vs stream ordering). */
let snapshotRev = 0;

/** Boot epoch: rev restarts with the process, so clients gate staleness on
 *  (epoch, rev) — reset their rev baseline only when the epoch changes. */
const snapshotEpoch = Date.now();

// One memoized snapshot per revision: every subscriber (WS broadcast, each
// SSE client, /snapshot GETs, command validation via sessionInSnapshot) used
// to rebuild the whole thing independently. The cache is invalidated by any
// watched-file event; the short TTL bounds staleness from the few inputs the
// watcher doesn't cover (queue/ churn, muted list).
let cachedSnapshot: PanelSnapshot | null = null;
let cachedSnapshotAt = 0;
const SNAPSHOT_TTL_MS = 2000;

export function invalidateSnapshot(): void {
  cachedSnapshot = null;
}

/** Invalidate memoized snapshot and notify subscribers (e.g. after failed/). */
export function bumpSnapshot(): void {
  scheduleNotify();
}

/**
 * Fresh (never-memoized) snapshot for AUTHORIZATION decisions — command
 * validation must not accept a session the watcher/TTL hasn't expired yet
 * (e.g. grant to a just-killed session would re-bill a dead card's queue).
 * Presentation paths keep using the memoized buildPanelSnapshot().
 */
export function buildPanelSnapshotFresh(): PanelSnapshot {
  invalidateSnapshot();
  return buildPanelSnapshot();
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
  invalidateSnapshot();
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    notify();
  }, DEBOUNCE_MS);
}

/** Milliseconds since the session's state file was last touched by a hook;
 *  null when the file is missing/unreadable. Spawn busy-checks use this to
 *  ignore ghost cards from sessions that died without a SessionEnd hook. */
export function sessionStateAgeMs(sessionId: string): number | null {
  const state = readStateFile(sessionId);
  if (!state) return null;
  const age = Date.now() - new Date(state.updatedAt).getTime();
  return Number.isFinite(age) ? age : null;
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

// Per-build directory indexes. queue/ and played/ used to be re-scanned PER
// AGENT on every snapshot build (played/ at 442 entries x 6 agents x every
// SSE client = the hotspot the refactor audit flagged); now each dir is read
// once per build and agents look up their `-cc-<short>.json` suffix group.

/**
 * "<anything>-cc-<shortSession>.json" → shortSession (12 chars of the session
 * id, hyphens included). Exactly mirrors the old endsWith(`-cc-${short}.json`)
 * suffix match, case sensitivity included — a regex hex class would miss the
 * UUID's embedded hyphen.
 */
function ccShortSession(f: string): string | null {
  if (!f.endsWith(".json")) return null;
  const idx = f.lastIndexOf("-cc-");
  if (idx < 0) return null;
  const key = f.slice(idx + 4, -5);
  return key.length === 12 ? key : null;
}

function indexQueueDir(): Map<string, string[]> {
  // shortSession → queue basenames, sorted ascending (newest = last).
  const bySession = new Map<string, string[]>();
  try {
    if (!existsSync(QUEUE_DIR)) return bySession;
    for (const f of readdirSync(QUEUE_DIR).sort()) {
      const key = ccShortSession(f);
      if (!key) continue;
      const list = bySession.get(key) ?? [];
      list.push(f);
      bySession.set(key, list);
    }
  } catch {
    /* empty index */
  }
  return bySession;
}

function indexPlayedDir(): Map<string, number[]> {
  // shortSession → played-file mtimes (unsorted; callers compare thresholds).
  const bySession = new Map<string, number[]>();
  try {
    if (!existsSync(PLAYED_DIR)) return bySession;
    for (const f of readdirSync(PLAYED_DIR)) {
      const key = ccShortSession(f);
      if (!key) continue;
      try {
        const mtime = statSync(join(PLAYED_DIR, f)).mtimeMs;
        const list = bySession.get(key) ?? [];
        list.push(mtime);
        bySession.set(key, list);
      } catch {
        /* skip unreadable file */
      }
    }
  } catch {
    /* empty index */
  }
  return bySession;
}

/**
 * Preview of the item a grant would speak — same newest-by-basename rule as
 * grant_floor.sh (~line 165): sort by basename ascending, take the last.
 */
function queuedPreviewFrom(queued: string[] | undefined): string | null {
  if (!queued || queued.length === 0) return null;
  try {
    const newest = queued[queued.length - 1];
    const raw = JSON.parse(readFileSync(join(QUEUE_DIR, newest), "utf-8")) as {
      text?: unknown;
    };
    if (typeof raw?.text !== "string" || !raw.text) return null;
    return raw.text.slice(0, 120);
  } catch {
    return null;
  }
}

function countSupersededFrom(
  playedMtimes: number[] | undefined,
  raisedAt: string | null
): number {
  if (!raisedAt || !playedMtimes) return 0;
  const threshold = Date.parse(raisedAt);
  if (Number.isNaN(threshold)) return 0;
  let count = 0;
  for (const mtime of playedMtimes) if (mtime > threshold) count++;
  return count;
}

export function buildSnapshot(): AgentView[] {
  const muted = new Set(loadMutedSessions());
  const teamIds = teamSessionIds();
  const nicknames = loadNicknames();
  const liveMap = loadLiveSessions();
  const queueIndex = indexQueueDir();
  const playedIndex = indexPlayedDir();
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
      const inTeam = teamIds.has(sessionId);
      agents.push({
        sessionId,
        name: displayName,
        label: nicknames[sessionId] ?? displayName,
        state: shownState,
        raisedAt: state.raisedAt ?? null,
        character: character?.name ?? null,
        raisedCount: queueIndex.get(shortSession)?.length ?? 0,
        supersededCount: countSupersededFrom(
          playedIndex.get(shortSession),
          state.raisedAt ?? null
        ),
        muted: muted.has(sessionId),
        isTeam: inTeam,
        queuedPreview: queuedPreviewFrom(queueIndex.get(shortSession)),
        injectable: inTeam,
        live: liveMap[sessionId]?.on
          ? {
              on: true,
              toolCount: liveMap[sessionId].toolCount ?? 0,
              turnStartedAt: liveMap[sessionId].turnStartedAt ?? null,
              lastActivity: liveMap[sessionId].lastActivity ?? null,
            }
          : null,
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

function countFailedItems(): number {
  if (!existsSync(FAILED_DIR)) return 0;
  try {
    return readdirSync(FAILED_DIR).filter((name) => name.endsWith(".json")).length;
  } catch {
    return 0;
  }
}

export function buildPanelSnapshot(): PanelSnapshot {
  const now = Date.now();
  if (cachedSnapshot && now - cachedSnapshotAt < SNAPSHOT_TTL_MS) {
    return cachedSnapshot;
  }
  cachedSnapshot = {
    rev: ++snapshotRev,
    epoch: snapshotEpoch,
    agents: buildSnapshot(),
    nowPlaying: readNowPlaying(),
    roomHeld: isRoomHeld(),
    triageFocus: readTriageFocus(),
    paused: existsSync(PAUSED_FLAG_PATH),
    phoneAck: readFreshPhoneAck(),
    failedCount: countFailedItems(),
  };
  cachedSnapshotAt = now;
  return cachedSnapshot;
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
        LIVE_SESSIONS_PATH,
        PHONE_ACK_PATH,
      ].map((p) => basename(p))
    );
    const relevant = (path: string) =>
      path.startsWith(STATE_DIR) ||
      path.startsWith(FAILED_DIR) ||
      ROOT_FILES.has(basename(path));
    watcher = watch([STATE_DIR, TTS_DIR, FAILED_DIR], {
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
