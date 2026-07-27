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
import { loadConfig, TTS_DIR, SESSION_VOICES_PATH, PHRASES_DIR } from "./config.js";
import { buildPanelSnapshot, subscribe } from "./state-watch.js";
import {
  dispatchPanelAction,
  handleReplyAction,
  isMobileActionType,
  onNotice,
} from "./services/commands.js";
import { pickerPayload } from "./session-catalog.js";
import { log } from "./logger.js";
import { transcriptThread } from "./services/transcript.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHARACTERS_PATH = join(__dirname, "characters.json");
/** Built mobile Vite SPA. */
const MOBILE_DIST_DIR = join(__dirname, "..", "mobile-dist");
const COOKIE_NAME = "mobile_token";
const HEARTBEAT_MS = 25_000;
/** Slow-loris guards — every real request is fully received in milliseconds. */
const HEADERS_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 30_000;
/** POST /action budget per token (naive fixed window, no dependency). */
const ACTION_WINDOW_MS = 10_000;
const ACTION_MAX_PER_WINDOW = 20;

/** True when mobile-dist/index.html is present; set once at startup. */
let mobileDistReady = false;

function tokenPath(): string {
  return join(TTS_DIR, "mobile_token");
}
function replayDir(): string {
  return join(TTS_DIR, "replay");
}

/** One http.Server per bound address (Node binds a single address each). */
let httpServers: Server[] = [];
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

/**
 * Fresh token on every daemon start (mirrors panel-ws writeToken). A leaked
 * URL — screenshot, shell history, someone else's browser history — dies at
 * the next restart. Accepted consequence: phones re-auth via mobile_url.sh /
 * the QR after a restart. Same file + format `mobile_url.sh` reads.
 */
function createToken(): string {
  const path = tokenPath();
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

/**
 * Tailscale's IPv4 always lives in the CGNAT range 100.64.0.0/10, so a scan of
 * the local interfaces identifies the tailnet address without shelling out to
 * the tailscale CLI. Binding this (plus loopback) instead of 0.0.0.0 keeps the
 * room off every café/hotel LAN the Mac ever joins.
 */
function tailscaleIPv4(): string | null {
  for (const infos of Object.values(networkInterfaces())) {
    for (const info of infos ?? []) {
      const family = info.family as string | number;
      if (family !== "IPv4" && family !== 4) continue;
      if (info.internal) continue;
      const octets = info.address.split(".");
      if (octets.length !== 4 || octets[0] !== "100") continue;
      const second = Number(octets[1]);
      // 100.64.0.0/10 → second octet 64…127.
      if (Number.isInteger(second) && second >= 64 && second <= 127) {
        return info.address;
      }
    }
  }
  return null;
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

// Transcript parsing lives in the transcript service now (bounded reads,
// projection-aware) — this file only serves the result.

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

/** Validate a replay-audio path segment; returns the bare filename or null. */
function safeReplayName(raw: string): string | null {
  const name = basename(raw);
  if (
    !name.endsWith(".mp3") ||
    name !== raw ||
    name.includes("..") ||
    name.includes("/") ||
    name.includes("\\")
  ) {
    return null;
  }
  return name;
}

/** Complete replay file: Range-capable serving (iOS needs 206 + lengths to
 *  start promptly and to scrub). */
function serveReplayAudio(
  req: IncomingMessage,
  res: ServerResponse,
  filePath: string
): void {
  const size = statSync(filePath).size;
  const range = req.headers.range;
  const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
  if (m && (m[1] || m[2])) {
    let start = m[1] ? parseInt(m[1], 10) : NaN;
    let end = m[2] ? parseInt(m[2], 10) : size - 1;
    if (!m[1]) {
      // suffix range: last N bytes
      start = Math.max(0, size - parseInt(m[2], 10));
      end = size - 1;
    }
    end = Math.min(end, size - 1);
    if (!Number.isFinite(start) || start < 0 || start > end || start >= size) {
      res.writeHead(416, { "Content-Range": `bytes */${size}` });
      res.end();
      return;
    }
    res.writeHead(206, {
      "Content-Type": "audio/mpeg",
      "Accept-Ranges": "bytes",
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Content-Length": end - start + 1,
      "Cache-Control": "no-cache",
    });
    createReadStream(filePath, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, {
    "Content-Type": "audio/mpeg",
    "Accept-Ranges": "bytes",
    "Content-Length": size,
    "Cache-Control": "no-cache",
  });
  createReadStream(filePath).pipe(res);
}

const LIVE_POLL_MS = 150;
const LIVE_MAX_MS = 10 * 60_000; // safety cap: never tail longer than 10 min

/** Chunked live tail of a growing .part file until it finalizes (rename to
 *  .mp3) or the client disconnects. No Content-Length — radio-stream model. */
async function serveLiveAudio(
  req: IncomingMessage,
  res: ServerResponse,
  filePath: string,
  partPath: string,
  from: number
): Promise<void> {
  res.writeHead(200, {
    "Content-Type": "audio/mpeg",
    "Cache-Control": "no-cache",
  });
  let offset = from;
  let closed = false;
  let activeRead: ReturnType<typeof createReadStream> | null = null;
  const onGone = () => {
    closed = true;
    // A pump paused on backpressure would wait forever for a drain that never
    // comes — tear the read stream down so its promise settles.
    try { activeRead?.destroy(); } catch { /* already gone */ }
  };
  req.on("close", onGone);
  res.on("close", onGone);

  const currentSize = (p: string): number => {
    try { return statSync(p).size; } catch { return -1; }
  };
  const pump = (p: string, end: number): Promise<void> =>
    new Promise((done) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        activeRead = null;
        done();
      };
      const rs = createReadStream(p, { start: offset, end: end - 1 });
      activeRead = rs;
      rs.on("data", (c: string | Buffer) => {
        if (closed) {
          rs.destroy();
          finish();
          return;
        }
        offset += c.length;
        if (!res.write(c)) {
          rs.pause();
          res.once("drain", () => rs.resume());
        }
      });
      rs.on("close", finish);
      rs.on("end", finish);
      rs.on("error", finish);
    });

  const deadline = Date.now() + LIVE_MAX_MS;
  while (!closed && Date.now() < deadline) {
    const partSize = currentSize(partPath);
    if (partSize > offset) {
      await pump(partPath, partSize);
      continue;
    }
    if (partSize < 0) {
      // .part gone: finalized (drain the remainder from the final file) or
      // aborted (final missing) — either way this stream is over.
      const finalSize = currentSize(filePath);
      if (finalSize > offset) await pump(filePath, finalSize);
      break;
    }
    await new Promise((r) => setTimeout(r, LIVE_POLL_MS));
  }
  try { res.end(); } catch { /* client gone */ }
}

function contentTypeFor(path: string): string {
  if (path.endsWith(".html")) return "text/html; charset=utf-8";
  if (path.endsWith(".js") || path.endsWith(".mjs")) {
    return "text/javascript; charset=utf-8";
  }
  if (path.endsWith(".css")) return "text/css; charset=utf-8";
  if (path.endsWith(".svg")) return "image/svg+xml";
  if (path.endsWith(".woff2")) return "font/woff2";
  if (path.endsWith(".map")) return "application/json";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".json")) return "application/json";
  if (path.endsWith(".mp3")) return "audio/mpeg";
  return "application/octet-stream";
}

function serveFile(
  res: ServerResponse,
  filePath: string,
  cacheControl = "public, max-age=3600"
): void {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, {
    "Content-Type": contentTypeFor(filePath),
    "Cache-Control": cacheControl,
  });
  createReadStream(filePath).pipe(res);
}

function serveMobileAppMissing(res: ServerResponse): void {
  res.writeHead(503, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-cache",
  });
  res.end(
    "mobile SPA not installed: packages/mobile/dist missing. " +
      "Build with `pnpm --filter @room/mobile build`, then restart via tts-server.sh."
  );
}

/**
 * Conservative CSP for the SPA shell. The Vite bundle loads its own hashed
 * JS/CSS from /app/assets (same origin); styles need 'unsafe-inline' because
 * React writes inline style attributes, and media/img allow blob:/data: for
 * the media-session artwork canvas. No external origin is reachable.
 */
const HTML_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "font-src 'self' data:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

/** Fixed-window POST /action budget, keyed by the presented token. */
const actionWindows = new Map<string, { start: number; count: number }>();

function actionRateLimited(key: string): boolean {
  const now = Date.now();
  const win = actionWindows.get(key);
  if (!win || now - win.start >= ACTION_WINDOW_MS) {
    actionWindows.set(key, { start: now, count: 1 });
    // Single-token deployment, but don't let a churn of rejected keys grow
    // the map without bound.
    if (actionWindows.size > 64) {
      for (const [k, v] of actionWindows) {
        if (now - v.start >= ACTION_WINDOW_MS) actionWindows.delete(k);
      }
    }
    return false;
  }
  win.count += 1;
  return win.count > ACTION_MAX_PER_WINDOW;
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  // Applied to every response (writeHead's header object merges on top).
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");

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

  // Phase 5 cutover (2026-07-23, owner-approved): `/` is the React SPA.
  if (method === "GET" && path === "/") {
    if (!mobileDistReady) {
      serveMobileAppMissing(res);
      return;
    }
    const indexPath = join(MOBILE_DIST_DIR, "index.html");
    if (!existsSync(indexPath) || !statSync(indexPath).isFile()) {
      serveMobileAppMissing(res);
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
      "Content-Security-Policy": HTML_CSP,
    });
    res.end(readFileSync(indexPath, "utf-8"));
    return;
  }

  // Pre-cutover SPA path — kept because bookmarks/open tabs use it (the
  // bundle's base is /app/ so hashed assets live under /app/assets either way).
  if (method === "GET" && (path === "/app" || path === "/app/")) {
    if (!mobileDistReady) {
      serveMobileAppMissing(res);
      return;
    }
    const indexPath = join(MOBILE_DIST_DIR, "index.html");
    if (!existsSync(indexPath) || !statSync(indexPath).isFile()) {
      serveMobileAppMissing(res);
      return;
    }
    const html = readFileSync(indexPath, "utf-8");
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
      "Content-Security-Policy": HTML_CSP,
    });
    res.end(html);
    return;
  }

  if (method === "GET" && path.startsWith("/app/assets/")) {
    if (!mobileDistReady) {
      serveMobileAppMissing(res);
      return;
    }
    const rel = path.slice("/app/assets/".length);
    const filePath = safePathUnder(join(MOBILE_DIST_DIR, "assets"), rel);
    if (!filePath) {
      res.writeHead(404);
      res.end();
      return;
    }
    serveFile(res, filePath, "public, max-age=31536000, immutable");
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

  if (method === "GET" && path.startsWith("/thread/")) {
    const sessionId = path.slice("/thread/".length);
    // Real ids are UUIDs; the wider [a-z0-9-] admits mock-live harness ids
    // (mock-<ts>-<pid>) while still excluding every path-traversal character.
    if (!/^[a-z0-9-]{8,64}$/i.test(sessionId)) {
      sendJson(res, 400, { error: "invalid sessionId" });
      return;
    }
    const items = transcriptThread(sessionId);
    if (!items) {
      sendJson(res, 404, { error: "transcript not found" });
      return;
    }
    const parsedLimit = Number.parseInt(url.searchParams.get("limit") ?? "40", 10);
    const limit = Number.isFinite(parsedLimit) && parsedLimit >= 0 ? parsedLimit : 40;
    sendJson(res, 200, { sessionId, items: limit === 0 ? [] : items.slice(-limit) });
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
    // Subscribe BEFORE the bootstrap write: a state change landing between
    // the two would otherwise be missed until the next watched change.
    // (Duplicate frames are harmless — clients rev-gate or last-writer-win.)
    const writeSnap = () => writeSse(res, buildPanelSnapshot());
    sseClients.add(res);
    const unsub = subscribe(() => safe(writeSnap));
    sseUnsubs.add(unsub);
    writeSnap();
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
    const name = safeReplayName(path.slice("/replay-audio/".length));
    if (!name) {
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
    serveReplayAudio(req, res, filePath);
    return;
  }

  // Live tail of a still-synthesizing replay (.mp3.part): send what's on disk,
  // then follow the file until it finalizes. ?from=<bytes> resumes mid-stream.
  if (method === "GET" && path.startsWith("/live-audio/")) {
    const name = safeReplayName(path.slice("/live-audio/".length));
    if (!name) {
      res.writeHead(404);
      res.end();
      return;
    }
    const filePath = join(replayDir(), name);
    const partPath = `${filePath}.part`;
    if (!existsSync(partPath) && !existsSync(filePath)) {
      res.writeHead(404);
      res.end();
      return;
    }
    const fromRaw = Number(url.searchParams.get("from") ?? 0);
    const from = Number.isFinite(fromRaw) && fromRaw > 0 ? Math.floor(fromRaw) : 0;
    // Part already finalized: same contract (bytes from `from` to EOF, then
    // end) — the tail loop drains the final file and closes immediately.
    await serveLiveAudio(req, res, filePath, partPath, from);
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

  // Cached ack phrase clips ("<voiceId>/<file>.mp3") for phone-routed acks.
  if (method === "GET" && path.startsWith("/phrase-audio/")) {
    const rel = path.slice("/phrase-audio/".length);
    const filePath = rel.endsWith(".mp3") ? safePathUnder(PHRASES_DIR, rel) : null;
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
    if (actionRateLimited(reqToken)) {
      res.setHeader("Retry-After", String(Math.ceil(ACTION_WINDOW_MS / 1000)));
      sendJson(res, 429, { ok: false, error: "rate limited" });
      return;
    }
    let body: unknown;
    try {
      const raw = await readBody(req);
      body = raw ? JSON.parse(raw) : null;
    } catch {
      sendJson(res, 400, { ok: false });
      return;
    }
    // Every mobile intent — reply included — clears the one server-authoritative
    // allowlist before any dedicated path runs.
    const bodyType =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as { type?: unknown }).type
        : undefined;
    if (typeof bodyType !== "string" || !isMobileActionType(bodyType)) {
      sendJson(res, 400, { ok: false });
      return;
    }
    // Reply needs a real exit-code result — dedicated sync path (not fire-and-forget).
    if (bodyType === "reply") {
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
  if (httpServers.length) return;

  token = createToken();
  actionWindows.clear();

  mobileDistReady =
    existsSync(MOBILE_DIST_DIR) &&
    existsSync(join(MOBILE_DIST_DIR, "index.html"));
  if (!mobileDistReady) {
    log(
      "mobile-http",
      `WARNING: mobile SPA dist missing at ${MOBILE_DIST_DIR} — GET /app will 503 until packages/mobile/dist is built and synced`
    );
  }

  if (!noticeUnsub) {
    noticeUnsub = onNotice((msg) => broadcastSseNotice(msg.message));
  }

  const listenOn = (address: string): void => {
    const server = createServer((req, res) => {
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
    server.headersTimeout = HEADERS_TIMEOUT_MS;
    server.requestTimeout = REQUEST_TIMEOUT_MS;
    server.on("error", (err) => {
      log("mobile-http", `server error (${address}): ${err.message}`);
    });
    server.listen(port, address);
    httpServers.push(server);
  };

  // Bind loopback + the tailnet only — never 0.0.0.0. Node binds one address
  // per server, so each address gets its own listener over the same handler.
  const tailscaleIp = tailscaleIPv4();
  listenOn("127.0.0.1");
  if (tailscaleIp) listenOn(tailscaleIp);
  else {
    log(
      "mobile-http",
      "WARNING: no Tailscale IPv4 (100.64.0.0/10) found — bound to 127.0.0.1 only; the phone can't reach the room until Tailscale is up"
    );
  }

  // NEVER log the token: hook.log is long-lived, shoulder-surfable, and gets
  // pasted into debugging threads. `mobile_url.sh` prints the full URL.
  const shownIp = tailscaleIp ?? "127.0.0.1";
  const line =
    `Mobile room: http://${shownIp}:${port}/ ` +
    `(token ${token.slice(0, 6)}… — full URL: mobile_url.sh)`;
  log("mobile-http", line);
  console.log(line);
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
  for (const server of httpServers) {
    try {
      server.close();
    } catch {
      /* already closed */
    }
  }
  httpServers = [];
  actionWindows.clear();
  // The token file stays on disk (mobile_url.sh reads it); the next start
  // overwrites it with a fresh one.
  token = "";
}
