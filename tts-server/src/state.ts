import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { pathToFileURL } from "url";
import { spawnSync } from "child_process";
import {
  STATE_DIR,
  QUEUE_DIR,
  PLAYED_DIR,
  SESSION_VOICES_PATH,
  getActiveSessions,
  lookupSessionName,
} from "./config.js";
import { isProcessing } from "./audio.js";
import { log } from "./logger.js";
import { loadTeamMap, writeTeamMap, tmuxForSession } from "./team-map.js";

// Room state for a single Claude Code session. One JSON file per session at
// STATE_DIR/<sessionId>.json — separate-process writers (Stop-hook ingest,
// UserPromptSubmit signal, the daemon's playback wrapper) each replace the
// whole file, so the only conflict window is two writers on the SAME session,
// which the lifecycle makes near-impossible. No locks; last-writer-wins
// converges because racy pairs both derive from the queue directory.
export type SessionState = "working" | "hand_raised" | "speaking" | "idle";

interface StateFile {
  sessionId: string;
  name: string;
  state: SessionState;
  raisedAt: string | null;
  updatedAt: string;
}

function statePath(sessionId: string): string {
  return join(STATE_DIR, `${sessionId}.json`);
}

function readState(sessionId: string): StateFile | null {
  try {
    const p = statePath(sessionId);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf-8")) as StateFile;
  } catch {
    return null;
  }
}

function atomicWriteJson(path: string, data: unknown): void {
  const tmp = `${path}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  renameSync(tmp, path);
}

function tmuxSessionAlive(tmuxName: string): boolean {
  try {
    const r = spawnSync("tmux", ["has-session", "-t", `=${tmuxName}`], {
      stdio: "ignore",
    });
    return r.status === 0;
  } catch {
    return false;
  }
}

function removeSessionVoice(sessionId: string): void {
  try {
    if (!existsSync(SESSION_VOICES_PATH)) return;
    const data = JSON.parse(readFileSync(SESSION_VOICES_PATH, "utf-8")) as Record<
      string,
      unknown
    >;
    if (!data || typeof data !== "object" || !(sessionId in data)) return;
    delete data[sessionId];
    atomicWriteJson(SESSION_VOICES_PATH, data);
  } catch {
    /* ignore */
  }
}

// Does this session have any pending Claude Code queue file? Scope is CC items
// only (`*-cc-<shortSession>.json`); Cursor/manual enqueues never raise hands.
// `excludeFile` skips the item currently being played — the daemon moves it to
// played/ only AFTER the playback wrapper returns, so at recompute time it's
// still in queue/ and would otherwise re-derive a phantom hand.
function sessionHasQueuedItems(shortSession: string, excludeFile?: string): boolean {
  try {
    if (!existsSync(QUEUE_DIR)) return false;
    const suffix = `-cc-${shortSession}.json`;
    return readdirSync(QUEUE_DIR).some(
      (f) => f.endsWith(suffix) && f !== excludeFile
    );
  } catch {
    return false;
  }
}

// Derive the truthful state for a session from the world at call time:
// pending queue file → hand_raised; else Claude Code's own busy status →
// working (mid-task — calling it idle would lie to the menu/LEDs); else idle.
function deriveState(sessionId: string, excludeFile?: string): SessionState {
  const shortSession = sessionId.slice(0, 12);
  if (sessionHasQueuedItems(shortSession, excludeFile)) return "hand_raised";
  const info = getActiveSessions().find((s) => s.sessionId === sessionId);
  if (info?.status === "busy") return "working";
  return "idle";
}

// Atomic write (tmp + rename) so readers never see partial JSON.
// raisedAt: set on entering hand_raised (kept if already raised → FIFO by
// oldest wait), carried through speaking (so the post-speak recompute keeps the
// original wait time), null for working/idle.
export function setSessionState(
  sessionId: string,
  state: SessionState,
  opts?: { name?: string }
): void {
  if (!sessionId) return;
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    const existing = readState(sessionId);
    const now = new Date().toISOString();
    let raisedAt: string | null = null;
    if (state === "hand_raised") raisedAt = existing?.raisedAt ?? now;
    else if (state === "speaking") raisedAt = existing?.raisedAt ?? null;

    const name =
      opts?.name ??
      lookupSessionName(sessionId) ??
      existing?.name ??
      sessionId.slice(0, 12);

    const data: StateFile = { sessionId, name, state, raisedAt, updatedAt: now };
    const tmp = `${statePath(sessionId)}.tmp.${process.pid}`;
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, statePath(sessionId));
  } catch (err: any) {
    log("state", `setSessionState(${sessionId.slice(0, 12)}, ${state}) failed: ${err.message}`);
  }
}

// End-of-playback recompute — never write idle blind. Derive inside the write
// (not from a value captured before playback ended), then run a post-write
// verification pass: re-scan and re-derive after the rename; if a fresh Stop
// hook landed in the scan→rename window and changed the truth, write again.
// Cheaper than a cross-process lock and stays in house style.
export function recomputeAfterPlayback(sessionId: string, excludeFile?: string): void {
  if (!sessionId) return;
  const target = deriveState(sessionId, excludeFile);
  setSessionState(sessionId, target);
  const verify = deriveState(sessionId, excludeFile);
  if (verify !== target) {
    setSessionState(sessionId, verify);
    log("state", `recompute verify: ${target} → ${verify} for ${sessionId.slice(0, 12)}`);
  }
}

// Move this session's pending CC queue files to played/ (supersede-consistent:
// re-engaging a session dismisses its undelivered update; it stays replayable).
// Lives here so issue #6's clear_session_queue.sh can shell to a single owner.
export function purgeSessionQueue(sessionId: string): number {
  if (!sessionId) return 0;
  const shortSession = sessionId.slice(0, 12);
  const suffix = `-cc-${shortSession}.json`;
  let moved = 0;
  try {
    if (!existsSync(QUEUE_DIR)) return 0;
    mkdirSync(PLAYED_DIR, { recursive: true });
    for (const f of readdirSync(QUEUE_DIR)) {
      if (!f.endsWith(suffix)) continue;
      // A file the daemon has already claimed (live processing marker) may be
      // mid-Gemini/TTS — moving it out from under the claim would let a stale
      // dismissed-update path still burn credits. Mirror ingest's supersede
      // check: leave it, the daemon owns it now.
      if (isProcessing(f)) {
        log("state", `Skipping purge of ${f} — mid-synthesis`);
        continue;
      }
      try {
        renameSync(join(QUEUE_DIR, f), join(PLAYED_DIR, f));
        moved++;
      } catch {}
    }
  } catch {}
  if (moved) log("state", `Purged ${moved} queued item(s) for ${shortSession}`);
  return moved;
}

// Drop a session's room card immediately (used by panel end-session; startup
// reconciliation would otherwise leave the ghost until the next daemon boot).
export function removeSessionState(sessionId: string): void {
  try {
    unlinkSync(statePath(sessionId));
  } catch {}
}

/**
 * Central room cleanup (SessionEnd hook path, pid reaper, kill button).
 * Removes state card + session_voices entry; drops team_map only when that
 * entry's tmux session is gone. Never call for clear/resume.
 */
export function cleanupSession(sessionId: string): void {
  if (!sessionId) return;
  removeSessionState(sessionId);
  removeSessionVoice(sessionId);

  const team = loadTeamMap();
  let changed = false;
  for (const [persona, entry] of Object.entries(team)) {
    if (entry?.sessionId !== sessionId) continue;
    const tmux = entry.tmux || tmuxForSession(sessionId);
    if (tmux && tmuxSessionAlive(tmux)) continue;
    delete team[persona];
    changed = true;
  }
  if (changed) writeTeamMap(team);
  log("state", `cleanupSession ${sessionId.slice(0, 12)}`);
}

/** updatedAt age in ms for a state card, or null if unreadable. */
export function sessionStateAgeMs(sessionId: string): number | null {
  const state = readState(sessionId);
  if (!state?.updatedAt) return null;
  const t = Date.parse(state.updatedAt);
  if (Number.isNaN(t)) return null;
  return Date.now() - t;
}

export function listStateSessionIds(): string[] {
  try {
    if (!existsSync(STATE_DIR)) return [];
    return readdirSync(STATE_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.slice(0, -5));
  } catch {
    return [];
  }
}

// On daemon start, reconcile STATE_DIR against ~/.claude/sessions in both
// directions: prune state files for dead sessions, and seed a file for every
// live session that lacks one (queue file → hand_raised, busy → working, else
// idle) so the menu/LEDs aren't an empty room until each agent fires a hook.
export function seedStateOnStartup(): void {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    const live = getActiveSessions();
    const liveIds = new Set(live.map((s) => s.sessionId));

    for (const f of readdirSync(STATE_DIR)) {
      if (!f.endsWith(".json")) continue;
      const sid = f.slice(0, -5);
      if (!liveIds.has(sid)) {
        try {
          unlinkSync(join(STATE_DIR, f));
          log("state", `Pruned dead session state: ${sid.slice(0, 12)}`);
        } catch {}
      }
    }

    for (const s of live) {
      if (existsSync(statePath(s.sessionId))) continue;
      let state: SessionState = "idle";
      if (sessionHasQueuedItems(s.sessionId.slice(0, 12))) state = "hand_raised";
      else if (s.status === "busy") state = "working";
      setSessionState(s.sessionId, state, { name: s.name });
      log("state", `Seeded ${s.name} (${s.sessionId.slice(0, 12)}) → ${state}`);
    }
  } catch (err: any) {
    log("state", `seedStateOnStartup failed: ${err.message}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cmd = process.argv[2];
  const sessionId = process.argv[3] ?? "";
  if (cmd === "recompute" && sessionId) {
    recomputeAfterPlayback(sessionId);
    process.exit(0);
  }
  if (cmd === "cleanup" && sessionId) {
    cleanupSession(sessionId);
    process.exit(0);
  }
  console.error("Usage: tsx src/state.ts recompute|cleanup <sessionId>");
  process.exit(1);
}
