import { watch } from "chokidar";
import { readFileSync, renameSync, existsSync, mkdirSync } from "fs";
import { basename, join } from "path";
import {
  QUEUE_DIR,
  PLAYED_DIR,
  TTS_DIR,
  loadConfig,
  loadEnv,
  loadMutedSessions,
  lookupSessionName,
  getActiveSessions,
} from "./config.js";
import { processWithGemini, fallbackClean } from "./gemini.js";
import { streamTTS, resolveVoiceId } from "./elevenlabs.js";
import { getCharacter } from "./dynamic-response.js";
import {
  isProcessing,
  markProcessing,
  clearProcessing,
  waitForLock,
  releaseLock,
  stopCurrent,
  playStreamBuffer,
  type ReplayMeta,
} from "./audio.js";
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

function truncateForTTS(text: string, limit = 4800): string {
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
  sessionId?: string,
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

async function processQueueFile(filePath: string): Promise<void> {
  const name = basename(filePath);
  if (isProcessing(name)) {
    log("server", `Already processing ${name} — skip`);
    return;
  }

  const item = parseQueueFile(filePath);
  if (!item?.text) {
    log("server", `Empty or invalid: ${name}`);
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

  markProcessing(name);
  try {
    await waitForLock();

    const voiceId = resolveVoiceId(sessionId);
    if (!voiceId) {
      log("server", "No voice ID configured — skip");
      return;
    }

    const character = getCharacter(voiceId);
    const characterCtx = character
      ? { name: character.name, personality: character.personality, speechStyle: character.speechStyle }
      : null;

    let processed =
      (await processWithGemini(item.text, config.gemini_model, characterCtx)) ??
      fallbackClean(item.text);

    if (!processed.trim()) {
      log("server", `No speakable text after processing: ${name}`);
      moveToPlayed(filePath);
      return;
    }

    if (shouldAddPrefix(config, sessionId, item.thread_title)) {
      const prefix = (item.thread_title ?? "").slice(0, 30);
      processed = `In ${prefix}... ${processed}`;
    }

    processed = truncateForTTS(processed);

    log("server", `Character: ${character?.name ?? "default"}, voice: ${voiceId}`);

    const stream = await streamTTS(processed, { voiceId });
    if (!stream) {
      log("server", `Stream failed for ${name}`);
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

    log("server", `Playing: ${name} (${processed.length} chars)`);
    const code = await playStreamBuffer(stream as any, filePath, replayMeta);
    if (code === 0) {
      moveToPlayed(filePath);
    } else {
      log("server", `Playback exited ${code} for ${name}`);
    }
  } catch (err: any) {
    log("server", `Error processing ${name}: ${err.message}`);
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

const queue: string[] = [];
let processing = false;

async function drainQueue(): Promise<void> {
  if (processing) return;
  processing = true;
  while (queue.length > 0) {
    const next = queue.shift()!;
    if (existsSync(next)) {
      await processQueueFile(next);
    }
  }
  processing = false;
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
  process.exit(0);
}

mkdirSync(QUEUE_DIR, { recursive: true });
mkdirSync(PLAYED_DIR, { recursive: true });

log("server", `Starting — watching ${QUEUE_DIR}`);
console.log(`tts-server watching: ${QUEUE_DIR}`);

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
  stopCurrent();
  process.exit(0);
});

process.on("SIGINT", () => {
  log("server", "SIGINT — shutting down");
  watcher.close();
  stopCurrent();
  process.exit(0);
});
