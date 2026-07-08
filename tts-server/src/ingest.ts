import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import { QUEUE_DIR, TTS_DIR, loadEnv, lookupSessionName, loadMutedSessions } from "./config.js";
import { setSessionState } from "./state.js";
import { log } from "./logger.js";

loadEnv();

interface HookPayload {
  transcript_path?: string;
  session_id?: string;
}

function extractAssistantText(transcriptPath: string): string | null {
  try {
    const lines = readFileSync(transcriptPath, "utf-8").split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line) continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (entry.type !== "assistant") continue;
      const content = entry.message?.content ?? [];
      const texts: string[] = [];
      for (const block of content) {
        if (typeof block === "string" && block.trim()) {
          texts.push(block.trim());
        } else if (block?.type === "text" && block.text?.trim()) {
          texts.push(block.text.trim());
        }
      }
      if (texts.length > 0) return texts.join("\n\n");
    }
  } catch (err: any) {
    log("ingest", `Error reading transcript: ${err.message}`);
  }
  return null;
}

// Keyed by session so two sessions finishing with the same text ("Done.")
// don't dedup across each other.
function isDuplicate(text: string, shortSession: string): boolean {
  const dedupFile = join(TTS_DIR, `.last_cc_hash_${shortSession}`);
  const hash = createHash("md5").update(text).digest("hex").slice(0, 12);
  try {
    if (existsSync(dedupFile)) {
      const last = readFileSync(dedupFile, "utf-8").trim();
      if (last === hash) return true;
    }
  } catch {}
  writeFileSync(dedupFile, hash);
  return false;
}

let payload: HookPayload = {};
try {
  const stdin = readFileSync(0, "utf-8").trim();
  if (stdin) payload = JSON.parse(stdin);
} catch {
  log("ingest", "No valid JSON on stdin");
  process.exit(0);
}

const transcriptPath = payload.transcript_path ?? "";
const sessionId = payload.session_id ?? "unknown";

if (!transcriptPath || !existsSync(transcriptPath)) {
  log("ingest", `No transcript: ${transcriptPath}`);
  process.exit(0);
}

// The transcript may still be flushing when the Stop hook fires — retry
// briefly instead of a fixed sleep (usually returns on the first pass).
let text: string | null = extractAssistantText(transcriptPath);
for (let attempt = 0; !text && attempt < 5; attempt++) {
  await new Promise((r) => setTimeout(r, 200));
  text = extractAssistantText(transcriptPath);
}
if (!text) {
  log("ingest", "No assistant text in transcript");
  process.exit(0);
}

const shortSession = sessionId.slice(0, 12);

if (isDuplicate(text, shortSession)) {
  log("ingest", "Duplicate response — skipping");
  process.exit(0);
}

const now = Date.now();
const epoch = Math.floor(now / 1000);
// Millisecond suffix avoids same-second filename collisions (B8).
const ms = String(now % 1000).padStart(3, "0");
const filename = `${epoch}-${ms}-cc-${shortSession}.json`;
const filepath = join(QUEUE_DIR, filename);

mkdirSync(QUEUE_DIR, { recursive: true });

const sessionName = lookupSessionName(sessionId) ?? "Claude Code";

const data = {
  text,
  conversation_id: sessionId,
  generation_id: "",
  model: "claude-code",
  timestamp: String(epoch),
  thread_title: sessionName,
  spoken: false,
  source: "claude-code",
};

writeFileSync(filepath, JSON.stringify(data, null, 2));
log("ingest", `Queued: ${filename} (${text.length} chars)`);

// Raise the hand for this session (has an undelivered update). Mute check
// first — muted sessions never raise hands. setSessionState keeps the existing
// raisedAt if already raised (supersede keeps FIFO position).
if (sessionId !== "unknown" && !loadMutedSessions().includes(sessionId)) {
  setSessionState(sessionId, "hand_raised");
}

const { execSync } = await import("child_process");
const scriptsDir = join(TTS_DIR, "scripts");
const notifyScript = join(scriptsDir, "notify_queued.sh");
if (existsSync(notifyScript)) {
  try {
    execSync(`bash "${notifyScript}" "${filepath}"`, { stdio: "ignore" });
  } catch {}
}
