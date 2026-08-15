import { existsSync, readFileSync, renameSync, writeFileSync } from "fs";
import { join } from "path";
import { TTS_DIR } from "./config.js";
import { log } from "./logger.js";

// Per-session "live mode" flags (owner opted into hearing intermediate
// progress messages). Flat JSON file in the muted_sessions.json mold — every
// process (daemon, hooks, panel actions) reads it fresh; atomic tmp+rename.
export const LIVE_SESSIONS_PATH = join(TTS_DIR, "live_sessions.json");

// Reply-from-phone marker: handleReplyAction stamps it so the next
// UserPromptSubmit ack for that session routes to the phone, not Mac ffplay.
export const PENDING_PHONE_ACK_PATH = join(TTS_DIR, ".pending-phone-ack.json");
// Ack event consumed by the mobile page via the snapshot (state-watch).
export const PHONE_ACK_PATH = join(TTS_DIR, ".phone-ack.json");

export const PHONE_ACK_FRESH_MS = 30_000;

export interface LiveEntry {
  on: boolean;
  since: string;
  toolCount: number;
  turnStartedAt: string | null;
  lastActivity: { label: string; at: string } | null;
  /** Live-narration mute — watch text, no auto synthesis. Absent on old files ⇒ false. */
  muted: boolean;
  /** Heartbeat for emit decisions (ISO). Absent on old files ⇒ null. */
  lastEmitAt: string | null;
}

type LiveMap = Record<string, LiveEntry>;

function atomicWrite(path: string, data: unknown): void {
  const tmp = `${path}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  renameSync(tmp, path);
}

function normalizeEntry(raw: Partial<LiveEntry> & { on?: boolean }): LiveEntry | null {
  if (!raw || raw.on !== true) return null;
  return {
    on: true,
    since: typeof raw.since === "string" ? raw.since : new Date().toISOString(),
    toolCount: typeof raw.toolCount === "number" ? raw.toolCount : 0,
    turnStartedAt: raw.turnStartedAt ?? null,
    lastActivity: raw.lastActivity ?? null,
    muted: raw.muted === true,
    lastEmitAt: typeof raw.lastEmitAt === "string" ? raw.lastEmitAt : null,
  };
}

export function loadLiveSessions(): LiveMap {
  try {
    if (!existsSync(LIVE_SESSIONS_PATH)) return {};
    const raw = JSON.parse(readFileSync(LIVE_SESSIONS_PATH, "utf-8"));
    if (!raw || typeof raw !== "object") return {};
    const out: LiveMap = {};
    for (const [id, entry] of Object.entries(raw as Record<string, unknown>)) {
      const normalized = normalizeEntry((entry ?? {}) as Partial<LiveEntry>);
      if (normalized) out[id] = normalized;
    }
    return out;
  } catch {
    return {};
  }
}

export function isLiveSession(sessionId: string | undefined): boolean {
  if (!sessionId) return false;
  return loadLiveSessions()[sessionId]?.on === true;
}

/** True when live narration is muted for this session (watch-only). */
export function isLiveMuted(sessionId: string | undefined): boolean {
  if (!sessionId) return false;
  return loadLiveSessions()[sessionId]?.muted === true;
}

export function setLiveSession(
  sessionId: string,
  on: boolean,
  opts?: { muted?: boolean },
): void {
  const map = loadLiveSessions();
  if (on) {
    map[sessionId] = {
      on: true,
      since: new Date().toISOString(),
      toolCount: 0,
      turnStartedAt: null,
      lastActivity: null,
      muted: opts?.muted === true,
      lastEmitAt: null,
    };
  } else {
    delete map[sessionId];
  }
  atomicWrite(LIVE_SESSIONS_PATH, map);
  log("live", `live mode ${on ? "ON" : "off"} for ${sessionId.slice(0, 12)}`);
}

/** Patch live-mute without clearing toolCount / lastActivity / etc. No-op if absent. */
export function setLiveMuted(sessionId: string, muted: boolean): void {
  const map = loadLiveSessions();
  const entry = map[sessionId];
  if (!entry?.on) return;
  map[sessionId] = { ...entry, muted };
  atomicWrite(LIVE_SESSIONS_PATH, map);
  log("live", `live mute ${muted ? "ON" : "off"} for ${sessionId.slice(0, 12)}`);
}

/** Tailer heartbeat: bump tool count / turn start / emit stamp without toggling. */
export function updateLiveEntry(
  sessionId: string,
  patch: Partial<Pick<LiveEntry, "toolCount" | "turnStartedAt" | "lastActivity" | "muted" | "lastEmitAt">>,
): void {
  const map = loadLiveSessions();
  const entry = map[sessionId];
  if (!entry?.on) return;
  map[sessionId] = { ...entry, ...patch };
  atomicWrite(LIVE_SESSIONS_PATH, map);
}

export function clearLiveSession(sessionId: string): void {
  const map = loadLiveSessions();
  if (!(sessionId in map)) return;
  delete map[sessionId];
  atomicWrite(LIVE_SESSIONS_PATH, map);
  log("live", `live mode cleared for ${sessionId.slice(0, 12)}`);
}

/**
 * Reply-from-phone marker. Default 30s TTL (team tmux inject, where the
 * UserPromptSubmit fires within ~1s). A T3 dispatch may cold-start a session
 * before UPS fires, so its caller passes a longer `freshMs`. Returns false if
 * the marker could not be written — the sdk reply path treats that as fatal
 * (dispatching without a marker would bill a dynamic voice response).
 */
export function markPendingPhoneAck(sessionId: string, freshMs = PHONE_ACK_FRESH_MS): boolean {
  try {
    atomicWrite(PENDING_PHONE_ACK_PATH, {
      sessionId,
      at: new Date().toISOString(),
      freshMs,
    });
    return true;
  } catch {
    return false;
  }
}

/** Failed injection: retract the marker so it can't claim a later prompt. */
export function clearPendingPhoneAck(): void {
  try {
    atomicWrite(PENDING_PHONE_ACK_PATH, {});
  } catch {
    /* best-effort */
  }
}

export function consumePendingPhoneAck(sessionId: string): boolean {
  try {
    if (!existsSync(PENDING_PHONE_ACK_PATH)) return false;
    const raw = JSON.parse(readFileSync(PENDING_PHONE_ACK_PATH, "utf-8")) as {
      sessionId?: string;
      at?: string;
      freshMs?: number;
    };
    if (raw?.sessionId !== sessionId) return false;
    const age = Date.now() - Date.parse(raw.at ?? "");
    // Consume regardless of freshness — a stale marker must not linger and
    // claim some future unrelated prompt. The marker carries its own freshness
    // window (T3 dispatches use a longer one to cover session cold-start).
    const freshMs =
      typeof raw.freshMs === "number" && raw.freshMs > 0 ? raw.freshMs : PHONE_ACK_FRESH_MS;
    atomicWrite(PENDING_PHONE_ACK_PATH, {});
    return Number.isFinite(age) && age >= 0 && age < freshMs;
  } catch {
    return false;
  }
}

// Shape owned by the shared protocol package; re-exported for daemon callers.
import type { PhoneAck } from "./protocol/index.js";
export type { PhoneAck };

export function writePhoneAck(ack: PhoneAck): void {
  try {
    atomicWrite(PHONE_ACK_PATH, ack);
  } catch {
    /* best-effort */
  }
}

/** Fresh phone-ack event for the snapshot, else null. */
export function readFreshPhoneAck(): PhoneAck | null {
  try {
    if (!existsSync(PHONE_ACK_PATH)) return null;
    const raw = JSON.parse(readFileSync(PHONE_ACK_PATH, "utf-8")) as PhoneAck;
    if (!raw?.sessionId || !raw.at) return null;
    const age = Date.now() - Date.parse(raw.at);
    if (!Number.isFinite(age) || age < 0 || age > PHONE_ACK_FRESH_MS) return null;
    return raw;
  } catch {
    return null;
  }
}
