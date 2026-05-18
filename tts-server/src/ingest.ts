import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "fs";
import { join, basename } from "path";
import { createHash } from "crypto";
import { QUEUE_DIR, TTS_DIR, SESSIONS_DIR, loadEnv } from "./config.js";
import { log } from "./logger.js";

loadEnv();

interface HookPayload {
  transcript_path?: string;
  session_id?: string;
}

function lookupSessionName(sessionId: string): string {
  try {
    if (!existsSync(SESSIONS_DIR)) return "Claude Code";
    const files = readdirSync(SESSIONS_DIR);
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const data = JSON.parse(
          readFileSync(join(SESSIONS_DIR, f), "utf-8")
        );
        if (data.sessionId === sessionId && data.name) return data.name;
      } catch {}
    }
  } catch {}
  return "Claude Code";
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

const DEDUP_FILE = join(TTS_DIR, ".last_cc_hash");

function isDuplicate(text: string): boolean {
  const hash = createHash("md5").update(text).digest("hex").slice(0, 12);
  try {
    if (existsSync(DEDUP_FILE)) {
      const last = readFileSync(DEDUP_FILE, "utf-8").trim();
      if (last === hash) return true;
    }
  } catch {}
  writeFileSync(DEDUP_FILE, hash);
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

await new Promise((r) => setTimeout(r, 800));

const text = extractAssistantText(transcriptPath);
if (!text) {
  log("ingest", "No assistant text in transcript");
  process.exit(0);
}

if (isDuplicate(text)) {
  log("ingest", "Duplicate response — skipping");
  process.exit(0);
}

const epoch = Math.floor(Date.now() / 1000);
const shortSession = sessionId.slice(0, 12);
const filename = `${epoch}-cc-${shortSession}.json`;
const filepath = join(QUEUE_DIR, filename);

mkdirSync(QUEUE_DIR, { recursive: true });

const sessionName = lookupSessionName(sessionId);

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

const { execSync } = await import("child_process");
const scriptsDir = join(TTS_DIR, "scripts");
const notifyScript = join(scriptsDir, "notify_queued.sh");
if (existsSync(notifyScript)) {
  try {
    execSync(`bash "${notifyScript}" "${filepath}"`, { stdio: "ignore" });
  } catch {}
}
