import {
  closeSync,
  existsSync,
  openSync,
  readSync,
  readdirSync,
  statSync,
  unwatchFile,
  watchFile,
  writeFileSync,
  readFileSync,
  renameSync,
} from "fs";
import { homedir } from "os";
import { basename, join } from "path";
import { createHash } from "crypto";
import { QUEUE_DIR, TTS_DIR, loadMutedSessions, lookupSessionName } from "./config.js";
import {
  LIVE_SESSIONS_PATH,
  loadLiveSessions,
  clearLiveSession,
  updateLiveEntry,
} from "./live-mode.js";
import { log } from "./logger.js";

// Tails the Claude Code transcript .jsonl of every live-mode session and
// enqueues intermediate assistant messages (source "live-cc") as they appear.
// Runs inside the daemon only. Costs nothing while no session is live.
//
// The hold-one buffer is the core correctness trick: a new assistant text is
// HELD, not enqueued. It flushes only when a later transcript entry proves the
// turn kept going (more assistant output or a tool result). If the next entry
// is a genuine user prompt — or nothing ever follows — the held text was the
// turn's FINAL message, which the Stop-hook ingest path owns; speaking it here
// would double-bill and double-speak.

const PROJECTS_DIR = join(homedir(), ".claude", "projects");
const POLL_MS = 1000;
const RECONCILE_MS = 2000;
const SILENCE_AUTO_OFF_MS = 30 * 60 * 1000;
/** Skip micro-fragments ("Ok.") — not worth a synthesis call. */
const MIN_INTERMEDIATE_CHARS = 20;

interface Tailer {
  sessionId: string;
  path: string;
  offset: number;
  remainder: string;
  heldText: string | null;
  toolCount: number;
  lastGrowthAt: number;
  lastActivityLabel: string | null;
  lastActivityAt: number;
}

const tailers = new Map<string, Tailer>();
let reconcileTimer: ReturnType<typeof setInterval> | null = null;

export function findTranscript(sessionId: string): string | null {
  try {
    for (const dir of readdirSync(PROJECTS_DIR)) {
      const p = join(PROJECTS_DIR, dir, `${sessionId}.jsonl`);
      if (existsSync(p)) return p;
    }
  } catch {
    /* projects dir unreadable */
  }
  return null;
}

function liveHashPath(sessionId: string): string {
  // Separate namespace from ingest's .last_cc_hash_* so intermediate dedup
  // can never suppress (or be suppressed by) the final-message dedup.
  return join(TTS_DIR, `.last_live_hash_${sessionId.slice(0, 12)}`);
}

function isDuplicate(sessionId: string, text: string): boolean {
  const hash = createHash("md5").update(text).digest("hex");
  const p = liveHashPath(sessionId);
  try {
    if (existsSync(p) && readFileSync(p, "utf-8").trim() === hash) return true;
  } catch {
    /* treat as new */
  }
  try {
    writeFileSync(p, hash);
  } catch {
    /* best-effort */
  }
  return false;
}

function writeFileAtomic(path: string, data: unknown): void {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, path);
}

function enqueueIntermediate(sessionId: string, text: string): void {
  if (loadMutedSessions().includes(sessionId)) return;
  if (text.trim().length < MIN_INTERMEDIATE_CHARS) return;
  if (isDuplicate(sessionId, text)) return;
  try {
    const now = Date.now();
    const epoch = Math.floor(now / 1000);
    const ms = String(now % 1000).padStart(3, "0");
    const filename = `${epoch}-${ms}-cc-${sessionId.slice(0, 12)}.json`;
    const data = {
      text,
      conversation_id: sessionId,
      generation_id: "",
      model: "claude-code",
      timestamp: String(epoch),
      thread_title: lookupSessionName(sessionId) ?? "Claude Code",
      spoken: false,
      source: "live-cc",
    };
    writeFileAtomic(join(QUEUE_DIR, filename), data);
    log("live", `intermediate queued (${text.length} chars) for ${sessionId.slice(0, 12)}`);
  } catch (err: any) {
    log("live", `enqueueIntermediate failed: ${err.message}`);
  }
}

interface TranscriptEntry {
  type?: string;
  isSidechain?: boolean;
  toolUseResult?: unknown;
  message?: { content?: unknown };
}

function activityLabel(block: any): string {
  const input = block?.input && typeof block.input === "object" ? block.input : {};
  let detail = "";
  let isCommand = false;
  if (typeof input.file_path === "string") detail = basename(input.file_path);
  else if (typeof input.description === "string") detail = input.description;
  else if (typeof input.command === "string") {
    detail = input.command.split("=", 1)[0];
    isCommand = true;
  } else if (typeof input.prompt === "string") detail = input.prompt;
  else if (typeof input.query === "string") detail = input.query;
  detail = detail.trim().replace(/\s+/g, " ").slice(0, 40);
  const name = typeof block?.name === "string" && block.name.trim()
    ? block.name.trim()
    : "Tool";
  // Keep command redaction explicit: no text after '=' can survive into state.
  if (isCommand) detail = detail.split("=", 1)[0].trim();
  return (detail ? `${name}: ${detail}` : name).slice(0, 60);
}

function recordActivity(t: Tailer, label: string): void {
  const now = Date.now();
  if (label === t.lastActivityLabel && now - t.lastActivityAt < 2000) return;
  t.lastActivityLabel = label;
  t.lastActivityAt = now;
  updateLiveEntry(t.sessionId, {
    lastActivity: { label, at: new Date(now).toISOString() },
  });
}

function contentBlocks(entry: TranscriptEntry): any[] {
  const c = entry.message?.content;
  return Array.isArray(c) ? c : [];
}

/** A user entry that is really a tool result, not a typed prompt. */
function isToolResultEntry(entry: TranscriptEntry): boolean {
  if (entry.toolUseResult !== undefined) return true;
  return contentBlocks(entry).some((b) => b?.type === "tool_result");
}

type Emit = (sessionId: string, text: string) => void;

function processEntry(
  t: Tailer,
  entry: TranscriptEntry,
  emit: Emit = enqueueIntermediate
): void {
  if (entry.isSidechain) return; // subagent chatter

  if (entry.type === "assistant") {
    // Walk blocks IN ORDER: any later block (text or tool_use) proves the
    // previously held text was intermediate. A trailing text block stays held
    // — it may be the turn's final message, which the Stop path owns.
    let toolUses = 0;
    for (const b of contentBlocks(entry)) {
      if (b?.type === "text" && typeof b.text === "string" && b.text.trim()) {
        if (t.heldText) emit(t.sessionId, t.heldText);
        t.heldText = b.text;
      } else if (b?.type === "tool_use") {
        if (t.heldText) {
          emit(t.sessionId, t.heldText);
          t.heldText = null;
        }
        toolUses++;
        t.toolCount++;
        recordActivity(t, activityLabel(b));
      } else if (b?.type === "thinking") {
        // Tool-less turns (Q&A) spend most of their time here — surface it so
        // the call card shows liveness instead of bare "working". A thinking
        // block after a held text also proves that text was intermediate.
        if (t.heldText) {
          emit(t.sessionId, t.heldText);
          t.heldText = null;
        }
        recordActivity(t, "thinking…");
      }
    }
    if (toolUses) updateLiveEntry(t.sessionId, { toolCount: t.toolCount });
    return;
  }

  if (entry.type === "user") {
    if (isToolResultEntry(entry)) {
      // Turn continues — a held text was intermediate.
      if (t.heldText) {
        emit(t.sessionId, t.heldText);
        t.heldText = null;
      }
    } else {
      // Genuine new prompt: the previous turn's held text was FINAL (the
      // Stop-hook path owns it) — drop it, reset per-turn counters.
      t.heldText = null;
      t.toolCount = 0;
      updateLiveEntry(t.sessionId, {
        toolCount: 0,
        turnStartedAt: new Date().toISOString(),
        lastActivity: null,
      });
      t.lastActivityLabel = null;
      t.lastActivityAt = 0;
    }
  }
}

function drainTailer(t: Tailer): void {
  let size: number;
  try {
    size = statSync(t.path).size;
  } catch {
    return; // transcript vanished (session gone) — reconcile will clean up
  }
  if (size < t.offset) {
    // Truncated/rotated — restart from the end, don't re-speak history.
    t.offset = size;
    t.remainder = "";
    return;
  }
  if (size === t.offset) return;

  const fd = openSync(t.path, "r");
  try {
    const buf = Buffer.alloc(size - t.offset);
    const read = readSync(fd, buf, 0, buf.length, t.offset);
    t.offset += read;
    t.lastGrowthAt = Date.now();
    const chunk = t.remainder + buf.toString("utf-8", 0, read);
    const lines = chunk.split("\n");
    t.remainder = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        processEntry(t, JSON.parse(line) as TranscriptEntry);
      } catch {
        /* partial or non-JSON line — skip */
      }
    }
  } finally {
    closeSync(fd);
  }
}

function startTailer(sessionId: string): void {
  const path = findTranscript(sessionId);
  if (!path) {
    log("live", `no transcript found for ${sessionId.slice(0, 12)} — live off`);
    clearLiveSession(sessionId);
    return;
  }
  let offset = 0;
  try {
    offset = statSync(path).size; // start at the end: only NEW activity speaks
  } catch {
    /* keep 0 */
  }
  const t: Tailer = {
    sessionId,
    path,
    offset,
    remainder: "",
    heldText: null,
    toolCount: 0,
    lastGrowthAt: Date.now(),
    lastActivityLabel: null,
    lastActivityAt: 0,
  };
  tailers.set(sessionId, t);
  watchFile(path, { interval: POLL_MS }, () => drainTailer(t));
  log("live", `tailing ${path} from byte ${offset}`);
}

function stopTailer(sessionId: string): void {
  const t = tailers.get(sessionId);
  if (!t) return;
  unwatchFile(t.path);
  tailers.delete(sessionId);
  log("live", `stopped tailing ${sessionId.slice(0, 12)}`);
}

function sessionStateOf(sessionId: string): string | null {
  try {
    const p = join(TTS_DIR, "state", `${sessionId}.json`);
    if (!existsSync(p)) return null;
    return (JSON.parse(readFileSync(p, "utf-8")) as { state?: string }).state ?? null;
  } catch {
    return null;
  }
}

function reconcile(): void {
  const live = loadLiveSessions();
  for (const [sessionId, entry] of Object.entries(live)) {
    if (!entry?.on) continue;
    if (!tailers.has(sessionId)) startTailer(sessionId);
  }
  for (const sessionId of [...tailers.keys()]) {
    const t = tailers.get(sessionId)!;
    if (!live[sessionId]?.on) {
      stopTailer(sessionId);
      continue;
    }
    const state = sessionStateOf(sessionId);
    // Session card gone = cleanupSession ran (possibly in another process,
    // racing our heartbeat writes) — end live within one reconcile beat so a
    // resurrected map entry can't keep the tailer billing.
    if (state === null) {
      log("live", `session card gone — ending live for ${sessionId.slice(0, 12)}`);
      stopTailer(sessionId);
      clearLiveSession(sessionId);
      continue;
    }
    // Stop hook fired (hand raised): the held text is the turn's FINAL
    // message — the ingest path owns it. Drop it here too, not just on the
    // next-prompt boundary, to shrink the double-speak window.
    if (state === "hand_raised") {
      if (t.heldText) t.heldText = null;
      if (live[sessionId]?.lastActivity) {
        updateLiveEntry(sessionId, { lastActivity: null });
        t.lastActivityLabel = null;
        t.lastActivityAt = 0;
      }
    }
    // Cost safety valve: half an hour of transcript silence → auto-off.
    if (Date.now() - t.lastGrowthAt > SILENCE_AUTO_OFF_MS) {
      log("live", `30 min silence — auto-ending live for ${sessionId.slice(0, 12)}`);
      stopTailer(sessionId);
      clearLiveSession(sessionId);
    }
  }
}

export function startLiveTail(): void {
  if (reconcileTimer) return;
  reconcile();
  reconcileTimer = setInterval(reconcile, RECONCILE_MS);
  reconcileTimer.unref?.();
  // React quickly to toggle writes without waiting for the next reconcile.
  watchFile(LIVE_SESSIONS_PATH, { interval: 500 }, reconcile);
}

export function stopLiveTail(): void {
  if (reconcileTimer) {
    clearInterval(reconcileTimer);
    reconcileTimer = null;
  }
  unwatchFile(LIVE_SESSIONS_PATH);
  for (const sessionId of [...tailers.keys()]) stopTailer(sessionId);
}

// Dev entry: `tsx src/live-tail.ts once <transcript.jsonl>` — parse a full
// transcript and print would-enqueue decisions. No queue writes, no API calls.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  if (process.argv[2] === "once" && process.argv[3]) {
    const decisions: string[] = [];
    const t: Tailer = {
      sessionId: "dry-run-session",
      path: process.argv[3],
      offset: 0,
      remainder: "",
      heldText: null,
      toolCount: 0,
      lastGrowthAt: Date.now(),
      lastActivityLabel: null,
      lastActivityAt: 0,
    };
    const collect: Emit = (_sid, text) => {
      decisions.push(`SPEAK (${text.length} chars): ${text.slice(0, 90).replace(/\n/g, " ")}`);
    };
    for (const line of readFileSync(process.argv[3], "utf-8").split("\n")) {
      if (!line.trim()) continue;
      try {
        processEntry(t, JSON.parse(line), collect);
      } catch {
        /* skip */
      }
    }
    console.log(decisions.join("\n"));
    console.log(`\nheld (would NOT speak — final): ${t.heldText ? t.heldText.slice(0, 90) : "none"}`);
    console.log(`toolCount: ${t.toolCount}`);
    process.exit(0);
  }
}
