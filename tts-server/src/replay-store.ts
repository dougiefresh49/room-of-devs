import {
  createWriteStream,
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync,
  type WriteStream,
} from "fs";
import { TTS_DIR, STATE_DIR } from "./config.js";
import { log } from "./logger.js";
import { join } from "path";
import type { AlignmentTuples } from "./protocol/index.js";
import type { PlaybackContext } from "./now-playing.js";

export const REPLAY_DIR = join(TTS_DIR, "replay");

const MAX_REPLAY_FILES = 20;

export interface ReplayMeta {
  source: string;
  sessionId?: string;
  sessionName?: string;
  character?: string;
  textPreview?: string;
  spokenText?: string;
  // Pre-Gemini original text (the agent's actual words), for the summary bubble.
  rawText?: string;
  timestamp: string;
  // Persisted word timings so replays can karaoke too (panel reads the sidecar).
  alignment?: AlignmentTuples;
  // Post-EL atempo factor for karaoke sync (see playStreamBuffer tempoRate).
  playbackRate?: number;
  // "ack" keeps short prompt acknowledgments off the panel's stage;
  // "live" marks an intermediate live-mode clip (conversation view dims it).
  kind?: "ack" | "update" | "live";
}

function pruneReplayDir(): void {
  try {
    const files = readdirSync(REPLAY_DIR)
      .filter((f) => f.endsWith(".mp3"))
      .sort();
    while (files.length > MAX_REPLAY_FILES) {
      const oldest = files.shift()!;
      try { unlinkSync(join(REPLAY_DIR, oldest)); } catch {}
      try { unlinkSync(join(REPLAY_DIR, oldest.replace(".mp3", ".json"))); } catch {}
    }
    // Crash leftovers: a .part older than an hour will never finalize.
    for (const f of readdirSync(REPLAY_DIR)) {
      if (!f.endsWith(".part")) continue;
      const p = join(REPLAY_DIR, f);
      try {
        if (Date.now() - statSync(p).mtimeMs > 3_600_000) unlinkSync(p);
      } catch {}
    }
  } catch {}
}

/** Returns the replay filename (not full path), or null on failure. */
export function saveReplayFile(
  chunks: Uint8Array[],
  queueFile: string,
  meta?: ReplayMeta
): string | null {
  try {
    mkdirSync(REPLAY_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const label = queueFile.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
    const filename = `${ts}_${label}.mp3`;
    const filePath = join(REPLAY_DIR, filename);
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)), total);
    writeFileSync(filePath, buf);
    if (meta) {
      writeFileSync(
        join(REPLAY_DIR, filename.replace(".mp3", ".json")),
        JSON.stringify(meta, null, 2)
      );
    }
    pruneReplayDir();
    log("audio", `Saved replay: ${filename} (${(total / 1024).toFixed(1)} KB)`);
    return filename;
  } catch (err: any) {
    log("audio", `Failed to save replay: ${err.message}`);
    return null;
  }
}

// Progressive replay writer: chunks land in <name>.mp3.part as they stream in
// (the /live-audio/ endpoint tails it); finalize renames to .mp3 + writes the
// full sidecar. Pruning and /replay-list ignore .part files.
interface ReplayWriter {
  filename: string; // final .mp3 name (what gets stamped/served)
  write(chunk: Uint8Array): Promise<void>;
  finalize(meta?: ReplayMeta): Promise<string | null>;
  abort(): void;
}

export function openReplayWriter(queueFile: string, meta?: ReplayMeta): ReplayWriter | null {
  try {
    mkdirSync(REPLAY_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const label = queueFile.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
    const filename = `${ts}_${label}.mp3`;
    const filePath = join(REPLAY_DIR, filename);
    const partPath = `${filePath}.part`;
    const stream: WriteStream = createWriteStream(partPath);
    // Without a listener a stream 'error' (disk full, unlinked dir) is an
    // uncaught exception that kills the daemon. Remember it; write/finalize
    // surface it as a failed promise / null result instead.
    let streamErr: Error | null = null;
    stream.on("error", (err) => {
      streamErr = err;
    });
    // Initial sidecar: everything known pre-synthesis, so a client that reads
    // it mid-stream never sees an empty entry. Finalize overwrites with
    // alignment/rate added.
    if (meta) {
      writeFileSync(
        join(REPLAY_DIR, filename.replace(".mp3", ".json")),
        JSON.stringify(meta, null, 2)
      );
    }
    let total = 0;
    return {
      filename,
      write(chunk: Uint8Array): Promise<void> {
        if (streamErr) return Promise.reject(streamErr);
        total += chunk.length;
        return new Promise((res, rej) => {
          stream.write(Buffer.from(chunk), (err) => (err ? rej(err) : res()));
        });
      },
      finalize(finalMeta?: ReplayMeta): Promise<string | null> {
        return new Promise((res) => {
          // An errored/destroyed stream may never run the end() callback —
          // settle immediately instead of wedging the drain.
          if (streamErr) {
            log("audio", `Failed to finalize replay: ${streamErr.message}`);
            try { stream.destroy(); } catch {}
            res(null);
            return;
          }
          stream.end(() => {
            if (streamErr) {
              log("audio", `Failed to finalize replay: ${streamErr.message}`);
              res(null);
              return;
            }
            try {
              renameSync(partPath, filePath);
              if (finalMeta) {
                const tmp = join(REPLAY_DIR, `.${filename}.json.tmp`);
                writeFileSync(tmp, JSON.stringify(finalMeta, null, 2));
                renameSync(tmp, join(REPLAY_DIR, filename.replace(".mp3", ".json")));
              }
              pruneReplayDir();
              log("audio", `Saved replay: ${filename} (${(total / 1024).toFixed(1)} KB)`);
              res(filename);
            } catch (err: any) {
              log("audio", `Failed to finalize replay: ${err.message}`);
              res(null);
            }
          });
        });
      },
      abort(): void {
        try { stream.destroy(); } catch {}
        try { unlinkSync(partPath); } catch {}
        try { unlinkSync(join(REPLAY_DIR, filename.replace(".mp3", ".json"))); } catch {}
      },
    };
  } catch (err: any) {
    log("audio", `Failed to open replay writer: ${err.message}`);
    return null;
  }
}

export function loadReplayAttribution(filePath: string): {
  ctx: PlaybackContext;
  meta?: ReplayMeta;
} {
  let ctx: PlaybackContext = "meta";
  let meta: ReplayMeta | undefined;
  try {
    const sidecarPath = filePath.replace(/\.mp3$/, ".json");
    if (existsSync(sidecarPath)) {
      const parsed = JSON.parse(readFileSync(sidecarPath, "utf-8")) as ReplayMeta;
      meta = parsed;
      if (
        parsed.sessionId &&
        existsSync(join(STATE_DIR, `${parsed.sessionId}.json`))
      ) {
        ctx = { sessionId: parsed.sessionId };
      }
    }
  } catch {
    meta = undefined;
  }
  return { ctx, meta };
}
