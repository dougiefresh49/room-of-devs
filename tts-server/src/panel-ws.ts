/**
 * Panel WebSocket — a THIN transport adapter since Phase 1: auth, framing,
 * requestId correlation, and the settings/buttons UI payloads. Validation,
 * capability policy, and dispatch live in services/commands.ts.
 */
import { createServer, type Server } from "http";
import { randomBytes } from "crypto";
import { chmodSync, existsSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { WebSocketServer, WebSocket } from "ws";
import { loadConfig, TTS_DIR, CONFIG_PATH, loadArcadeButtons, saveArcadeButtons, isValidArcadeColor, effectivePlaybackMode, type ArcadeButton, type ArcadeButtons } from "./config.js";
import { buildPanelSnapshot, invalidateSnapshot, subscribe } from "./state-watch.js";
import { log } from "./logger.js";
import { isTeamSession } from "./team-map.js";
import { knownDirs, listResumable } from "./session-catalog.js";
import { HID_ACTIONS } from "./hid-actions.js";
import { captureNextPress, isCaptureReady } from "./hid-controller.js";
import { buildShortcutsPayload } from "./shortcuts.js";
import { isUnexpiredPhoneGrant, supersedePhoneGrant } from "./now-playing.js";
import {
  HOLD_ROOM_FILE,
  splitCommandEnvelope,
  validatePanelMessage,
  validateAndSpawn,
  validateAndResume,
  spawnFlags,
  resolvePersonaName,
  resolveVoiceIdForCharacter,
  sanitizeNickname,
  sessionInSnapshot,
  listCharacterNames,
  focusTerminal,
  killTeam,
  dispatch,
  onNotice,
  runScript,
  runScriptSync,
  type PanelMessage,
  type ButtonPatch,
} from "./services/commands.js";

// Command/dispatch API re-exported for existing callers (mobile-http imports
// from the service directly; these keep the old panel-ws surface working).
export {
  dispatchPanelAction,
  handleReplyAction,
  onNotice,
  emitNotice,
  splitCommandEnvelope,
  validatePanelMessage,
  validateAndSpawn,
  validateAndResume,
  type PanelMessage,
  type ButtonPatch,
  type SpawnOpts,
  type SpawnValidateResult,
  type ReplyStatus,
  type CommandEnvelope,
} from "./services/commands.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHARACTERS_PATH = join(__dirname, "characters.json");

const TOKEN_PATH = join(TTS_DIR, "panel_ws_token");
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


let httpServer: Server | null = null;
let wss: WebSocketServer | null = null;
let unsub: (() => void) | null = null;
let noticeUnsub: (() => void) | null = null;
let token = "";

function safe(fn: () => void): void {
  try {
    fn();
  } catch (err: any) {
    log("panel-ws", `handler error: ${err?.message ?? err}`);
  }
}

export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  return origin.startsWith("tauri://") || origin.startsWith("http://localhost");
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
    const c = (patch.character ?? "").trim();
    if (c && !isKnownCharacter(c)) return "bad_message";
    if (c) {
      merged.character = c;
      delete merged.action;
    } else {
      delete merged.character;
    }
  }
  if (patch.action !== undefined) {
    const a = (patch.action ?? "").trim();
    if (a && !isValidAction(a)) return "bad_message";
    if (a) {
      merged.action = a;
      delete merged.character;
    } else {
      delete merged.action;
    }
  }
  if (patch.hold_action !== undefined) {
    const h = (patch.hold_action ?? "").trim();
    if (h && !isValidAction(h)) return "bad_message";
    if (h) merged.hold_action = h;
    else delete merged.hold_action;
  }
  if (patch.color !== undefined) {
    const col = (patch.color ?? "").trim();
    if (col && !isValidArcadeColor(col)) return "bad_message";
    if (col) merged.color = col;
    else delete merged.color;
  }
  if (patch.notes !== undefined) {
    const notes = (patch.notes ?? "").trim();
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

  if (msg.type === "kill_team") {
    // killTeam lives in the command service; the immediate broadcast stays
    // here so the card disappears without waiting on the watcher debounce —
    // invalidate first or it would re-serve the pre-kill memoized snapshot.
    killTeam(msg.sessionId);
    invalidateSnapshot();
    safe(broadcastSnapshot);
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
  // 1 MB ceiling: the largest legitimate frame is a reply (4k chars) by orders
  // of magnitude — an unbounded frame is just a memory-exhaustion lever.
  wss = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 });

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
  // Notices come from the command service's bus now; fan out to WS clients.
  noticeUnsub = onNotice((msg) => broadcastPanel(msg));
}

export function stopPanelWs(): void {
  if (unsub) {
    unsub();
    unsub = null;
  }
  if (noticeUnsub) {
    noticeUnsub();
    noticeUnsub = null;
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
