import { createServer, type Server } from "http";
import { randomBytes } from "crypto";
import { chmodSync, existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import { WebSocketServer, WebSocket } from "ws";
import { loadConfig, TTS_DIR } from "./config.js";
import { buildSnapshot, subscribe } from "./state-watch.js";
import { log } from "./logger.js";
import { isTeamSession, tmuxForSession, removeSessionFromTeamMap } from "./team-map.js";
import { runStatusSay } from "./status-say.js";
import { knownDirs, isResumableSession, listResumable } from "./session-catalog.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHARACTERS_PATH = join(__dirname, "characters.json");

const SCRIPTS_DIR = join(TTS_DIR, "scripts");
const SERVER_DIR = join(TTS_DIR, "tts-server");
const TOKEN_PATH = join(TTS_DIR, "panel_ws_token");

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
  | { type: "resume_session"; sessionId: string; dir: string; persona: string };

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
    default:
      return "bad_message";
  }
}

function sessionInSnapshot(sessionId: string): boolean {
  return buildSnapshot().some((a) => a.sessionId === sessionId);
}

function sendSnapshot(ws: WebSocket): void {
  ws.send(JSON.stringify({ type: "snapshot", agents: buildSnapshot() }));
}

function broadcastSnapshot(): void {
  if (!wss) return;
  const payload = JSON.stringify({ type: "snapshot", agents: buildSnapshot() });
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
    | "bad_session",
  sessionId?: string
): void {
  const err: Record<string, string> = { type: "error", code };
  if (sessionId) err.sessionId = sessionId;
  ws.send(JSON.stringify(err));
}

function isKnownPersona(persona: string): boolean {
  if (!existsSync(CHARACTERS_PATH)) return false;
  try {
    const chars = JSON.parse(readFileSync(CHARACTERS_PATH, "utf-8")) as Record<
      string,
      { name?: string }
    >;
    const lower = persona.toLowerCase();
    for (const entry of Object.values(chars)) {
      if (entry?.name?.toLowerCase() === lower) return true;
    }
  } catch {
    /* invalid characters.json */
  }
  return false;
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
