import { createServer, type Server } from "http";
import { randomBytes } from "crypto";
import { chmodSync, existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawn, spawnSync } from "child_process";
import { WebSocketServer, WebSocket } from "ws";
import { loadConfig, TTS_DIR, CONFIG_PATH, loadArcadeButtons, saveArcadeButtons, isValidArcadeColor, effectivePlaybackMode, type ArcadeButton, type ArcadeButtons } from "./config.js";
import { buildPanelSnapshot, subscribe } from "./state-watch.js";
import { log } from "./logger.js";
import { isTeamSession, tmuxForSession, removeSessionFromTeamMap } from "./team-map.js";
import { removeSessionState, purgeSessionQueue } from "./state.js";
import { runStatusSay } from "./status-say.js";
import { knownDirs, isResumableSession, listResumable } from "./session-catalog.js";
import { HID_ACTIONS, captureNextPress, isCaptureReady } from "./hid.js";
import { buildShortcutsPayload } from "./shortcuts.js";

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

export type PanelMessage =
  | { type: "grant"; sessionId: string }
  | { type: "ptt"; phase: "start" | "stop"; sessionId: string }
  | { type: "focus_terminal"; sessionId: string }
  | { type: "kill_team"; sessionId: string }
  | { type: "status_say"; sessionId: string }
  | { type: "replay" }
  | { type: "replay_slower" }
  | { type: "restart" }
  | { type: "stop" }
  | { type: "pause" }
  | { type: "list_resumable" }
  | { type: "known_dirs" }
  | { type: "spawn_session"; dir: string; persona: string }
  | { type: "resume_session"; sessionId: string; dir: string; persona: string }
  | { type: "set_voice"; sessionId: string; character: string }
  | { type: "set_nickname"; sessionId: string; label: string }
  | { type: "hold_room" }
  | { type: "get_buttons" }
  | { type: "set_button"; idx: number; patch: ButtonPatch }
  | { type: "remove_button"; idx: number }
  | { type: "learn_capture" }
  | { type: "get_shortcuts" }
  | { type: "get_settings" }
  | { type: "set_setting"; key: string; value: unknown }
  | { type: "list_voices" };

export type ButtonPatch = {
  name?: string;
  character?: string;
  action?: string;
  hold_action?: string;
  color?: string;
  notes?: string;
};

let httpServer: Server | null = null;
let wss: WebSocketServer | null = null;
let unsub: (() => void) | null = null;
let token = "";

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

function runScript(name: string, args: string[]): void {
  try {
    const child = spawn(join(SCRIPTS_DIR, name), args, {
      stdio: "ignore",
      env: scriptEnv(),
    });
    child.on("error", (e) => log("panel-ws", `${name} spawn error: ${e.message}`));
  } catch (err: any) {
    log("panel-ws", `${name} spawn failed: ${err?.message ?? err}`);
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

function runSignalReplay(speed?: number): void {
  try {
    const args = ["exec", "tsx", "src/signal.ts", "replay", "", "1"];
    if (speed != null) args.push(String(speed));
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
  ws.send(JSON.stringify(buildButtonsMessage()));
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
  ws.send(JSON.stringify(buildSettingsMessage()));
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
      if (keys.length !== 2 || typeof msg.sessionId !== "string" || !msg.sessionId.trim()) {
        return "bad_message";
      }
      return { type: "grant", sessionId: msg.sessionId };
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
    case "spawn_session":
      if (
        keys.length !== 3 ||
        typeof msg.dir !== "string" ||
        !msg.dir.trim() ||
        typeof msg.persona !== "string" ||
        !msg.persona.trim()
      ) {
        return "bad_message";
      }
      return { type: "spawn_session", dir: msg.dir, persona: msg.persona };
    case "resume_session":
      if (
        keys.length !== 4 ||
        typeof msg.sessionId !== "string" ||
        !msg.sessionId.trim() ||
        typeof msg.dir !== "string" ||
        !msg.dir.trim() ||
        typeof msg.persona !== "string" ||
        !msg.persona.trim()
      ) {
        return "bad_message";
      }
      return {
        type: "resume_session",
        sessionId: msg.sessionId,
        dir: msg.dir,
        persona: msg.persona,
      };
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

function sendError(
  ws: WebSocket,
  code:
    | "bad_message"
    | "stale_session"
    | "not_team"
    | "bad_dir"
    | "bad_persona"
    | "bad_session"
    | "no_device",
  sessionId?: string
): void {
  const err: Record<string, string> = { type: "error", code };
  if (sessionId) err.sessionId = sessionId;
  ws.send(JSON.stringify(err));
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

function spawnTeam(persona: string, dir: string, resumeSessionId?: string): void {
  const args = resumeSessionId
    ? [persona, dir, "--resume", resumeSessionId]
    : [persona, dir];
  runScript("team.sh", args);
}

function focusTerminal(sessionId: string): void {
  const tmux = tmuxForSession(sessionId);
  if (!tmux) return;
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
  } catch (err: any) {
    log("panel-ws", `focus_terminal failed: ${err?.message ?? err}`);
  }
}

function killTeam(sessionId: string): void {
  const tmux = tmuxForSession(sessionId);
  if (!tmux) return;
  try {
    const child = spawn("tmux", ["kill-session", "-t", tmux], { stdio: "ignore" });
    child.on("error", (e) => log("panel-ws", `kill_team spawn error: ${e.message}`));
  } catch (err: any) {
    log("panel-ws", `kill_team failed: ${err?.message ?? err}`);
  }
  removeSessionFromTeamMap(sessionId);
  // Retire the room card and any undelivered updates, or the ghost lingers
  // until the next daemon restart's startup reconciliation.
  purgeSessionQueue(sessionId);
  removeSessionState(sessionId);
  safe(broadcastSnapshot);
}

function dispatch(msg: PanelMessage): void {
  switch (msg.type) {
    case "grant":
      runScript("grant_floor.sh", [msg.sessionId]);
      return;
    case "ptt":
      runScript("ptt.sh", [msg.phase, msg.sessionId]);
      return;
    case "focus_terminal":
      focusTerminal(msg.sessionId);
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

function handleMessage(ws: WebSocket, raw: unknown): void {
  const msg = validatePanelMessage(raw);
  if (msg === "bad_message") {
    sendError(ws, "bad_message");
    return;
  }

  if (msg.type === "list_resumable") {
    ws.send(JSON.stringify({ type: "resumable", sessions: listResumable() }));
    return;
  }

  if (msg.type === "known_dirs") {
    ws.send(JSON.stringify({ type: "known_dirs", dirs: knownDirs() }));
    return;
  }

  if (msg.type === "get_buttons") {
    sendButtons(ws);
    return;
  }

  if (msg.type === "get_shortcuts") {
    ws.send(JSON.stringify(buildShortcutsPayload()));
    return;
  }

  if (msg.type === "get_settings") {
    sendSettings(ws);
    return;
  }

  if (msg.type === "list_voices") {
    ws.send(JSON.stringify(buildListVoicesMessage()));
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
    if (!isValidDir(msg.dir)) {
      sendError(ws, "bad_dir");
      return;
    }
    if (!isKnownPersona(msg.persona)) {
      sendError(ws, "bad_persona");
      return;
    }
    spawnTeam(msg.persona, msg.dir);
    return;
  }

  if (msg.type === "resume_session") {
    if (!isValidDir(msg.dir)) {
      sendError(ws, "bad_dir");
      return;
    }
    if (!isKnownPersona(msg.persona)) {
      sendError(ws, "bad_persona");
      return;
    }
    if (!isResumableSession(msg.sessionId)) {
      sendError(ws, "bad_session", msg.sessionId);
      return;
    }
    spawnTeam(msg.persona, msg.dir, msg.sessionId);
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

  if (msg.type === "focus_terminal" || msg.type === "kill_team") {
    if (!isTeamSession(msg.sessionId)) {
      sendError(ws, "not_team", msg.sessionId);
      return;
    }
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
        handleMessage(ws, parsed);
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
