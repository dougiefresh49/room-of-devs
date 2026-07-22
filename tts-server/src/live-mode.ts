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
}

type LiveMap = Record<string, LiveEntry>;

function atomicWrite(path: string, data: unknown): void {
  const tmp = `${path}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  renameSync(tmp, path);
}

export function loadLiveSessions(): LiveMap {
  try {
    if (!existsSync(LIVE_SESSIONS_PATH)) return {};
    const raw = JSON.parse(readFileSync(LIVE_SESSIONS_PATH, "utf-8"));
    return raw && typeof raw === "object" ? (raw as LiveMap) : {};
  } catch {
    return {};
  }
}

export function isLiveSession(sessionId: string | undefined): boolean {
  if (!sessionId) return false;
  return loadLiveSessions()[sessionId]?.on === true;
}

export function setLiveSession(sessionId: string, on: boolean): void {
  const map = loadLiveSessions();
  if (on) {
    map[sessionId] = {
      on: true,
      since: new Date().toISOString(),
      toolCount: 0,
      turnStartedAt: null,
      lastActivity: null,
    };
  } else {
    delete map[sessionId];
  }
  atomicWrite(LIVE_SESSIONS_PATH, map);
  log("live", `live mode ${on ? "ON" : "off"} for ${sessionId.slice(0, 12)}`);
}

/** Tailer heartbeat: bump tool count / turn start without toggling. */
export function updateLiveEntry(
  sessionId: string,
  patch: Partial<Pick<LiveEntry, "toolCount" | "turnStartedAt" | "lastActivity">>
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

/** Reply-from-phone marker (30s TTL). */
export function markPendingPhoneAck(sessionId: string): void {
  try {
    atomicWrite(PENDING_PHONE_ACK_PATH, { sessionId, at: new Date().toISOString() });
  } catch {
    /* best-effort */
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
    };
    if (raw?.sessionId !== sessionId) return false;
    const age = Date.now() - Date.parse(raw.at ?? "");
    // Consume regardless of freshness — a stale marker must not linger and
    // claim some future unrelated prompt.
    atomicWrite(PENDING_PHONE_ACK_PATH, {});
    return Number.isFinite(age) && age >= 0 && age < PHONE_ACK_FRESH_MS;
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
