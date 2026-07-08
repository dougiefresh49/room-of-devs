import { createServer, type Server } from "http";
import { randomBytes } from "crypto";
import { chmodSync, existsSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { spawn } from "child_process";
import { WebSocketServer, WebSocket } from "ws";
import { loadConfig, TTS_DIR } from "./config.js";
import { buildSnapshot, subscribe } from "./state-watch.js";
import { log } from "./logger.js";

const SCRIPTS_DIR = join(TTS_DIR, "scripts");
const SERVER_DIR = join(TTS_DIR, "tts-server");
const TOKEN_PATH = join(TTS_DIR, "panel_ws_token");

export type PanelMessage =
  | { type: "grant"; sessionId: string }
  | { type: "ptt"; phase: "start" | "stop"; sessionId: string }
  | { type: "replay" }
  | { type: "stop" }
  | { type: "pause" };

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
    case "replay":
    case "stop":
    case "pause":
      if (keys.length !== 1) return "bad_message";
      return { type: msg.type };
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
  code: "bad_message" | "stale_session",
  sessionId?: string
): void {
  const err: Record<string, string> = { type: "error", code };
  if (sessionId) err.sessionId = sessionId;
  ws.send(JSON.stringify(err));
}

function dispatch(msg: PanelMessage): void {
  switch (msg.type) {
    case "grant":
      runScript("grant_floor.sh", [msg.sessionId]);
      return;
    case "ptt":
      runScript("ptt.sh", [msg.phase, msg.sessionId]);
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

  if (msg.type === "grant" || msg.type === "ptt") {
    if (!sessionInSnapshot(msg.sessionId)) {
      sendError(ws, "stale_session", msg.sessionId);
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
