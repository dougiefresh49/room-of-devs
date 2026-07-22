import { createServer, type Server } from "http";
import { randomBytes } from "crypto";
import { chmodSync, existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawn, spawnSync } from "child_process";
import { WebSocketServer, WebSocket } from "ws";
import { loadConfig, TTS_DIR, CONFIG_PATH, loadArcadeButtons, saveArcadeButtons, isValidArcadeColor, effectivePlaybackMode, type ArcadeButton, type ArcadeButtons } from "./config.js";
import { buildPanelSnapshot, buildSnapshot, subscribe } from "./state-watch.js";
import { log } from "./logger.js";
import { isTeamSession, tmuxForSession, removeSessionFromTeamMap, loadTeamMap } from "./team-map.js";
import { purgeSessionQueue, cleanupSession } from "./state.js";
import { runStatusSay } from "./status-say.js";
import { knownDirs, isResumableSession, listResumable } from "./session-catalog.js";
import { HID_ACTIONS, captureNextPress, isCaptureReady } from "./hid.js";
import { buildShortcutsPayload } from "./shortcuts.js";
import { isUnexpiredPhoneGrant, supersedePhoneGrant, startPlayReplay } from "./audio.js";
import { setLiveSession, markPendingPhoneAck, clearPendingPhoneAck } from "./live-mode.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHARACTERS_PATH = join(__dirname, "characters.json");

const SCRIPTS_DIR = join(TTS_DIR, "scripts");
const SERVER_DIR = join(TTS_DIR, "tts-server");
const TOKEN_PATH = join(TTS_DIR, "panel_ws_token");
const HOLD_ROOM_FILE = join(TTS_DIR, ".hold-room.json");
const VOICES_CACHE_PATH = join(TTS_DIR, "cache", "voices.json");
const LISTENING_FLAG = join(TTS_DIR, "listening.enabled");

const MOOD_PRESETS: Record<
  string,
  {
    playback_mode: string;
    default_speed: number;
    notification_sound: string;
    dynamic_responses: string;
  }
> = {
  focus: {
    playback_mode: "announce",
    default_speed: 1.5,
    notification_sound: "none",
    dynamic_responses: "cached",
  },
  arcade: {
    playback_mode: "auto",
    default_speed: 1.5,
    notification_sound: "random_sfx",
    dynamic_responses: "always",
  },
  quiet: {
    playback_mode: "silent",
    default_speed: 1.25,
    notification_sound: "none",
    dynamic_responses: "off",
  },
  normal: {
    playback_mode: "announce",
    default_speed: 1.5,
    notification_sound: "random_sfx",
    dynamic_responses: "always",
  },
};

const VALID_SPEEDS = new Set([0.75, 1.0, 1.1, 1.15, 1.2, 1.25, 1.5, 2.0]);

// Command vocabulary now lives in the shared protocol package. PanelMessage
// stays exported as the daemon-side alias; validatePanelMessage remains the
// strict (key-counting) validator — protocol's parseCommand is looser and is
// NOT swapped in here to keep Phase 0 behavior identical.
import type { Command, CommandSource, ButtonPatch, SpawnModel } from "./protocol/index.js";
export type PanelMessage = Command;
export type { ButtonPatch };

export interface CommandEnvelope {
  requestId: string | null;
  source: CommandSource | null;
  body: unknown;
}

/**
 * Additive Phase 0 envelope: accept and strip `requestId`/`source` before the
 * strict key-counting validator sees the message, so new-style clients don't
 * get bad_message. `source` is reservation-only (desktop|mobile|voice|
 * interpreter) — nothing keys off it yet. Old shapes pass through untouched.
 */
export function splitCommandEnvelope(raw: unknown): CommandEnvelope {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { requestId: null, source: null, body: raw };
  }
  const record = raw as Record<string, unknown>;
  if (record.requestId === undefined && record.source === undefined) {
    return { requestId: null, source: null, body: raw };
  }
  // Strip only SCHEMA-VALID envelope fields (non-empty string requestId,
  // known source). An invalid value is left on the body so the strict
  // key-counting validator rejects it exactly as it always did — stripping
  // it would silently accept messages the old server refused.
  const validRequestId =
    typeof record.requestId === "string" && record.requestId.length > 0;
  const validSource =
    record.source === "desktop" ||
    record.source === "mobile" ||
    record.source === "voice" ||
    record.source === "interpreter";
  if (
    (record.requestId !== undefined && !validRequestId) ||
    (record.source !== undefined && !validSource)
  ) {
    return { requestId: null, source: null, body: raw };
  }
  const { requestId, source, ...body } = record;
  return {
    requestId: validRequestId ? (requestId as string) : null,
    source: validSource ? (source as CommandSource) : null,
    body,
  };
}

let httpServer: Server | null = null;
let wss: WebSocketServer | null = null;
let unsub: (() => void) | null = null;
let token = "";

/** In-flight spawn reservations — persona lowercased. Cleared on child exit. */
const pendingPersonas = new Set<string>();

type NoticeSink = (msg: { type: "notice"; message: string }) => void;
const noticeSinks = new Set<NoticeSink>();

/** Mobile SSE (and others) can subscribe to typed notice events. */
export function onNotice(cb: NoticeSink): () => void {
  noticeSinks.add(cb);
  return () => {
    noticeSinks.delete(cb);
  };
}

export function emitNotice(message: string): void {
  const msg = { type: "notice" as const, message };
  broadcastPanel(msg);
  for (const sink of noticeSinks) {
    safe(() => sink(msg));
  }
}

function safe(fn: () => void): void {
  try {
    fn();
  } catch (err: any) {
    log("panel-ws", `handler error: ${err?.message ?? err}`);
  }
}

function scriptEnv(): NodeJS.ProcessEnv {
  return { ...process.env, TTS_DIR };
}

function runScript(
  name: string,
  args: string[],
  extraEnv?: Record<string, string>
): void {
  try {
    const child = spawn(join(SCRIPTS_DIR, name), args, {
      stdio: "ignore",
      env: { ...scriptEnv(), ...extraEnv },
    });
    child.on("error", (e) => log("panel-ws", `${name} spawn error: ${e.message}`));
  } catch (err: any) {
    log("panel-ws", `${name} spawn failed: ${err?.message ?? err}`);
  }
}

/** Fire-and-forget with exit code + stderr tail for spawn failure notices. */
function runScriptCaptured(
  name: string,
  args: string[],
  onDone: (code: number | null, stderrTail: string) => void,
  extraEnv?: Record<string, string>
): void {
  try {
    const child = spawn(join(SCRIPTS_DIR, name), args, {
      stdio: ["ignore", "ignore", "pipe"],
      env: { ...scriptEnv(), ...extraEnv },
    });
    const chunks: Buffer[] = [];
    let total = 0;
    child.stderr?.on("data", (c: Buffer) => {
      const buf = Buffer.isBuffer(c) ? c : Buffer.from(c);
      chunks.push(buf);
      total += buf.length;
      while (total > 8_000 && chunks.length > 1) {
        total -= chunks.shift()!.length;
      }
    });
    child.on("error", (e) => {
      log("panel-ws", `${name} spawn error: ${e.message}`);
      onDone(null, e.message);
    });
    child.on("close", (code) => {
      const stderrTail = Buffer.concat(chunks).toString("utf-8").trim().slice(-500);
      onDone(code, stderrTail);
    });
  } catch (err: any) {
    log("panel-ws", `${name} spawn failed: ${err?.message ?? err}`);
    onDone(null, String(err?.message ?? err));
  }
}

function runScriptSync(name: string, args: string[]): boolean {
  try {
    const result = spawnSync(join(SCRIPTS_DIR, name), args, {
      stdio: "ignore",
      env: scriptEnv(),
    });
    return result.status === 0;
  } catch (err: any) {
    log("panel-ws", `${name} sync spawn failed: ${err?.message ?? err}`);
    return false;
  }
}

/** Sync script run that surfaces the exit status (for reply mapping). */
function runScriptSyncStatus(name: string, args: string[]): number | null {
  try {
    const result = spawnSync(join(SCRIPTS_DIR, name), args, {
      stdio: "ignore",
      env: scriptEnv(),
    });
    return result.status;
  } catch (err: any) {
    log("panel-ws", `${name} sync spawn failed: ${err?.message ?? err}`);
    return null;
  }
}

function runSignalReplay(speed?: number, sessionId?: string): void {
  try {
    const args = ["exec", "tsx", "src/signal.ts", "replay", "", "1"];
    if (speed != null || sessionId) args.push(String(speed ?? 1.0));
    if (sessionId) args.push(sessionId);
    const child = spawn("pnpm", args, { cwd: SERVER_DIR, stdio: "ignore" });
    child.on("error", (e) => log("panel-ws", `signal replay spawn error: ${e.message}`));
  } catch (err: any) {
    log("panel-ws", `signal replay spawn failed: ${err?.message ?? err}`);
  }
}

export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  return origin.startsWith("tauri://") || origin.startsWith("http://localhost");
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function isOptionalString(v: unknown): v is string | undefined {
  return v === undefined || typeof v === "string";
}

function parseButtonPatch(raw: unknown): ButtonPatch | "bad_message" {
  if (!isPlainObject(raw)) return "bad_message";
  const keys = Object.keys(raw);
  const allowed = new Set(["name", "character", "action", "hold_action", "color", "notes"]);
  if (keys.length === 0 || keys.some((k) => !allowed.has(k))) return "bad_message";
  const patch = raw as Record<string, unknown>;
  if (
    !isOptionalString(patch.name) ||
    !isOptionalString(patch.character) ||
    !isOptionalString(patch.action) ||
    !isOptionalString(patch.hold_action) ||
    !isOptionalString(patch.color) ||
    !isOptionalString(patch.notes)
  ) {
    return "bad_message";
  }
  return {
    name: patch.name,
    character: patch.character,
    action: patch.action,
    hold_action: patch.hold_action,
    color: patch.color,
    notes: patch.notes,
  };
}

function listCharacterNames(): string[] {
  if (!existsSync(CHARACTERS_PATH)) return [];
  try {
    const chars = JSON.parse(readFileSync(CHARACTERS_PATH, "utf-8")) as Record<
      string,
      { name?: string }
    >;
    const names = new Set<string>();
    for (const entry of Object.values(chars)) {
      const n = entry?.name?.trim();
      if (n) names.add(n);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

export function buildButtonsMessage(): {
  type: "buttons";
  device_hint: string;
  buttons: Record<string, ArcadeButton>;
  actions: string[];
  characters: string[];
} {
  const cfg = loadArcadeButtons();
  return {
    type: "buttons",
    device_hint: cfg.device_hint,
    buttons: cfg.buttons,
    actions: [...HID_ACTIONS],
    characters: listCharacterNames(),
  };
}

function isKnownCharacter(name: string): boolean {
  const lower = name.trim().toLowerCase();
  return listCharacterNames().some((c) => c.toLowerCase() === lower);
}

function isValidAction(name: string): boolean {
  return (HID_ACTIONS as readonly string[]).includes(name);
}

function applyButtonPatch(existing: ArcadeButton | undefined, patch: ButtonPatch): ArcadeButton | "bad_message" {
  const merged: ArcadeButton = { ...(existing ?? { name: "" }) };
  if (patch.name !== undefined) {
    const n = patch.name.trim();
    if (!n) return "bad_message";
    merged.name = n;
  } else if (!merged.name?.trim()) {
    return "bad_message";
  }
  if (patch.character !== undefined) {
    const c = patch.character.trim();
    if (c && !isKnownCharacter(c)) return "bad_message";
    if (c) {
      merged.character = c;
      delete merged.action;
    } else {
      delete merged.character;
    }
  }
  if (patch.action !== undefined) {
    const a = patch.action.trim();
    if (a && !isValidAction(a)) return "bad_message";
    if (a) {
      merged.action = a;
      delete merged.character;
    } else {
      delete merged.action;
    }
  }
  if (patch.hold_action !== undefined) {
    const h = patch.hold_action.trim();
    if (h && !isValidAction(h)) return "bad_message";
    if (h) merged.hold_action = h;
    else delete merged.hold_action;
  }
  if (patch.color !== undefined) {
    const col = patch.color.trim();
    if (col && !isValidArcadeColor(col)) return "bad_message";
    if (col) merged.color = col;
    else delete merged.color;
  }
  if (patch.notes !== undefined) {
    const notes = patch.notes.trim();
    if (notes) merged.notes = notes;
    else delete merged.notes;
  }
  if (merged.character && merged.action) return "bad_message";
  return merged;
}

function writeButtons(cfg: ArcadeButtons): void {
  saveArcadeButtons(cfg);
}

function sendButtons(ws: WebSocket): void {
  replyFrame(ws, buildButtonsMessage());
}

function loadCharactersMap(): Record<string, { name?: string }> {
  if (!existsSync(CHARACTERS_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CHARACTERS_PATH, "utf-8")) as Record<
      string,
      { name?: string }
    >;
  } catch {
    return {};
  }
}

function loadVoicesCache(): { voice_id: string; name: string }[] {
  if (!existsSync(VOICES_CACHE_PATH)) return [];
  try {
    const raw = JSON.parse(readFileSync(VOICES_CACHE_PATH, "utf-8"));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function resolveDefaultVoiceName(voiceId: string): string | null {
  if (!voiceId) return null;
  const chars = loadCharactersMap();
  if (chars[voiceId]?.name) return chars[voiceId].name!;
  const match = loadVoicesCache().find((v) => v.voice_id === voiceId);
  return match?.name ?? null;
}

function isListeningEnabled(): boolean {
  if (!existsSync(LISTENING_FLAG)) return true;
  try {
    const v = readFileSync(LISTENING_FLAG, "utf-8").trim().toLowerCase();
    return v !== "0" && v !== "false" && v !== "off";
  } catch {
    return true;
  }
}

function resolveMood(): string {
  let raw: Record<string, unknown> = {};
  try {
    if (existsSync(CONFIG_PATH)) {
      raw = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    }
  } catch {
    /* invalid config */
  }
  for (const [name, preset] of Object.entries(MOOD_PRESETS)) {
    if (Object.entries(preset).every(([k, v]) => raw[k] === v)) return name;
  }
  return "custom";
}

export function buildSettingsValues(): Record<string, unknown> {
  const cfg = loadConfig();
  const voiceId = cfg.elevenlabs_voice_id;
  return {
    default_speed: cfg.default_speed,
    playback_mode: effectivePlaybackMode(),
    mood: resolveMood(),
    notifications_enabled: cfg.notifications_enabled,
    notification_sound: cfg.notification_sound,
    dynamic_responses: cfg.dynamic_responses,
    default_voice_id: voiceId,
    default_voice_name: resolveDefaultVoiceName(voiceId),
    room_held: existsSync(HOLD_ROOM_FILE),
    listening: isListeningEnabled(),
  };
}

export function buildSettingsMessage(): { type: "settings"; values: Record<string, unknown> } {
  const values = buildSettingsValues();
  // Panel-friendly aliases — the frontend normalizer reads these key names.
  // Keeping both spellings costs nothing and decouples the two vocabularies.
  values.speed = values.default_speed;
  values.notifications = values.notifications_enabled;
  values.dynamic_acks = values.dynamic_responses;
  return { type: "settings", values };
}

function sendSettings(ws: WebSocket): void {
  replyFrame(ws, buildSettingsMessage());
}

export function buildListVoicesMessage(): {
  type: "list_voices";
  voices: { voiceId: string; name: string; character: string | null }[];
} {
  const chars = loadCharactersMap();
  const voices = loadVoicesCache()
    .slice(0, 40)
    .map((v) => ({
      voiceId: v.voice_id,
      // Alias for the panel's normalizer, which reads id/voice_id.
      voice_id: v.voice_id,
      name: v.name,
      character: chars[v.voice_id]?.name ?? null,
    }));
  return { type: "list_voices", voices };
}

function parseBoolSetting(value: unknown): boolean | "bad_message" {
  if (value === true || value === "on" || value === "true" || value === 1) return true;
  if (value === false || value === "off" || value === "false" || value === 0) return false;
  return "bad_message";
}

function setDynamicResponses(value: string): boolean {
  try {
    const raw = existsSync(CONFIG_PATH)
      ? JSON.parse(readFileSync(CONFIG_PATH, "utf-8"))
      : {};
    raw.dynamic_responses = value;
    writeFileSync(CONFIG_PATH, JSON.stringify(raw, null, 2) + "\n");
    return true;
  } catch (err: any) {
    log("panel-ws", `set dynamic_responses failed: ${err?.message ?? err}`);
    return false;
  }
}

function isKnownVoiceId(voiceId: string): boolean {
  if (loadCharactersMap()[voiceId]) return true;
  return loadVoicesCache().some((v) => v.voice_id === voiceId);
}

function applySetSetting(key: string, value: unknown): boolean {
  // Panel vocabulary aliases (see buildSettingsMessage).
  if (key === "notifications") key = "notifications_enabled";
  if (key === "dynamic_acks") key = "dynamic_responses";
  if (key === "default_voice_id") key = "default_voice";
  switch (key) {
    case "speed": {
      const n = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(n) || !VALID_SPEEDS.has(n)) return false;
      return runScriptSync("set_speed.sh", [String(n)]);
    }
    case "playback_mode":
      if (value !== "auto" && value !== "announce" && value !== "silent") return false;
      return runScriptSync("set_playback_mode.sh", [String(value)]);
    case "mood":
      if (typeof value !== "string" || !(value in MOOD_PRESETS)) return false;
      return runScriptSync("set_mood.sh", [value]);
    case "notifications_enabled": {
      const b = parseBoolSetting(value);
      if (b === "bad_message") return false;
      return runScriptSync("set_notifications.sh", [b ? "on" : "off"]);
    }
    case "notification_sound":
      if (typeof value !== "string" || !value.trim()) return false;
      return runScriptSync("set_notification_sound.sh", [value.trim()]);
    case "dynamic_responses":
      if (value !== "always" && value !== "cached" && value !== "off") return false;
      return setDynamicResponses(value);
    case "default_voice":
      if (typeof value !== "string" || !value.trim() || !isKnownVoiceId(value.trim())) {
        return false;
      }
      return runScriptSync("set_voice.sh", [value.trim()]);
    case "listening": {
      const b = parseBoolSetting(value);
      if (b === "bad_message") return false;
      return runScriptSync("set_listening.sh", [b ? "on" : "off"]);
    }
    default:
      return false;
  }
}

export function validatePanelMessage(raw: unknown): PanelMessage | "bad_message" {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "bad_message";
  const msg = raw as Record<string, unknown>;
  const keys = Object.keys(msg);

  switch (msg.type) {
    case "grant":
      if (typeof msg.sessionId !== "string" || !msg.sessionId.trim()) {
        return "bad_message";
      }
      if (keys.length === 2) {
        return { type: "grant", sessionId: msg.sessionId };
      }
      if (
        keys.length === 3 &&
        (msg.output === "mac" || msg.output === "phone")
      ) {
        return { type: "grant", sessionId: msg.sessionId, output: msg.output };
      }
      return "bad_message";
    case "ptt":
      if (
        keys.length !== 3 ||
        typeof msg.sessionId !== "string" ||
        !msg.sessionId.trim() ||
        (msg.phase !== "start" && msg.phase !== "stop")
      ) {
        return "bad_message";
      }
      return { type: "ptt", phase: msg.phase, sessionId: msg.sessionId };
    case "focus_terminal":
    case "kill_team":
    case "status_say":
    case "replay_session":
      if (keys.length !== 2 || typeof msg.sessionId !== "string" || !msg.sessionId.trim()) {
        return "bad_message";
      }
      return { type: msg.type, sessionId: msg.sessionId };
    case "replay":
    case "replay_slower":
    case "restart":
    case "stop":
    case "pause":
    case "list_resumable":
    case "known_dirs":
      if (keys.length !== 1) return "bad_message";
      return { type: msg.type };
    case "play_replay": {
      if (typeof msg.file !== "string" || !msg.file) return "bad_message";
      // Bare filename only — no path separators / traversal.
      if (
        msg.file.includes("/") ||
        msg.file.includes("\\") ||
        msg.file.includes("\0") ||
        msg.file === "." ||
        msg.file === ".."
      ) {
        return "bad_message";
      }
      if (keys.length === 2) {
        return { type: "play_replay", file: msg.file };
      }
      if (
        keys.length === 3 &&
        typeof msg.offsetSec === "number" &&
        Number.isFinite(msg.offsetSec) &&
        msg.offsetSec >= 0
      ) {
        return { type: "play_replay", file: msg.file, offsetSec: msg.offsetSec };
      }
      return "bad_message";
    }
    case "spawn_session":
      if (
        keys.length < 3 ||
        keys.length > 6 ||
        typeof msg.dir !== "string" ||
        !msg.dir.trim() ||
        typeof msg.persona !== "string" ||
        !msg.persona.trim() ||
        !validSpawnFlags(msg)
      ) {
        return "bad_message";
      }
      return {
        type: "spawn_session",
        dir: msg.dir,
        persona: msg.persona,
        ...spawnFlags(msg),
      };
    case "resume_session":
      if (
        keys.length < 4 ||
        keys.length > 7 ||
        typeof msg.sessionId !== "string" ||
        !msg.sessionId.trim() ||
        typeof msg.dir !== "string" ||
        !msg.dir.trim() ||
        typeof msg.persona !== "string" ||
        !msg.persona.trim() ||
        !validSpawnFlags(msg)
      ) {
        return "bad_message";
      }
      return {
        type: "resume_session",
        sessionId: msg.sessionId,
        dir: msg.dir,
        persona: msg.persona,
        ...spawnFlags(msg),
      };
    case "set_live":
      if (
        keys.length !== 3 ||
        typeof msg.sessionId !== "string" ||
        !msg.sessionId.trim() ||
        typeof msg.on !== "boolean"
      ) {
        return "bad_message";
      }
      return { type: "set_live", sessionId: msg.sessionId, on: msg.on };
    case "set_voice":
      if (
        keys.length !== 3 ||
        typeof msg.sessionId !== "string" ||
        !msg.sessionId.trim() ||
        typeof msg.character !== "string" ||
        !msg.character.trim()
      ) {
        return "bad_message";
      }
      return { type: "set_voice", sessionId: msg.sessionId, character: msg.character };
    case "set_nickname":
      if (
        keys.length !== 3 ||
        typeof msg.sessionId !== "string" ||
        !msg.sessionId.trim() ||
        typeof msg.label !== "string"
      ) {
        return "bad_message";
      }
      return { type: "set_nickname", sessionId: msg.sessionId, label: msg.label };
    case "hold_room":
      if (keys.length !== 1) return "bad_message";
      return { type: "hold_room" };
    case "get_buttons":
    case "get_shortcuts":
    case "learn_capture":
    case "get_settings":
    case "list_voices":
      if (keys.length !== 1) return "bad_message";
      return { type: msg.type };
    case "set_setting": {
      if (keys.length !== 3 || typeof msg.key !== "string" || !msg.key.trim()) {
        return "bad_message";
      }
      return { type: "set_setting", key: msg.key.trim(), value: msg.value };
    }
    case "set_button": {
      if (keys.length !== 3) return "bad_message";
      if (typeof msg.idx !== "number" || !Number.isInteger(msg.idx) || msg.idx < 0) {
        return "bad_message";
      }
      const patch = parseButtonPatch(msg.patch);
      if (patch === "bad_message") return "bad_message";
      return { type: "set_button", idx: msg.idx, patch };
    }
    case "remove_button":
      if (keys.length !== 2) return "bad_message";
      if (typeof msg.idx !== "number" || !Number.isInteger(msg.idx) || msg.idx < 0) {
        return "bad_message";
      }
      return { type: "remove_button", idx: msg.idx };
    default:
      return "bad_message";
  }
}

function sessionInSnapshot(sessionId: string): boolean {
  return buildPanelSnapshot().agents.some((a) => a.sessionId === sessionId);
}

function sendSnapshot(ws: WebSocket): void {
  const snap = buildPanelSnapshot();
  ws.send(JSON.stringify({ type: "snapshot", ...snap }));
}

function broadcastSnapshot(): void {
  if (!wss) return;
  const snap = buildPanelSnapshot();
  const payload = JSON.stringify({ type: "snapshot", ...snap });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      safe(() => client.send(payload));
    }
  }
}

/** Broadcast an arbitrary JSON message to all connected panel clients. No-op if WS off. */
export function broadcastPanel(msg: object): void {
  if (!wss) return;
  const payload = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      safe(() => client.send(payload));
    }
  }
}

/**
 * The in-flight correlated WS request. handleMessage is fully synchronous
 * (async completions — learn_capture presses, spawn exits — report via their
 * own frames/notices), so a single module slot is safe: it is set right
 * before handleMessage and cleared right after.
 */
let activeRequest: { ws: WebSocket; id: string; responded: boolean } | null = null;

/** Correlated CommandResult (additive Phase 0). ok=true means ACCEPTED, not
 *  completed — side effects still arrive via snapshots/notices. No-op when
 *  the message carried no requestId or a result was already sent. */
function sendCommandResult(
  ws: WebSocket,
  ok: boolean,
  code?: string,
  message?: string,
  sessionId?: string
): void {
  if (!activeRequest || activeRequest.ws !== ws || activeRequest.responded) return;
  activeRequest.responded = true;
  const frame: Record<string, unknown> = {
    type: "command_result",
    requestId: activeRequest.id,
    ok,
  };
  if (code) frame.code = code;
  if (message) frame.message = message;
  if (sessionId) frame.sessionId = sessionId;
  ws.send(JSON.stringify(frame));
}

/** Send a reply frame, tagged with the active requestId when there is one. */
function replyFrame(ws: WebSocket, payload: object): void {
  const tagged =
    activeRequest && activeRequest.ws === ws
      ? { ...payload, requestId: activeRequest.id }
      : payload;
  ws.send(JSON.stringify(tagged));
}

function sendError(
  ws: WebSocket,
  code:
    | "bad_message"
    | "stale_session"
    | "not_team"
    | "bad_dir"
    | "bad_persona"
    | "bad_session"
    | "persona_busy"
    | "stale_tmux"
    | "no_device",
  sessionId?: string,
  message?: string
): void {
  const err: Record<string, string> = { type: "error", code };
  if (sessionId) err.sessionId = sessionId;
  if (message) err.message = message;
  if (activeRequest && activeRequest.ws === ws) err.requestId = activeRequest.id;
  ws.send(JSON.stringify(err));
  // New-style clients get the correlated failure too; legacy frame above is
  // unchanged for old clients.
  sendCommandResult(ws, false, code, message, sessionId);
}

function isKnownPersona(persona: string): boolean {
  return resolveVoiceIdForCharacter(persona) != null;
}

function resolveVoiceIdForCharacter(character: string): string | null {
  if (!existsSync(CHARACTERS_PATH)) return null;
  try {
    const chars = JSON.parse(readFileSync(CHARACTERS_PATH, "utf-8")) as Record<
      string,
      { name?: string }
    >;
    const lower = character.toLowerCase();
    for (const [voiceId, entry] of Object.entries(chars)) {
      if (entry?.name?.toLowerCase() === lower) return voiceId;
    }
  } catch {
    /* invalid characters.json */
  }
  return null;
}

function sanitizeNickname(label: string): string | null {
  const s = label.replace(/[\x00-\x1f\x7f]/g, "").trim();
  if (!s) return null;
  return s.slice(0, 24);
}

function isValidDir(dir: string): boolean {
  try {
    return existsSync(dir) && statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function resolvePersonaName(persona: string): string | null {
  const lower = persona.trim().toLowerCase();
  for (const name of listCharacterNames()) {
    if (name.toLowerCase() === lower) return name;
  }
  return null;
}

function tmuxExists(tmuxName: string): boolean {
  try {
    return spawnSync("tmux", ["has-session", "-t", `=${tmuxName}`], { stdio: "ignore" })
      .status === 0;
  } catch {
    return false;
  }
}

/** Persona already live in room / team_map / pending / tmux — sync reject. */
function personaBusyReason(persona: string): string | null {
  const key = persona.toLowerCase();
  if (pendingPersonas.has(key)) {
    return `${persona} is already in the room`;
  }
  for (const agent of buildSnapshot()) {
    if (agent.character?.toLowerCase() === key) {
      return `${persona} is already in the room`;
    }
  }
  const team = loadTeamMap();
  for (const [p, entry] of Object.entries(team)) {
    if (p.toLowerCase() !== key) continue;
    if (entry?.tmux && tmuxExists(entry.tmux)) {
      return `${persona} is already in the room`;
    }
  }
  if (tmuxExists(`cr-${persona}`)) {
    return `${persona} is already in the room`;
  }
  return null;
}

/** Launch-flag toggles from the picker; undefined = default on. */
export interface SpawnOpts {
  remoteControl?: boolean;
  skipPermissions?: boolean;
  model?: SpawnModel;
}

/** Aliases accepted by `claude --model`; absent/empty = CLI default. */
const SPAWN_MODELS = new Set(["fable", "opus", "sonnet", "haiku"]);

function validSpawnFlags(msg: Record<string, unknown>): boolean {
  return (
    (msg.remoteControl === undefined || typeof msg.remoteControl === "boolean") &&
    (msg.skipPermissions === undefined || typeof msg.skipPermissions === "boolean") &&
    (msg.model === undefined || (typeof msg.model === "string" && SPAWN_MODELS.has(msg.model)))
  );
}

function spawnFlags(msg: Record<string, unknown>): SpawnOpts {
  return {
    ...(typeof msg.remoteControl === "boolean" ? { remoteControl: msg.remoteControl } : {}),
    ...(typeof msg.skipPermissions === "boolean" ? { skipPermissions: msg.skipPermissions } : {}),
    // validSpawnFlags already vetted membership in SPAWN_MODELS.
    ...(typeof msg.model === "string" ? { model: msg.model as SpawnModel } : {}),
  };
}

function spawnTeam(
  persona: string,
  dir: string,
  resumeSessionId?: string,
  opts: SpawnOpts = {}
): void {
  const key = persona.toLowerCase();
  pendingPersonas.add(key);
  const args = resumeSessionId
    ? [persona, dir, "--resume", resumeSessionId]
    : [persona, dir];
  const extraEnv = {
    CR_REMOTE_CONTROL: opts.remoteControl === false ? "0" : "1",
    CR_SKIP_PERMISSIONS: opts.skipPermissions === false ? "0" : "1",
    CR_MODEL: opts.model ?? "",
  };
  runScriptCaptured("team.sh", args, (code, stderrTail) => {
    pendingPersonas.delete(key);
    if (code === 0) return;
    const detail = stderrTail.split("\n").filter(Boolean).pop() || `exit ${code ?? "?"}`;
    const msg =
      code === 2
        ? `${persona} is already in the room`
        : `Couldn't start ${persona}: ${detail}`;
    log("panel-ws", `team.sh failed for ${persona}: ${detail}`);
    emitNotice(msg);
  }, extraEnv);
}

export type SpawnValidateResult =
  | "ok"
  | "bad_dir"
  | "bad_persona"
  | "bad_session"
  | "persona_busy";

/** Shared by WS handleMessage and mobile dispatchPanelAction. */
export function validateAndSpawn(
  dir: string,
  persona: string,
  opts: SpawnOpts = {}
): SpawnValidateResult {
  if (!isValidDir(dir)) return "bad_dir";
  const canon = resolvePersonaName(persona);
  if (!canon) return "bad_persona";
  const busy = personaBusyReason(canon);
  if (busy) {
    emitNotice(busy);
    return "persona_busy";
  }
  spawnTeam(canon, dir, undefined, opts);
  return "ok";
}

/** Shared by WS handleMessage and mobile dispatchPanelAction. */
export function validateAndResume(
  sessionId: string,
  dir: string,
  persona: string,
  opts: SpawnOpts = {}
): SpawnValidateResult {
  if (!isValidDir(dir)) return "bad_dir";
  const canon = resolvePersonaName(persona);
  if (!canon) return "bad_persona";
  if (!isResumableSession(sessionId)) return "bad_session";
  const busy = personaBusyReason(canon);
  if (busy) {
    emitNotice(busy);
    return "persona_busy";
  }
  spawnTeam(canon, dir, sessionId, opts);
  return "ok";
}

export type ReplyStatus = "ok" | "not_in_team" | "failed";

/**
 * Synchronous mobile reply: inject_prompt.sh --now <sessionId> <text>.
 * Returns null on validation failure (caller should 400).
 */
export function handleReplyAction(raw: unknown): { status: ReplyStatus } | null {
  raw = splitCommandEnvelope(raw).body;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const msg = raw as Record<string, unknown>;
  if (msg.type !== "reply") return null;
  if (typeof msg.sessionId !== "string" || !msg.sessionId.trim()) return null;
  if (typeof msg.text !== "string") return null;
  const text = msg.text.trim();
  if (!text || text.length > 4000) return null;
  if (!sessionInSnapshot(msg.sessionId)) return null;

  // Marker BEFORE injecting: the UserPromptSubmit hook can fire while the
  // inject script is still returning — a late marker would miss the ack (and
  // linger to claim a wrong later prompt). Cleared below if injection fails.
  markPendingPhoneAck(msg.sessionId);
  // Flag MUST be first — inject_prompt.sh only accepts --now as $1.
  const status = runScriptSyncStatus("inject_prompt.sh", [
    "--now",
    msg.sessionId,
    text,
  ]);
  if (status === 0) return { status: "ok" };
  clearPendingPhoneAck();
  if (status === 3) return { status: "not_in_team" };
  return { status: "failed" };
}

/** Probe tmux first; on miss, drop stale team_map entry and return false. */
function focusTerminal(sessionId: string): boolean {
  const tmux = tmuxForSession(sessionId);
  if (!tmux) return false;
  if (!tmuxExists(tmux)) {
    removeSessionFromTeamMap(sessionId);
    log("panel-ws", `focus_terminal: stale tmux ${tmux} — removed team_map entry`);
    return false;
  }
  const script = `tmux attach -t ${tmux.replace(/"/g, '\\"')}`;
  try {
    const child = spawn(
      "osascript",
      [
        "-e",
        `tell app "Terminal" to do script "${script}"`,
        "-e",
        'tell app "Terminal" to activate',
      ],
      { stdio: "ignore" }
    );
    child.on("error", (e) => log("panel-ws", `focus_terminal spawn error: ${e.message}`));
    return true;
  } catch (err: any) {
    log("panel-ws", `focus_terminal failed: ${err?.message ?? err}`);
    return false;
  }
}

function killTeam(sessionId: string): void {
  const tmux = tmuxForSession(sessionId);
  if (tmux) {
    try {
      spawnSync("tmux", ["kill-session", "-t", `=${tmux}`], { stdio: "ignore" });
    } catch (err: any) {
      log("panel-ws", `kill_team failed: ${err?.message ?? err}`);
    }
  }
  // tmux gone → cleanupSession drops team_map + state + voice.
  purgeSessionQueue(sessionId);
  cleanupSession(sessionId);
  safe(broadcastSnapshot);
}

const MOBILE_ACTION_TYPES = new Set([
  "grant",
  "replay",
  "replay_slower",
  "replay_session",
  "play_replay",
  "pause",
  "stop",
  "hold_room",
  "status_say",
  "spawn_session",
  "resume_session",
  "set_live",
]);

function dispatch(msg: PanelMessage): void {
  switch (msg.type) {
    case "set_live":
      // Live narration only makes sense for a session we can converse with.
      if (msg.on && !isTeamSession(msg.sessionId)) {
        emitNotice("Live mode needs a team session");
        return;
      }
      setLiveSession(msg.sessionId, msg.on);
      return;
    case "grant":
      runScript(
        "grant_floor.sh",
        [msg.sessionId],
        msg.output === "phone" ? { CR_OUTPUT: "phone" } : undefined
      );
      return;
    case "ptt":
      runScript("ptt.sh", [msg.phase, msg.sessionId]);
      return;
    case "focus_terminal":
      // Handled in handleMessage (needs WS error reply on stale tmux).
      return;
    case "kill_team":
      killTeam(msg.sessionId);
      return;
    case "status_say":
      runStatusSay(msg.sessionId);
      return;
    case "replay":
      runSignalReplay();
      return;
    case "replay_slower":
      runSignalReplay(0.8);
      return;
    case "replay_session":
      runSignalReplay(undefined, msg.sessionId);
      return;
    case "play_replay":
      // Handled synchronously in dispatchPanelAction (lock + file checks).
      return;
    case "restart":
      runScript("restart.sh", []);
      return;
    case "stop":
      runScript("stop.sh", []);
      return;
    case "pause":
      runScript("pause.sh", []);
      return;
    case "hold_room":
      if (existsSync(HOLD_ROOM_FILE)) {
        runScript("hold_room.sh", ["off"]);
      } else {
        runScript("hold_room.sh", []);
      }
      return;
  }
}

/** Mobile HTTP whitelist + validate + dispatch. Returns false on reject. */
export function dispatchPanelAction(raw: unknown): boolean {
  // Envelope fields are accepted-and-stripped here too (additive).
  const msg = validatePanelMessage(splitCommandEnvelope(raw).body);
  if (msg === "bad_message") return false;
  if (!MOBILE_ACTION_TYPES.has(msg.type)) return false;

  if (msg.type === "spawn_session") {
    return validateAndSpawn(msg.dir, msg.persona, spawnFlags(msg)) === "ok";
  }
  if (msg.type === "resume_session") {
    return validateAndResume(msg.sessionId, msg.dir, msg.persona, spawnFlags(msg)) === "ok";
  }
  if (msg.type === "play_replay") {
    // Missing file or stream lock held → 400. Free path (no synthesis).
    return startPlayReplay(msg.file, msg.offsetSec ?? 0);
  }

  if (
    (msg.type === "grant" || msg.type === "status_say") &&
    !sessionInSnapshot(msg.sessionId)
  ) {
    return false;
  }

  // An explicit grant supersedes an active phone grant (paused mid-message,
  // tapped another agent). Refused only while the old grant is mid-synthesis.
  if (msg.type === "grant" && isUnexpiredPhoneGrant()) {
    if (!supersedePhoneGrant()) {
      log("panel-ws", "refusing grant — phone grant still synthesizing");
      return false;
    }
    log("panel-ws", "superseding active phone grant");
  }

  dispatch(msg);
  return true;
}

function handleMessage(ws: WebSocket, raw: unknown): void {
  const msg = validatePanelMessage(raw);
  if (msg === "bad_message") {
    sendError(ws, "bad_message");
    return;
  }

  if (msg.type === "list_resumable") {
    replyFrame(ws, { type: "resumable", sessions: listResumable() });
    return;
  }

  if (msg.type === "known_dirs") {
    replyFrame(ws, { type: "known_dirs", dirs: knownDirs() });
    return;
  }

  if (msg.type === "get_buttons") {
    sendButtons(ws);
    return;
  }

  if (msg.type === "get_shortcuts") {
    replyFrame(ws, buildShortcutsPayload());
    return;
  }

  if (msg.type === "get_settings") {
    sendSettings(ws);
    return;
  }

  if (msg.type === "list_voices") {
    replyFrame(ws, buildListVoicesMessage());
    return;
  }

  if (msg.type === "set_setting") {
    if (!applySetSetting(msg.key, msg.value)) {
      sendError(ws, "bad_message");
      return;
    }
    sendSettings(ws);
    return;
  }

  if (msg.type === "set_button") {
    const cfg = loadArcadeButtons();
    const key = String(msg.idx);
    const merged = applyButtonPatch(cfg.buttons[key], msg.patch);
    if (merged === "bad_message") {
      sendError(ws, "bad_message");
      return;
    }
    const buttons = { ...cfg.buttons, [key]: merged };
    writeButtons({ device_hint: cfg.device_hint, buttons, sticks: cfg.sticks });
    sendButtons(ws);
    return;
  }

  if (msg.type === "remove_button") {
    const cfg = loadArcadeButtons();
    const key = String(msg.idx);
    if (!cfg.buttons[key]) {
      sendError(ws, "bad_message");
      return;
    }
    const buttons = { ...cfg.buttons };
    delete buttons[key];
    writeButtons({ device_hint: cfg.device_hint, buttons, sticks: cfg.sticks });
    sendButtons(ws);
    return;
  }

  if (msg.type === "learn_capture") {
    if (!isCaptureReady()) {
      sendError(ws, "no_device");
      return;
    }
    captureNextPress(15_000).then((idx) => {
      if (idx == null) return;
      safe(() => ws.send(JSON.stringify({ type: "captured", idx })));
    });
    return;
  }

  if (msg.type === "spawn_session") {
    const result = validateAndSpawn(msg.dir, msg.persona, spawnFlags(msg));
    if (result !== "ok") {
      const message =
        result === "persona_busy"
          ? `${resolvePersonaName(msg.persona) ?? msg.persona} is already in the room`
          : undefined;
      sendError(ws, result, undefined, message);
      return;
    }
    return;
  }

  if (msg.type === "resume_session") {
    const result = validateAndResume(msg.sessionId, msg.dir, msg.persona, spawnFlags(msg));
    if (result !== "ok") {
      const message =
        result === "persona_busy"
          ? `${resolvePersonaName(msg.persona) ?? msg.persona} is already in the room`
          : undefined;
      sendError(ws, result, msg.sessionId, message);
      return;
    }
    return;
  }

  if (msg.type === "set_voice") {
    if (!sessionInSnapshot(msg.sessionId)) {
      sendError(ws, "stale_session", msg.sessionId);
      return;
    }
    const voiceId = resolveVoiceIdForCharacter(msg.character);
    if (!voiceId) {
      sendError(ws, "bad_persona");
      return;
    }
    runScript("set_session_voice.sh", [msg.sessionId, voiceId]);
    return;
  }

  if (msg.type === "set_nickname") {
    if (!sessionInSnapshot(msg.sessionId)) {
      sendError(ws, "stale_session", msg.sessionId);
      return;
    }
    const label = sanitizeNickname(msg.label);
    if (!label) {
      sendError(ws, "bad_message");
      return;
    }
    runScript("nickname.sh", [msg.sessionId, label]);
    return;
  }

  if (msg.type === "hold_room") {
    dispatch(msg);
    return;
  }

  if (
    msg.type === "grant" ||
    msg.type === "ptt" ||
    msg.type === "focus_terminal" ||
    msg.type === "kill_team" ||
    msg.type === "status_say"
  ) {
    if (!sessionInSnapshot(msg.sessionId)) {
      sendError(ws, "stale_session", msg.sessionId);
      return;
    }
  }

  if (msg.type === "grant" && isUnexpiredPhoneGrant()) {
    if (!supersedePhoneGrant()) {
      log("panel-ws", "refusing WS grant — phone grant still synthesizing");
      sendError(ws, "bad_message");
      return;
    }
    log("panel-ws", "superseding active phone grant");
  }

  if (msg.type === "focus_terminal" || msg.type === "kill_team") {
    if (!isTeamSession(msg.sessionId)) {
      sendError(ws, "not_team", msg.sessionId);
      return;
    }
  }

  if (msg.type === "focus_terminal") {
    if (!focusTerminal(msg.sessionId)) {
      sendError(ws, "stale_tmux", msg.sessionId, "tmux session is gone");
    }
    return;
  }

  dispatch(msg);
}

function writeToken(): boolean {
  token = randomBytes(16).toString("hex");
  try {
    writeFileSync(TOKEN_PATH, `${token}\n`, { mode: 0o600 });
    chmodSync(TOKEN_PATH, 0o600);
    return true;
  } catch (err: any) {
    log("panel-ws", `token write failed: ${err?.message ?? err}`);
    token = "";
    return false;
  }
}

export function startPanelWs(): void {
  const port = loadConfig().panel_port;
  if (!port || port <= 0) return;
  if (wss) return;

  if (!writeToken()) return;

  httpServer = createServer();
  wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    safe(() => {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
      const reqToken = url.searchParams.get("token");
      const origin = req.headers.origin;

      if (reqToken !== token || !isAllowedOrigin(origin)) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      wss!.handleUpgrade(req, socket, head, (ws) => {
        wss!.emit("connection", ws, req);
      });
    });
  });

  wss.on("connection", (ws) => {
    safe(() => sendSnapshot(ws));
    ws.on("message", (data) => {
      safe(() => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(data.toString());
        } catch {
          sendError(ws, "bad_message");
          return;
        }
        const { requestId, body } = splitCommandEnvelope(parsed);
        if (!requestId) {
          // Legacy path — behavior unchanged.
          handleMessage(ws, body);
          return;
        }
        activeRequest = { ws, id: requestId, responded: false };
        try {
          handleMessage(ws, body);
          // Nothing errored → the command was accepted/dispatched.
          sendCommandResult(ws, true);
        } finally {
          activeRequest = null;
        }
      });
    });
  });

  httpServer.on("error", (err) => {
    log("panel-ws", `server error: ${err.message}`);
  });

  httpServer.listen(port, "127.0.0.1", () => {
    log("panel-ws", `listening on 127.0.0.1:${port}`);
  });

  unsub = subscribe(() => safe(broadcastSnapshot));
}

export function stopPanelWs(): void {
  if (unsub) {
    unsub();
    unsub = null;
  }
  if (wss) {
    for (const client of wss.clients) safe(() => client.close());
    wss.close();
    wss = null;
  }
  if (httpServer) {
    httpServer.close();
    httpServer = null;
  }
  try {
    if (existsSync(TOKEN_PATH)) unlinkSync(TOKEN_PATH);
  } catch {
    /* token already gone */
  }
  token = "";
}
