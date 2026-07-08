import { createServer, type Server } from "http";
import { randomBytes } from "crypto";
import { chmodSync, existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import { WebSocketServer, WebSocket } from "ws";
import { loadConfig, TTS_DIR, loadArcadeButtons, saveArcadeButtons, isValidArcadeColor, type ArcadeButton, type ArcadeButtons } from "./config.js";
import { buildPanelSnapshot, subscribe } from "./state-watch.js";
import { log } from "./logger.js";
import { isTeamSession, tmuxForSession, removeSessionFromTeamMap } from "./team-map.js";
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

export type PanelMessage =
  | { type: "grant"; sessionId: string }
  | { type: "ptt"; phase: "start" | "stop"; sessionId: string }
  | { type: "focus_terminal"; sessionId: string }
  | { type: "kill_team"; sessionId: string }
  | { type: "status_say"; sessionId: string }
  | { type: "replay" }
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
  | { type: "get_shortcuts" };

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

function runScript(name: string, args: string[]): void {
  try {
    const child = spawn(join(SCRIPTS_DIR, name), args, { stdio: "ignore" });
    child.on("error", (e) => log("panel-ws", `${name} spawn error: ${e.message}`));
  } catch (err: any) {
    log("panel-ws", `${name} spawn failed: ${err?.message ?? err}`);
  }
}

function runSignalReplay(): void {
  try {
    const child = spawn(
      "pnpm",
      ["exec", "tsx", "src/signal.ts", "replay", "", "1"],
      { cwd: SERVER_DIR, stdio: "ignore" }
    );
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
      if (keys.length !== 1) return "bad_message";
      return { type: msg.type };
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

  if (msg.type === "set_button") {
    const cfg = loadArcadeButtons();
    const key = String(msg.idx);
    const merged = applyButtonPatch(cfg.buttons[key], msg.patch);
    if (merged === "bad_message") {
      sendError(ws, "bad_message");
      return;
    }
    const buttons = { ...cfg.buttons, [key]: merged };
    writeButtons({ device_hint: cfg.device_hint, buttons });
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
    writeButtons({ device_hint: cfg.device_hint, buttons });
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
