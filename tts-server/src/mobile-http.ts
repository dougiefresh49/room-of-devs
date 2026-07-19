import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "http";
import { randomBytes, timingSafeEqual } from "crypto";
import {
  chmodSync,
  createReadStream,
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "fs";
import { networkInterfaces } from "os";
import { basename, dirname, join, resolve, sep } from "path";
import { fileURLToPath } from "url";
import { loadConfig, TTS_DIR, SESSION_VOICES_PATH } from "./config.js";
import { buildPanelSnapshot, subscribe } from "./state-watch.js";
import { dispatchPanelAction, handleReplyAction, onNotice } from "./panel-ws.js";
import { pickerPayload } from "./session-catalog.js";
import { log } from "./logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHARACTERS_PATH = join(__dirname, "characters.json");
const HTML_PATH = join(__dirname, "..", "mobile.html");
const COOKIE_NAME = "mobile_token";
const HEARTBEAT_MS = 25_000;

function tokenPath(): string {
  return join(TTS_DIR, "mobile_token");
}
function replayDir(): string {
  return join(TTS_DIR, "replay");
}

let httpServer: Server | null = null;
let token = "";
const sseUnsubs = new Set<() => void>();
/** Live SSE response streams — used to push typed notice events. */
const sseClients = new Set<ServerResponse>();
let noticeUnsub: (() => void) | null = null;

function safe(fn: () => void): void {
  try {
    fn();
  } catch (err: any) {
    log("mobile-http", `handler error: ${err?.message ?? err}`);
  }
}

function writeSse(res: ServerResponse, payload: unknown): void {
  try {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  } catch {
    /* client gone */
  }
}

function broadcastSseNotice(message: string): void {
  const payload = { type: "notice", message };
  for (const res of sseClients) writeSse(res, payload);
}

function tokensEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function loadOrCreateToken(): string {
  const path = tokenPath();
  try {
    if (existsSync(path)) {
      const existing = readFileSync(path, "utf-8").trim();
      if (existing) return existing;
    }
  } catch {
    /* recreate below */
  }
  const t = randomBytes(16).toString("hex");
  writeFileSync(path, `${t}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return t;
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

function extractToken(req: IncomingMessage, url: URL): string | null {
  const q = url.searchParams.get("t");
  if (q) return q;
  const cookies = parseCookies(req.headers.cookie);
  return cookies[COOKIE_NAME] ?? null;
}

function setAuthCookie(res: ServerResponse, t: string): void {
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${t}; HttpOnly; SameSite=Strict; Path=/`
  );
}

function unauthorized(res: ServerResponse): void {
  res.writeHead(401);
  res.end();
}

function lanIPv4(): string {
  const ifaces = networkInterfaces();
  for (const infos of Object.values(ifaces)) {
    for (const info of infos ?? []) {
      const family = info.family as string | number;
      if ((family === "IPv4" || family === 4) && !info.internal) {
        return info.address;
      }
    }
  }
  return "127.0.0.1";
}

function resolveAvatarsRoot(): string {
  const repo = resolve(__dirname, "..", "..", "panel", "public", "avatars");
  if (existsSync(repo)) return repo;
  return join(TTS_DIR, "mobile-assets", "avatars");
}

/** Resolve a relative path under root; reject traversal. */
function safePathUnder(root: string, rel: string): string | null {
  if (!rel || rel.includes("\0") || rel.includes("..")) return null;
  const cleaned = rel.replace(/^\/+/, "").replace(/\\/g, "/");
  if (!cleaned || cleaned.split("/").some((p) => p === ".." || p === "")) {
    return null;
  }
  const resolved = resolve(root, cleaned);
  const rootResolved = resolve(root);
  if (resolved !== rootResolved && !resolved.startsWith(rootResolved + sep)) {
    return null;
  }
  return resolved;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-cache",
  });
  res.end(data);
}

interface ReplayListEntry {
  file: string;
  sessionId?: string;
  sessionName?: string;
  character?: string;
  textPreview?: string;
  spokenText?: string;
  rawText?: string;
  alignment?: unknown;
  playbackRate?: number;
  kind?: string;
  timestamp?: string;
}

function listReplays(): ReplayListEntry[] {
  const dir = replayDir();
  if (!existsSync(dir)) return [];
  const entries: ReplayListEntry[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".mp3")) continue;
    const sidecar = join(dir, f.replace(/\.mp3$/, ".json"));
    let meta: Record<string, unknown> = {};
    if (existsSync(sidecar)) {
      try {
        meta = JSON.parse(readFileSync(sidecar, "utf-8"));
      } catch {
        /* empty meta */
      }
    }
    entries.push({
      file: f,
      sessionId: typeof meta.sessionId === "string" ? meta.sessionId : undefined,
      sessionName:
        typeof meta.sessionName === "string" ? meta.sessionName : undefined,
      character: typeof meta.character === "string" ? meta.character : undefined,
      textPreview:
        typeof meta.textPreview === "string" ? meta.textPreview : undefined,
      spokenText:
        typeof meta.spokenText === "string" ? meta.spokenText : undefined,
      // The agent's original message (pre-Gemini) — the Message tab shows
      // this, not the character transcript.
      rawText: typeof meta.rawText === "string" ? meta.rawText : undefined,
      alignment: meta.alignment,
      playbackRate:
        typeof meta.playbackRate === "number" ? meta.playbackRate : undefined,
      kind: typeof meta.kind === "string" ? meta.kind : undefined,
      timestamp: typeof meta.timestamp === "string" ? meta.timestamp : undefined,
    });
  }
  // Newest first: filenames are ISO-timestamp prefixed.
  entries.sort((a, b) => (a.file < b.file ? 1 : a.file > b.file ? -1 : 0));
  return entries;
}

function contentTypeFor(path: string): string {
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".json")) return "application/json";
  if (path.endsWith(".mp3")) return "audio/mpeg";
  return "application/octet-stream";
}

function serveFile(res: ServerResponse, filePath: string): void {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, {
    "Content-Type": contentTypeFor(filePath),
    "Cache-Control": "public, max-age=3600",
  });
  createReadStream(filePath).pipe(res);
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const host = req.headers.host ?? "127.0.0.1";
  const url = new URL(req.url ?? "/", `http://${host}`);
  const method = req.method ?? "GET";

  const reqToken = extractToken(req, url);
  if (!reqToken || !tokensEqual(reqToken, token)) {
    unauthorized(res);
    return;
  }

  // Seed cookie from a successful ?t= page load (and any authenticated hit).
  if (url.searchParams.has("t")) {
    setAuthCookie(res, token);
  }

  const path = url.pathname;

  if (method === "GET" && path === "/") {
    if (!existsSync(HTML_PATH)) {
      res.writeHead(500);
      res.end("mobile.html missing");
      return;
    }
    const html = readFileSync(HTML_PATH, "utf-8");
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
    });
    res.end(html);
    return;
  }

  // Browsers request this unprompted; 404 shows as a console error on the page.
  if (method === "GET" && path === "/favicon.ico") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (method === "GET" && path === "/snapshot") {
    sendJson(res, 200, buildPanelSnapshot());
    return;
  }

  if (method === "GET" && path === "/picker") {
    sendJson(res, 200, pickerPayload());
    return;
  }

  if (method === "GET" && path === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    const writeSnap = () => writeSse(res, buildPanelSnapshot());
    writeSnap();
    sseClients.add(res);
    const unsub = subscribe(() => safe(writeSnap));
    sseUnsubs.add(unsub);
    const heartbeat = setInterval(() => {
      try {
        res.write(": heartbeat\n\n");
      } catch {
        /* client gone */
      }
    }, HEARTBEAT_MS);
    const cleanup = () => {
      clearInterval(heartbeat);
      unsub();
      sseUnsubs.delete(unsub);
      sseClients.delete(res);
    };
    req.on("close", cleanup);
    req.on("error", cleanup);
    return;
  }

  if (method === "GET" && path === "/replay-list") {
    sendJson(res, 200, listReplays());
    return;
  }

  if (method === "GET" && path.startsWith("/replay-audio/")) {
    const name = basename(path.slice("/replay-audio/".length));
    if (
      !name.endsWith(".mp3") ||
      name !== path.slice("/replay-audio/".length) ||
      name.includes("..") ||
      name.includes("/") ||
      name.includes("\\")
    ) {
      res.writeHead(404);
      res.end();
      return;
    }
    const filePath = join(replayDir(), name);
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-cache",
    });
    createReadStream(filePath).pipe(res);
    return;
  }

  if (method === "GET" && path.startsWith("/avatars/")) {
    const rel = path.slice("/avatars/".length);
    const filePath = safePathUnder(resolveAvatarsRoot(), rel);
    if (!filePath) {
      res.writeHead(404);
      res.end();
      return;
    }
    serveFile(res, filePath);
    return;
  }

  if (method === "GET" && path === "/characters") {
    let characters: Record<string, unknown> = {};
    if (existsSync(CHARACTERS_PATH)) {
      try {
        characters = JSON.parse(readFileSync(CHARACTERS_PATH, "utf-8"));
      } catch {
        characters = {};
      }
    }
    let sessionVoices: Record<string, string> = {};
    if (existsSync(SESSION_VOICES_PATH)) {
      try {
        sessionVoices = JSON.parse(readFileSync(SESSION_VOICES_PATH, "utf-8"));
      } catch {
        sessionVoices = {};
      }
    }
    sendJson(res, 200, { characters, sessionVoices });
    return;
  }

  if (method === "POST" && path === "/action") {
    let body: unknown;
    try {
      const raw = await readBody(req);
      body = raw ? JSON.parse(raw) : null;
    } catch {
      sendJson(res, 400, { ok: false });
      return;
    }
    // Reply needs a real exit-code result — dedicated sync path (not fire-and-forget).
    if (
      body &&
      typeof body === "object" &&
      !Array.isArray(body) &&
      (body as { type?: unknown }).type === "reply"
    ) {
      const result = handleReplyAction(body);
      if (!result) {
        sendJson(res, 400, { ok: false });
        return;
      }
      sendJson(res, 200, result);
      return;
    }
    if (!dispatchPanelAction(body)) {
      sendJson(res, 400, { ok: false });
      return;
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  res.writeHead(404);
  res.end();
}

/** Optional port override for smoke tests. */
export function startMobileHttp(portOverride?: number): void {
  const port = portOverride ?? loadConfig().mobile_port;
  if (!port || port <= 0) return;
  if (httpServer) return;

  token = loadOrCreateToken();

  if (!noticeUnsub) {
    noticeUnsub = onNotice((msg) => broadcastSseNotice(msg.message));
  }

  httpServer = createServer((req, res) => {
    safe(() => {
      handleRequest(req, res).catch((err: any) => {
        log("mobile-http", `request error: ${err?.message ?? err}`);
        if (!res.headersSent) {
          res.writeHead(500);
          res.end();
        }
      });
    });
  });

  httpServer.on("error", (err) => {
    log("mobile-http", `server error: ${err.message}`);
  });

  httpServer.listen(port, "0.0.0.0", () => {
    const ip = lanIPv4();
    log("mobile-http", `Mobile room: http://${ip}:${port}/?t=${token}`);
    console.log(`Mobile room: http://${ip}:${port}/?t=${token}`);
  });
}

export function stopMobileHttp(): void {
  for (const unsub of sseUnsubs) {
    try {
      unsub();
    } catch {
      /* ignore */
    }
  }
  sseUnsubs.clear();
  sseClients.clear();
  if (noticeUnsub) {
    noticeUnsub();
    noticeUnsub = null;
  }
  if (httpServer) {
    httpServer.close();
    httpServer = null;
  }
  // Persist token across restarts — do not delete mobile_token.
  token = "";
}
