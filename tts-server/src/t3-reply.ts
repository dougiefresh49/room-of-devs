import { randomUUID } from "crypto";
import { lstatSync, readFileSync } from "fs";
import { isIP } from "net";
import { homedir } from "os";
import { join } from "path";
import { TTS_DIR } from "./config.js";
import { log } from "./logger.js";
import { t3ThreadIdForSession } from "./t3-thread-state.js";

const T3_RUNTIME_PATH = join(homedir(), ".t3", "userdata", "server-runtime.json");
const T3_BEARER_PATH = join(TTS_DIR, "secrets", "t3-bearer");
export const T3_AUTH_REV_PATH = join(TTS_DIR, ".t3-auth-rev");

const BEARER_CACHE_MS = 2_000;
const TOTAL_TIMEOUT_MS = 6_800;
const EXPIRY_WARNING_MS = 3 * 24 * 60 * 60 * 1000;
const EXPIRY_WARNING_RATE_MS = 6 * 60 * 60 * 1000;
const REQUIRED_SCOPES = ["orchestration:read", "orchestration:operate"] as const;

export type T3ReplyFailureCode =
  | "not_provisioned"
  | "auth_expired"
  | "t3_unreachable"
  | "thread_missing"
  | "dispatch_rejected"
  | "t3_timeout";

export type T3ReplyResult =
  | { ok: true; sequence: number }
  // `ambiguous` = the dispatch POST may have been accepted (network/timeout at
  // or after the send), so T3 might still run the turn. The caller MUST keep
  // the phone-ack marker in that case, or the turn's UserPromptSubmit bills a
  // dynamic voice response.
  | { ok: false; code: T3ReplyFailureCode; ambiguous: boolean };

export interface T3ReplyAttachment {
  type: "image";
  name: string;
  mimeType: `image/${string}`;
  sizeBytes: number;
  dataUrl: string;
}

interface BearerCache {
  at: number;
  token: string | null;
  state: { present: boolean; expMs: number | null };
}

let bearerCache: BearerCache | null = null;
let lastExpiryWarningAt = 0;

function decodedExpiryMs(token: string): number | null {
  // T3's session token is `base64url(claims).base64url(sig)` (claims in
  // segment 0), but decode format-agnostically: scan every "."-segment for the
  // one that base64url-decodes to a JSON object carrying a numeric `exp`. This
  // survives both that 2-part shape and a standard 3-part JWT (payload in
  // segment 1) without guessing wrong and reading expiry as null forever.
  for (const segment of token.split(".")) {
    if (!segment) continue;
    try {
      const decoded = JSON.parse(Buffer.from(segment, "base64url").toString("utf-8")) as {
        exp?: unknown;
      };
      if (
        decoded &&
        typeof decoded === "object" &&
        typeof decoded.exp === "number" &&
        Number.isFinite(decoded.exp) &&
        decoded.exp > 0
      ) {
        // T3 currently signs millisecond timestamps; accepting standard JWT
        // seconds keeps local expiry checks fail-safe across an additive drift.
        return decoded.exp < 1_000_000_000_000 ? decoded.exp * 1000 : decoded.exp;
      }
    } catch {
      /* not this segment */
    }
  }
  return null;
}

function loadBearer(): BearerCache {
  const now = Date.now();
  if (bearerCache && now - bearerCache.at < BEARER_CACHE_MS) return bearerCache;

  let token: string | null = null;
  let present = false;
  let expMs: number | null = null;
  try {
    const stat = lstatSync(T3_BEARER_PATH);
    const ownerUid = typeof process.getuid === "function" ? process.getuid() : -1;
    if (!stat.isFile() || stat.uid !== ownerUid || (stat.mode & 0o777) !== 0o600) {
      throw new Error("unsafe bearer file");
    }
    const value = readFileSync(T3_BEARER_PATH, "utf-8").trim();
    if (!value || /\s/.test(value)) throw new Error("invalid bearer file");
    token = value;
    present = true;
    expMs = decodedExpiryMs(value);
  } catch {
    token = null;
  }

  bearerCache = { at: now, token, state: { present, expMs } };
  return bearerCache;
}

export function invalidateT3BearerCache(): void {
  bearerCache = null;
}

export function t3BearerState(): { present: boolean; expMs: number | null } {
  const state = loadBearer().state;
  return { ...state };
}

export function t3ReplyProvisioned(): boolean {
  const { present, expMs } = t3BearerState();
  return present && expMs !== null && expMs > Date.now();
}

/** Return a normalized origin only for an HTTP loopback IP literal. */
export function validateT3Origin(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "http:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const family = isIP(hostname);
    if (family === 4 && hostname.split(".")[0] === "127") return url.origin;
    if (family === 6 && hostname === "::1") return url.origin;
    return null;
  } catch {
    return null;
  }
}

function readT3Origin(): string | null {
  try {
    const runtime = JSON.parse(readFileSync(T3_RUNTIME_PATH, "utf-8")) as { origin?: unknown };
    return validateT3Origin(runtime.origin);
  } catch {
    return null;
  }
}

class ReplyFailure {
  constructor(
    readonly code: T3ReplyFailureCode,
    readonly retryable = false,
    // The dispatch POST may already have reached T3 (turn possibly running).
    readonly ambiguous = false,
  ) {}
}

function authFailure(response: Response): void {
  if (response.status === 401 || response.status === 403) {
    invalidateT3BearerCache();
    throw new ReplyFailure("auth_expired");
  }
}

async function request(url: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
  try {
    return await fetch(url, { ...init, redirect: "error", signal });
  } catch {
    if (signal.aborted) throw new ReplyFailure("t3_timeout");
    throw new ReplyFailure("t3_unreachable", true);
  }
}

async function responseJson(
  response: Response,
  signal: AbortSignal,
  invalidCode: T3ReplyFailureCode,
): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    if (signal.aborted) throw new ReplyFailure("t3_timeout");
    throw new ReplyFailure(invalidCode);
  }
}

function scopesFromSession(raw: unknown): string[] | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const session = raw as { authenticated?: unknown; scopes?: unknown; session?: unknown };
  if (session.authenticated !== true) return null;
  if (Array.isArray(session.scopes) && session.scopes.every((scope) => typeof scope === "string")) {
    return session.scopes;
  }
  if (session.session && typeof session.session === "object" && !Array.isArray(session.session)) {
    const scopes = (session.session as { scopes?: unknown }).scopes;
    if (Array.isArray(scopes) && scopes.every((scope) => typeof scope === "string")) return scopes;
  }
  return null;
}

async function sendAttempt(
  origin: string,
  token: string,
  threadId: string,
  text: string,
  attachments: readonly T3ReplyAttachment[],
  commandId: string,
  messageId: string,
  createdAt: string,
  signal: AbortSignal,
): Promise<{ ok: true; sequence: number }> {
  // Deliberately unauthenticated: a stale/malicious runtime descriptor never
  // gets a bearer until it has passed validation and answered the probe.
  const probe = await request(`${origin}/.well-known/t3/environment`, { method: "GET" }, signal);
  if (!probe.ok) throw new ReplyFailure("t3_unreachable", true);

  const auth = await request(
    `${origin}/api/auth/session`,
    { method: "GET", headers: { Authorization: `Bearer ${token}` } },
    signal,
  );
  authFailure(auth);
  if (!auth.ok) throw new ReplyFailure("t3_unreachable", auth.status >= 500);
  const authBody = await responseJson(auth, signal, "dispatch_rejected");
  const scopes = scopesFromSession(authBody);
  if (!scopes || REQUIRED_SCOPES.some((scope) => !scopes.includes(scope))) {
    throw new ReplyFailure("dispatch_rejected");
  }

  const detail = await request(
    `${origin}/api/orchestration/threads/${encodeURIComponent(threadId)}?turnLimit=1`,
    { method: "GET", headers: { Authorization: `Bearer ${token}` } },
    signal,
  );
  authFailure(detail);
  if (detail.status === 404) throw new ReplyFailure("thread_missing");
  if (!detail.ok) throw new ReplyFailure("t3_unreachable", detail.status >= 500);
  const detailBody = await responseJson(detail, signal, "thread_missing");
  const thread =
    detailBody && typeof detailBody === "object" && !Array.isArray(detailBody)
      ? (detailBody as { thread?: unknown }).thread
      : null;
  if (!thread || typeof thread !== "object" || Array.isArray(thread)) {
    throw new ReplyFailure("thread_missing");
  }
  const { runtimeMode, interactionMode } = thread as {
    runtimeMode?: unknown;
    interactionMode?: unknown;
  };
  if (typeof runtimeMode !== "string" || typeof interactionMode !== "string") {
    throw new ReplyFailure("thread_missing");
  }

  const command = {
    type: "thread.turn.start",
    commandId,
    threadId,
    message: { messageId, role: "user", text, attachments },
    runtimeMode,
    interactionMode,
    createdAt,
  };
  // From here the turn may actually start. A network/timeout failure sending
  // or reading the dispatch is AMBIGUOUS (T3 may have accepted it); only a
  // received rejection (non-2xx) definitively means the turn did not run.
  let dispatch: Response;
  try {
    dispatch = await fetch(
      `${origin}/api/orchestration/dispatch`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(command),
        redirect: "error",
        signal,
      },
    );
  } catch {
    throw new ReplyFailure(
      signal.aborted ? "t3_timeout" : "t3_unreachable",
      false,
      true, // ambiguous — POST may have landed
    );
  }
  authFailure(dispatch);
  if (!dispatch.ok) throw new ReplyFailure("dispatch_rejected"); // received rejection: not run
  let dispatchBody: unknown;
  try {
    dispatchBody = await dispatch.json();
  } catch {
    // 2xx with an unreadable body: the server likely accepted it → ambiguous.
    throw new ReplyFailure(signal.aborted ? "t3_timeout" : "dispatch_rejected", false, true);
  }
  const sequence =
    dispatchBody && typeof dispatchBody === "object" && !Array.isArray(dispatchBody)
      ? (dispatchBody as { sequence?: unknown }).sequence
      : null;
  if (typeof sequence !== "number" || !Number.isFinite(sequence)) {
    // 2xx but no sequence: unexpected shape from a server that answered OK —
    // treat as possibly-accepted rather than risk an unbilled double-send.
    throw new ReplyFailure("dispatch_rejected", false, true);
  }
  return { ok: true, sequence };
}

/** Send one user turn into the T3 thread. Never throws or exposes response text. */
export async function sendT3Reply(
  claudeSessionId: string,
  text: string,
  attachments: readonly T3ReplyAttachment[] = [],
): Promise<T3ReplyResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TOTAL_TIMEOUT_MS);
  timeout.unref?.();
  try {
    const bearer = loadBearer();
    if (!bearer.state.present || !bearer.token || bearer.state.expMs === null) {
      return { ok: false, code: "not_provisioned", ambiguous: false };
    }
    if (bearer.state.expMs <= Date.now()) {
      return { ok: false, code: "auth_expired", ambiguous: false };
    }
    if (
      bearer.state.expMs - Date.now() < EXPIRY_WARNING_MS &&
      Date.now() - lastExpiryWarningAt > EXPIRY_WARNING_RATE_MS
    ) {
      lastExpiryWarningAt = Date.now();
      log("t3-reply", "T3 reply bearer expires in under 3 days; re-run provisioning");
    }

    // All of these fail BEFORE any dispatch POST — never ambiguous.
    const threadId = t3ThreadIdForSession(claudeSessionId);
    if (!threadId) return { ok: false, code: "thread_missing", ambiguous: false };
    const origin = readT3Origin();
    if (!origin) return { ok: false, code: "t3_unreachable", ambiguous: false };
    if (controller.signal.aborted) return { ok: false, code: "t3_timeout", ambiguous: false };

    const commandId = `turn-start-${randomUUID()}`;
    const messageId = `message-${randomUUID()}`;
    const createdAt = new Date().toISOString();
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await sendAttempt(
          origin,
          bearer.token,
          threadId,
          text,
          attachments,
          commandId,
          messageId,
          createdAt,
          controller.signal,
        );
      } catch (failure) {
        if (failure instanceof ReplyFailure) {
          if (failure.retryable && attempt === 0 && !controller.signal.aborted) continue;
          return { ok: false, code: failure.code, ambiguous: failure.ambiguous };
        }
        // An unexpected throw after the dispatch phase can't be proven safe.
        return {
          ok: false,
          code: controller.signal.aborted ? "t3_timeout" : "t3_unreachable",
          ambiguous: true,
        };
      }
    }
    return { ok: false, code: "t3_unreachable", ambiguous: false };
  } finally {
    clearTimeout(timeout);
  }
}
