import { watch } from "chokidar";
import { readFileSync, renameSync, existsSync, mkdirSync } from "fs";
import { basename, join } from "path";
import {
  QUEUE_DIR,
  PLAYED_DIR,
  FAILED_DIR,
  loadConfig,
  effectivePlaybackMode,
  loadEnv,
  loadMutedSessions,
  lookupSessionName,
  getActiveSessions,
  SESSIONS_DIR,
} from "./config.js";
import { processWithGemini, fallbackClean } from "./gemini.js";
import { streamTTS, streamTTSWithTimestamps, resolveVoiceId } from "./elevenlabs.js";
import { getCharacter } from "./dynamic-response.js";
import {
  claimProcessing,
  clearProcessing,
  waitForLock,
  releaseLock,
  acquireLock,
  stopCurrent,
  playStreamBuffer,
  awaitPendingDrain,
  activePhoneGrantId,
  type ReplayMeta,
  type PlaybackContext,
} from "./audio.js";
import { getPhrasesForVoice, playRandomPhrase } from "./phrases.js";
import {
  seedStateOnStartup,
  cleanupSession,
  listStateSessionIds,
  sessionStateAgeMs,
} from "./state.js";
import { reconcileSessionLineage } from "./session-lineage.js";
import { maybeFireDeferredAnnounce } from "./announce.js";
import { startHid, stopHid } from "./hid.js";
import { startPanelWs, stopPanelWs } from "./panel-ws.js";
import { startMobileHttp, stopMobileHttp } from "./mobile-http.js";
import { startDnd, stopDnd } from "./dnd.js";
import { registryPidBySessionId, isPidAlive } from "./session-catalog.js";
import { log } from "./logger.js";

loadEnv();

interface QueueItem {
  text: string;
  conversation_id?: string;
  source?: string;
  thread_title?: string;
  timestamp?: string;
}

function parseQueueFile(path: string): QueueItem | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    log("server", `Failed to parse: ${path}`);
    return null;
  }
}

// Cap raw input to Gemini — spoken output is capped at ~4,800 chars anyway,
// so anything beyond a few multiples of that is wasted input billing.
const GEMINI_INPUT_CAP = 16_000;

// eleven_v3 per-request limit is 5,000 chars (verified against
// elevenlabs.io/docs/overview/models on 2026-07-06); 4,800 leaves margin.
const TTS_CHAR_CAP = 4800;
// When Gemini failed, the fallback cleaner output is rougher — cap it much
// lower so a hiccup doesn't bill 4,800 chars of near-raw markdown (C3).
const FALLBACK_CHAR_CAP = 1200;

function truncateForTTS(text: string, limit = TTS_CHAR_CAP): string {
  if (text.length <= limit) return text;
  const sentences = text.split(/(?<=[.!?])\s+/);
  let result = "";
  for (const s of sentences) {
    if (result.length + s.length + 1 > limit) break;
    result = result ? result + " " + s : s;
  }
  return result || text.slice(0, limit);
}

function shouldAddPrefix(
  config: ReturnType<typeof loadConfig>,
  title?: string
): boolean {
  const pref = config.streaming_session_prefix;
  if (pref === "never") return false;
  if (pref === "always" && title) return true;
  if (pref === "auto" && title && title !== "Claude Code") {
    return getActiveSessions().length > 1;
  }
  return false;
}

async function maybePlayVictoryLine(voiceId: string): Promise<void> {
  if (Math.random() >= 0.25) return;
  if (getPhrasesForVoice(voiceId, "done").length === 0) return;
  if (!acquireLock()) return;
  try {
    await playRandomPhrase(voiceId, "done", "meta");
  } catch (err: any) {
    log("server", `Victory line skipped: ${err?.message ?? err}`);
  } finally {
    releaseLock();
  }
}

async function processQueueFile(
  filePath: string,
  auto = false
): Promise<void> {
  const name = basename(filePath);

  // Playback mode gates the watcher's auto-play only — manual plays
  // ("once" mode via Play Latest / menu clicks) always go through. The item
  // stays in queue/ so it can be played manually later.
  if (auto) {
    const mode = effectivePlaybackMode();
    if (mode !== "auto") {
      log("server", `queued without auto-play (mode=${mode}): ${name}`);
      return;
    }
  }

  if (!claimProcessing(name)) {
    log("server", `Already claimed by another process: ${name} — skip`);
    return;
  }

  try {
    const item = parseQueueFile(filePath);
    if (!item?.text) {
      log("server", `Empty or invalid: ${name}`);
      moveToFailed(filePath);
      return;
    }

    const config = loadConfig();
    const sessionId = item.conversation_id;

    if (sessionId) {
      const muted = loadMutedSessions();
      if (muted.includes(sessionId)) {
        log("server", `Session ${sessionId} muted — skip auto-play`);
        return;
      }
    }

    await waitForLock();

    // The file may have been processed and moved while we waited on the lock.
    if (!existsSync(filePath)) {
      log("server", `Queue file gone after lock wait: ${name} — skip`);
      return;
    }

    // Admission re-check for grants, post-lock but pre-Gemini: a phone grant
    // releases the stream lock right after saving (its playback window is the
    // phone's, not the Mac's), so a grant that queued up behind it must not
    // sail into synthesis while that window is still open.
    if (process.env.CR_GRANTED === "1") {
      const activeGrant = activePhoneGrantId();
      if (activeGrant && activeGrant !== name) {
        log("server", `Phone grant ${activeGrant} window open — leaving ${name} queued`);
        return;
      }
    }

    const voiceId = resolveVoiceId(sessionId);
    if (!voiceId) {
      log("server", "No voice ID configured — skip");
      moveToFailed(filePath);
      return;
    }

    const character = getCharacter(voiceId);
    const characterCtx = character
      ? { name: character.name, personality: character.personality, speechStyle: character.speechStyle }
      : null;

    const rawText = item.text.slice(0, GEMINI_INPUT_CAP);

    const geminiResult = await processWithGemini(
      rawText,
      config.gemini_model,
      characterCtx
    );
    let processed = geminiResult ?? fallbackClean(rawText);

    if (!processed.trim()) {
      log("server", `No speakable text after processing: ${name}`);
      moveToPlayed(filePath);
      return;
    }

    if (shouldAddPrefix(config, item.thread_title)) {
      const prefix = (item.thread_title ?? "").slice(0, 30);
      processed = `In ${prefix}... ${processed}`;
    }

    processed = truncateForTTS(
      processed,
      geminiResult ? TTS_CHAR_CAP : FALLBACK_CHAR_CAP
    );

    log("server", `Character: ${character?.name ?? "default"}, voice: ${voiceId}`);

    const replayMeta: ReplayMeta = {
      source: "queue",
      sessionId: sessionId,
      sessionName: item.thread_title || lookupSessionName(sessionId || "") || undefined,
      character: character?.name,
      textPreview: processed.slice(0, 120),
      spokenText: processed,
      rawText: item.text.slice(0, 4000),
      timestamp: new Date().toISOString(),
    };

    // CC items are session-bound (drive hand-raise / speaking state); Cursor
    // and manual enqueues have no session and stay room-level "meta".
    const ctx: PlaybackContext = sessionId ? { sessionId } : "meta";

    // Grant-to-phone: same synthesis stream, sink "none" (buffer → replay only).
    // CR_OUTPUT is set by dispatchPanelAction → grant_floor.sh → play_node.sh.
    const sink = process.env.CR_OUTPUT === "phone" ? ("none" as const) : ("ffplay" as const);

    // Phone sink retires the queue item as soon as the replay is durably
    // saved — a crash during the playback-window wait must not leave the
    // already-billed item re-buyable in queue/.
    const onPersisted = sink === "none" ? () => moveToPlayed(filePath) : undefined;

    // Granted readout: prefer the with-timestamps stream (same cost, free
    // word-level alignment for karaoke captions); fall back to plain streaming
    // if the endpoint/SDK call fails.
    let code: number;
    const timestamped = await streamTTSWithTimestamps(processed, { voiceId });
    if (timestamped) {
      log("server", `Playing+captions: ${name} (${processed.length} chars)`);
      code = await playStreamBuffer(
        timestamped.audio,
        filePath,
        ctx,
        replayMeta,
        timestamped.getWords,
        sink,
        onPersisted
      );
    } else {
      const stream = await streamTTS(processed, { voiceId });
      if (!stream) {
        log("server", `Stream failed for ${name}`);
        moveToFailed(filePath);
        return;
      }
      log("server", `Playing: ${name} (${processed.length} chars, no captions)`);
      code = await playStreamBuffer(stream as any, filePath, ctx, replayMeta, undefined, sink, onPersisted);
    }
    // TTS succeeded and credits are spent — move to played regardless of
    // exit code. A stopped playback shouldn't leave the item re-buyable;
    // the audio is already saved in replay/.
    if (code !== 0) {
      log("server", `Playback exited ${code} for ${name} (stopped?)`);
    } else if (
      process.env.CR_GRANTED === "1" &&
      process.env.CR_OUTPUT !== "phone" &&
      sessionId &&
      loadConfig().victory_lines
    ) {
      await maybePlayVictoryLine(voiceId);
    }
    // Phone sink already moved it via onPersisted.
    if (existsSync(filePath)) moveToPlayed(filePath);
  } catch (err: any) {
    log("server", `Error processing ${name}: ${err.message}`);
    if (existsSync(filePath)) moveToFailed(filePath);
  } finally {
    clearProcessing(name);
    releaseLock();
  }
}

function moveToPlayed(filePath: string): void {
  try {
    mkdirSync(PLAYED_DIR, { recursive: true });
    renameSync(filePath, join(PLAYED_DIR, basename(filePath)));
    log("server", `Moved to played: ${basename(filePath)}`);
  } catch (err: any) {
    log("server", `Move failed: ${err.message}`);
  }
}

// Genuine failures (bad JSON, no voice, stream/TTS failure) go to failed/
// instead of lingering in queue/ forever, inflating the menu queue count.
function moveToFailed(filePath: string): void {
  try {
    mkdirSync(FAILED_DIR, { recursive: true });
    renameSync(filePath, join(FAILED_DIR, basename(filePath)));
    log("server", `Moved to failed: ${basename(filePath)}`);
  } catch (err: any) {
    log("server", `Move to failed failed: ${err.message}`);
  }
}

const queue: string[] = [];
let processing = false;

async function drainQueue(): Promise<void> {
  if (processing) return;
  processing = true;
  while (queue.length > 0) {
    const next = queue.shift()!;
    if (existsSync(next)) {
      await processQueueFile(next, true);
    }
  }
  processing = false;
  // Floor is settling and the drain is empty — fire any deferred announce
  // (validates hands against live state; no-op if the lock is still held).
  maybeFireDeferredAnnounce();
}

const command = process.argv[2];

if (command === "stop") {
  stopCurrent();
  log("server", "Stopped playback");
  process.exit(0);
}

if (command === "once") {
  const file = process.argv[3];
  if (!file || !existsSync(file)) {
    console.error("Usage: tsx src/index.ts once <queue-file>");
    process.exit(1);
  }
  await processQueueFile(file);
  // Early-stop handoff leaves a detached stream drain running — the complete
  // replay file only exists once it finishes. Never exit before it does.
  await awaitPendingDrain();
  // Grant / manual play settled — same deferred-announce check as the daemon
  // drain, so a hand that deferred while this item played gets its nudge. During
  // a multi-item drain (grant_floor.sh), CR_SUPPRESS_DEFERRED is set on every
  // item but the last so the nudge doesn't fire between still-queued grant items.
  if (!process.env.CR_SUPPRESS_DEFERRED) {
    maybeFireDeferredAnnounce();
  }
  process.exit(0);
}

mkdirSync(QUEUE_DIR, { recursive: true });
mkdirSync(PLAYED_DIR, { recursive: true });

// Migrate sessionId-keyed state for any /clear that rotated an id while the
// daemon was down — MUST run before seedStateOnStartup, which would otherwise
// prune the rotated session's card (and strand its voice binding) as dead.
reconcileSessionLineage();

// Reconcile per-session room state against ~/.claude/sessions so the menu/LEDs
// reflect live sessions immediately, not an empty room until each fires a hook.
seedStateOnStartup();

log("server", `Starting — watching ${QUEUE_DIR}`);
console.log(`tts-server watching: ${QUEUE_DIR}`);

// Arcade encoder input (hid.ts) — inert unless arcade_enabled. Failure-isolated
// by construction: a HID fault logs and drops, it never takes down playback.
if (loadConfig().arcade_enabled) startHid();

// Agent panel WebSocket (panel-ws.ts) — inert unless panel_port > 0.
if (loadConfig().panel_port > 0) startPanelWs();

// LAN mobile room HTTP (mobile-http.ts) — inert unless mobile_port > 0.
if (loadConfig().mobile_port > 0) startMobileHttp();

// Experimental meeting auto-hold — inert unless dnd_auto.
if (loadConfig().dnd_auto) startDnd();

// Room-card reaper: Terminal.app quit can skip SessionEnd. Two consecutive
// dead-pid passes required; cards younger than 2 min are never reaped (team.sh
// bind can take ~90s). Side-effectful — NOT inside buildSnapshot().
const REAPER_MS = 60_000;
const REAPER_MIN_AGE_MS = 2 * 60_1000;
const reaperMisses = new Map<string, number>();
const reaperTimer = setInterval(() => {
  try {
    const pids = registryPidBySessionId();
    for (const sid of listStateSessionIds()) {
      const age = sessionStateAgeMs(sid);
      if (age != null && age < REAPER_MIN_AGE_MS) {
        reaperMisses.delete(sid);
        continue;
      }
      const pid = pids.get(sid);
      const alive = pid != null && isPidAlive(pid);
      if (alive) {
        reaperMisses.delete(sid);
        continue;
      }
      const misses = (reaperMisses.get(sid) ?? 0) + 1;
      reaperMisses.set(sid, misses);
      if (misses < 2) continue;
      reaperMisses.delete(sid);
      log(
        "server",
        `Reaping stale card ${sid.slice(0, 12)} (pid ${pid ?? "gone"})`
      );
      cleanupSession(sid);
    }
    for (const sid of [...reaperMisses.keys()]) {
      if (!listStateSessionIds().includes(sid)) reaperMisses.delete(sid);
    }
  } catch (err: any) {
    log("server", `reaper error: ${err?.message ?? err}`);
  }
}, REAPER_MS);
reaperTimer.unref?.();

const watcher = watch(QUEUE_DIR, {
  ignoreInitial: true,
  awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
});

watcher.on("add", (path) => {
  if (!path.endsWith(".json")) return;
  log("server", `New queue file: ${basename(path)}`);
  queue.push(path);
  drainQueue();
});

// Watch the Claude Code session registry for in-place sessionId rotations
// (/clear keeps the pid file, swaps the id). Registry files also churn on
// every busy/idle flip, so debounce; reconcile itself no-ops when nothing
// rotated.
let lineageTimer: ReturnType<typeof setTimeout> | null = null;
const sessionsWatcher = watch(SESSIONS_DIR, { ignoreInitial: true, depth: 0 });
for (const evt of ["add", "change", "unlink"] as const) {
  sessionsWatcher.on(evt, (path: string) => {
    if (!path.endsWith(".json")) return;
    if (lineageTimer) clearTimeout(lineageTimer);
    lineageTimer = setTimeout(() => {
      lineageTimer = null;
      reconcileSessionLineage();
    }, 500);
  });
}

process.on("SIGTERM", () => {
  log("server", "SIGTERM — shutting down");
  clearInterval(reaperTimer);
  watcher.close();
  sessionsWatcher.close();
  stopDnd();
  stopHid();
  stopMobileHttp();
  stopPanelWs();
  stopCurrent();
  process.exit(0);
});

process.on("SIGINT", () => {
  log("server", "SIGINT — shutting down");
  clearInterval(reaperTimer);
  watcher.close();
  sessionsWatcher.close();
  stopDnd();
  stopHid();
  stopMobileHttp();
  stopPanelWs();
  stopCurrent();
  process.exit(0);
});
