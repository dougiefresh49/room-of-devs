/**
 * Chat-thread data + the play-chip replay match.
 *
 * `useThread` fetches `GET /thread/<sessionId>` on open and refetches whenever
 * `rev` changes — `rev` is convo-state's `threadRev`, bumped on each new
 * NON-live (final) SSE frame for the open session. `/thread` is the SINGLE
 * source of history (spec §A1); nothing is spliced client-side, so there is no
 * dedup problem. The fetch is abortable and generation-guarded so a stale
 * response can never overwrite a newer thread.
 */
import { useEffect, useRef, useState } from "react";
import { fetchThread, type ReplayEntry, type ThreadItem } from "./api.js";

function normalizeWs(s: string): string {
  return String(s || "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface ThreadData {
  items: ThreadItem[];
  loading: boolean;
}

export function useThread(sessionId: string | null, rev: number): ThreadData {
  const [items, setItems] = useState<ThreadItem[]>([]);
  const [loading, setLoading] = useState(false);
  const gen = useRef(0);

  useEffect(() => {
    if (!sessionId) {
      setItems([]);
      setLoading(false);
      return;
    }
    const mine = ++gen.current;
    const ctrl = new AbortController();
    setLoading(true);
    void fetchThread(sessionId, ctrl.signal)
      .then((next) => {
        if (mine !== gen.current) return;
        setItems(next);
        setLoading(false);
      })
      .catch(() => {
        // Endpoint may 404 (no transcript yet) or the fetch was aborted — keep
        // the prior items rather than flashing empty.
        if (mine !== gen.current) return;
        setLoading(false);
      });
    return () => ctrl.abort();
    // rev is intentionally a dependency: a new final frame refetches history.
  }, [sessionId, rev]);

  return { items, loading };
}

/**
 * The replay clip backing a play chip on an agent FINAL bubble (spec §B1
 * matching contract): the newest replay entry with the same sessionId whose
 * `rawText` starts with the thread item's first 200 chars (normalized
 * whitespace). Repeated identical messages may mis-attach — accepted for a
 * personal tool (the clip content is identical anyway).
 *
 * NOTE the ordering flip from legacy: `GET /replay-list` returns NEWEST-FIRST
 * (mobile.html's `allReplayList` was chrono-ascending), so we take the FIRST
 * match, not the last.
 */
export function findReplayForFinal(
  replays: readonly ReplayEntry[],
  sessionId: string,
  text: string,
): ReplayEntry | null {
  const prefix = normalizeWs(text).slice(0, 200);
  if (!prefix) return null;
  for (const e of replays) {
    if (e.sessionId !== sessionId || e.kind === "ack" || e.kind === "live" || !e.file) continue;
    if (normalizeWs(e.rawText || "").startsWith(prefix)) return e; // newest-first ⇒ first match
  }
  return null;
}

/** The last FINAL agent text in a thread (call-view idle/pending fallback). */
export function lastFinalText(items: readonly ThreadItem[]): string {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.role === "agent" && it.final) return it.text || "";
  }
  return "";
}

/**
 * The last FINAL agent text that landed at/after `since` (ms) — the call view
 * uses this so a FRESH call never renders an OLD, pre-call final as its content
 * (phone-review bug 3). Returns "" when `since` is null (go-live optimism) or
 * no in-call final exists yet, so the card falls back to working/idle.
 */
export function lastFinalTextSince(items: readonly ThreadItem[], since: number | null): string {
  if (since == null) return "";
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.role !== "agent" || !it.final) continue;
    const at = it.at ? Date.parse(it.at) : NaN;
    if (Number.isFinite(at) && at >= since) return it.text || "";
    // Older finals (and finals with no timestamp) don't count for this call.
  }
  return "";
}
