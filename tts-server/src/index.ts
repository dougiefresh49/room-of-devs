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
} from "./config.js";
import { processWithGemini, fallbackClean } from "./gemini.js";
import { streamTTS, resolveVoiceId } from "./elevenlabs.js";
import { getCharacter } from "./dynamic-response.js";
import {
  claimProcessing,
  clearProcessing,
  waitForLock,
  releaseLock,
  stopCurrent,
  playStreamBuffer,
  type ReplayMeta,
  type PlaybackContext,
} from "./audio.js";
import { seedStateOnStartup } from "./state.js";
import { maybeFireDeferredAnnounce } from "./announce.js";
import { startHid, stopHid } from "./hid.js";
import { startPanelWs, stopPanelWs } from "./panel-ws.js";
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

    const stream = await streamTTS(processed, { voiceId });
    if (!stream) {
      log("server", `Stream failed for ${name}`);
      moveToFailed(filePath);
      return;
    }

    const replayMeta: ReplayMeta = {
      source: "queue",
      sessionId: sessionId,
      sessionName: item.thread_title || lookupSessionName(sessionId || "") || undefined,
      character: character?.name,
      textPreview: processed.slice(0, 120),
      timestamp: new Date().toISOString(),
    };

    // CC items are session-bound (drive hand-raise / speaking state); Cursor
    // and manual enqueues have no session and stay room-level "meta".
    const ctx: PlaybackContext = sessionId ? { sessionId } : "meta";

    log("server", `Playing: ${name} (${processed.length} chars)`);
    const code = await playStreamBuffer(stream as any, filePath, ctx, replayMeta);
    // TTS succeeded and credits are spent — move to played regardless of
    // exit code. A stopped playback shouldn't leave the item re-buyable;
    // the audio is already saved in replay/.
    if (code !== 0) {
      log("server", `Playback exited ${code} for ${name} (stopped?)`);
    }
    moveToPlayed(filePath);
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

process.on("SIGTERM", () => {
  log("server", "SIGTERM — shutting down");
  watcher.close();
  stopHid();
  stopPanelWs();
  stopCurrent();
  process.exit(0);
});

process.on("SIGINT", () => {
  log("server", "SIGINT — shutting down");
  watcher.close();
  stopHid();
  stopPanelWs();
  stopCurrent();
  process.exit(0);
});
