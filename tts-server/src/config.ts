import { readFileSync, existsSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const TTS_DIR = join(homedir(), ".cursor", "tts");
export const QUEUE_DIR = join(TTS_DIR, "queue");
export const PLAYED_DIR = join(TTS_DIR, "played");
export const LOG_FILE = join(TTS_DIR, "logs", "hook.log");
export const SESSIONS_DIR = join(homedir(), ".claude", "sessions");
export const CONFIG_PATH = join(TTS_DIR, "config.json");
export const SESSION_VOICES_PATH = join(TTS_DIR, "session_voices.json");
export const MUTED_SESSIONS_PATH = join(TTS_DIR, "muted_sessions.json");
export const PHRASES_DIR = join(TTS_DIR, "sounds", "phrases");
export const STREAM_PID_FILE = join(TTS_DIR, ".stream-playback-pid");
export const STREAM_LOCK = join(TTS_DIR, ".stream-lock");
export const PROCESSING_DIR = join(TTS_DIR, ".processing");

export interface Config {
  elevenlabs_voice_id: string;
  elevenlabs_model_id: string;
  gemini_model: string;
  default_speed: number;
  notifications_enabled: boolean;
  notification_sound: string;
  streaming_enabled: boolean;
  streaming_session_prefix: "auto" | "always" | "never";
  played_retention_count: number;
}

const DEFAULTS: Config = {
  elevenlabs_voice_id: "",
  elevenlabs_model_id: "eleven_v3",
  gemini_model: "gemini-3.1-flash-lite",
  default_speed: 1.25,
  notifications_enabled: false,
  notification_sound: "random_sfx",
  streaming_enabled: false,
  streaming_session_prefix: "auto",
  played_retention_count: 50,
};

let cachedConfig: Config | null = null;
let configMtime = 0;

export function loadConfig(): Config {
  try {
    const mtime = existsSync(CONFIG_PATH)
      ? readFileSync(CONFIG_PATH).length
      : 0;
    if (cachedConfig && mtime === configMtime) return cachedConfig;

    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    cachedConfig = { ...DEFAULTS, ...raw };
    configMtime = mtime;
    return cachedConfig!;
  } catch {
    return { ...DEFAULTS };
  }
}

export function invalidateConfigCache(): void {
  cachedConfig = null;
  configMtime = 0;
}

export function loadSessionVoices(): Record<string, string> {
  try {
    if (!existsSync(SESSION_VOICES_PATH)) return {};
    return JSON.parse(readFileSync(SESSION_VOICES_PATH, "utf-8"));
  } catch {
    return {};
  }
}

export function loadMutedSessions(): string[] {
  try {
    if (!existsSync(MUTED_SESSIONS_PATH)) return [];
    const data = JSON.parse(readFileSync(MUTED_SESSIONS_PATH, "utf-8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export interface SessionInfo {
  sessionId: string;
  name: string;
  cwd: string;
  status: string;
}

export function getActiveSessions(): SessionInfo[] {
  try {
    if (!existsSync(SESSIONS_DIR)) return [];
    const { readdirSync } = require("fs");
    const files: string[] = readdirSync(SESSIONS_DIR);
    const sessions: SessionInfo[] = [];
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const data = JSON.parse(
          readFileSync(join(SESSIONS_DIR, f), "utf-8")
        );
        if (data.sessionId) {
          sessions.push({
            sessionId: data.sessionId,
            name: data.name || data.sessionId.slice(0, 12),
            cwd: data.cwd || "",
            status: data.status || "",
          });
        }
      } catch {
        continue;
      }
    }
    return sessions;
  } catch {
    return [];
  }
}

export function lookupSessionName(sessionId: string): string | null {
  const sessions = getActiveSessions();
  const match = sessions.find((s) => s.sessionId === sessionId);
  return match?.name || null;
}

export function loadEnv(): void {
  const envPaths = [
    join(TTS_DIR, ".env"),
    join(__dirname, "..", "..", ".env"),
  ];
  for (const p of envPaths) {
    if (existsSync(p)) {
      const lines = readFileSync(p, "utf-8").split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        let value = trimmed.slice(eqIdx + 1).trim();
        value = value.replace(/^["']|["']$/g, "");
        if (key && !process.env[key]) {
          process.env[key] = value;
        }
      }
      break;
    }
  }
}
