/**
 * Bounded timeout + at-most-one retry for paid API calls (P-3).
 * Retries only clearly-transient failures; never after a response started.
 */
import { log } from "./logger.js";

const GEMINI_TIMEOUT_MS = 60_000;
const ELEVENLABS_TIMEOUT_MS = 90_000;
const RETRY_BACKOFF_MS = 750;

function errorStatus(err: unknown): number | null {
  const status =
    (err as { status?: unknown })?.status ??
    (err as { statusCode?: unknown })?.statusCode;
  return typeof status === "number" ? status : null;
}

function isClientError(err: unknown): boolean {
  const status = errorStatus(err);
  if (status != null && status >= 400 && status < 500) return true;
  const msg = String((err as Error)?.message ?? err);
  return /\b(400|401|403|404|422)\b/.test(msg);
}

function isTransientError(err: unknown): boolean {
  if (isClientError(err)) return false;
  const status = errorStatus(err);
  if (status != null && status >= 500) return true;
  const name = (err as { name?: string })?.name ?? "";
  if (name === "TimeoutError" || name === "AbortError") return true;
  const msg = String((err as Error)?.message ?? err).toLowerCase();
  return (
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("aborted") ||
    msg.includes("abort") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("network") ||
    msg.includes("fetch failed") ||
    msg.includes("socket hang up")
  );
}

function timeoutError(label: string, timeoutMs: number): Error {
  const err = new Error(`${label} timed out after ${timeoutMs}ms`);
  (err as { isLocalTimeout?: boolean }).isLocalTimeout = true;
  return err;
}

async function raceTimeout<T>(
  label: string,
  timeoutMs: number,
  fn: () => Promise<T>
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(timeoutError(label, timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function withApiRetry<T>(
  label: string,
  timeoutMs: number,
  fn: () => Promise<T>,
  opts: { retryOnTimeout?: boolean } = {}
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await raceTimeout(label, timeoutMs, fn);
    } catch (err) {
      lastErr = err;
      // A local race-timeout doesn't abort the underlying request — for
      // ElevenLabs (no abort signal) the first request may still complete
      // and bill, so a retry there would double-bill.
      const localTimeout = (err as { isLocalTimeout?: boolean })?.isLocalTimeout === true;
      if (localTimeout && opts.retryOnTimeout === false) throw err;
      if (attempt > 0 || !isTransientError(err)) throw err;
      log(label, `Transient error, retrying once: ${(err as Error)?.message ?? err}`);
      await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS));
    }
  }
  throw lastErr;
}

export { GEMINI_TIMEOUT_MS, ELEVENLABS_TIMEOUT_MS };
