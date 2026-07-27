/**
 * Interpreter service — chokidar watcher on ~/.cursor/tts/intents/.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync } from "fs";
import { basename, join } from "path";
import { watch, type FSWatcher } from "chokidar";
import { INTENTS_DIR, INTENTS_DONE_DIR } from "../config.js";
import { log } from "../logger.js";
import { handleIntent, type IntentFile } from "./coordinator.js";

const STALE_MS = 30_000;

let watcher: FSWatcher | null = null;
const inFlight = new Set<string>();

function parseIntent(raw: unknown): IntentFile | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.transcript !== "string") return null;
  return {
    transcript: o.transcript,
    boundTarget:
      typeof o.boundTarget === "string" ? o.boundTarget : o.boundTarget === null ? null : null,
    source: typeof o.source === "string" ? o.source : "voice",
    capturedAt:
      typeof o.capturedAt === "number" && Number.isFinite(o.capturedAt) ? o.capturedAt : Date.now(),
    duckToken: typeof o.duckToken === "string" ? o.duckToken : o.duckToken === null ? null : null,
  };
}

function intentIdFromPath(filePath: string): string {
  return basename(filePath).replace(/\.json$/, "");
}

function moveToDone(filePath: string): void {
  try {
    mkdirSync(INTENTS_DONE_DIR, { recursive: true });
    const dest = join(INTENTS_DONE_DIR, basename(filePath));
    renameSync(filePath, dest);
  } catch (err: any) {
    log("interpreter", `move to done failed: ${err?.message ?? err}`);
    try {
      // Best-effort delete so we don't re-process forever.
      renameSync(filePath, `${filePath}.bad`);
    } catch {
      /* ignore */
    }
  }
}

async function processIntentFile(filePath: string): Promise<void> {
  if (!filePath.endsWith(".json")) return;
  if (inFlight.has(filePath)) return;
  inFlight.add(filePath);
  try {
    if (!existsSync(filePath)) return;

    let intent: IntentFile | null = null;
    try {
      intent = parseIntent(JSON.parse(readFileSync(filePath, "utf-8")));
    } catch (err: any) {
      log("interpreter", `bad intent JSON ${basename(filePath)}: ${err?.message ?? err}`);
      moveToDone(filePath);
      return;
    }
    if (!intent) {
      log("interpreter", `invalid intent shape ${basename(filePath)}`);
      moveToDone(filePath);
      return;
    }

    const age = Date.now() - intent.capturedAt;
    if (age > STALE_MS) {
      log("interpreter", `dropping stale intent ${basename(filePath)} (age ${age}ms)`);
      moveToDone(filePath);
      return;
    }

    const id = intentIdFromPath(filePath);
    log("interpreter", `handling intent ${id}: ${intent.transcript.slice(0, 80)}`);
    await handleIntent(intent, id);
    moveToDone(filePath);
  } catch (err: any) {
    log("interpreter", `processIntent error: ${err?.message ?? err}`);
    try {
      if (existsSync(filePath)) moveToDone(filePath);
    } catch {
      /* ignore */
    }
  } finally {
    inFlight.delete(filePath);
  }
}

function recoverStranded(): void {
  try {
    if (!existsSync(INTENTS_DIR)) return;
    const stranded = readdirSync(INTENTS_DIR)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => join(INTENTS_DIR, f));
    if (stranded.length === 0) return;
    log("interpreter", `Startup recovery: scanning ${stranded.length} leftover intent(s)`);
    for (const p of stranded) {
      try {
        const age = Date.now() - statSync(p).mtimeMs;
        if (age > STALE_MS) {
          log(
            "interpreter",
            `dropping stale intent ${basename(p)} at recovery (mtime age ${Math.round(age)}ms)`,
          );
          moveToDone(p);
          continue;
        }
      } catch {
        /* fall through to process */
      }
      void processIntentFile(p);
    }
  } catch (err: any) {
    log("interpreter", `Startup recovery scan failed: ${err?.message ?? err}`);
  }
}

export function startInterpreter(): void {
  mkdirSync(INTENTS_DIR, { recursive: true });
  mkdirSync(INTENTS_DONE_DIR, { recursive: true });

  watcher = watch(INTENTS_DIR, {
    ignoreInitial: true,
    depth: 0,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
  });

  watcher.on("add", (path) => {
    if (!path.endsWith(".json")) return;
    void processIntentFile(path);
  });

  watcher.on("ready", () => {
    recoverStranded();
  });

  log("interpreter", `watching ${INTENTS_DIR}`);
}

export function stopInterpreter(): void {
  if (watcher) {
    void watcher.close();
    watcher = null;
  }
}
