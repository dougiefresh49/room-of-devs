import { existsSync, readFileSync, appendFileSync, unlinkSync } from "fs";
import { join } from "path";
import { spawnSync } from "child_process";
import { TTS_DIR, STATE_DIR } from "./config.js";
import { acquireLock, releaseLock } from "./audio.js";
import { log } from "./logger.js";

// Deferred-announce ledger: sessionIds that raised a hand while the floor was
// busy (written one-per-line by scripts/announce.sh and handleAskUser). Fired
// once, by name, the moment the floor is truly free — a helpful nudge, never a nag.
const PENDING_ANNOUNCE = join(TTS_DIR, ".pending-announce");

// Record a session for the deferred-announce nudge (dedup by line). Used by the
// in-process announce/ask-user paths when the floor is busy at hand-raise time.
export function deferAnnounce(sessionId: string): void {
  if (!sessionId) return;
  try {
    const existing = existsSync(PENDING_ANNOUNCE)
      ? readFileSync(PENDING_ANNOUNCE, "utf-8")
      : "";
    const lines = new Set(
      existing.split("\n").map((l) => l.trim()).filter(Boolean)
    );
    if (lines.has(sessionId)) return;
    appendFileSync(PENDING_ANNOUNCE, `${sessionId}\n`);
  } catch (err: any) {
    log("announce", `deferAnnounce failed: ${err.message}`);
  }
}

// A deferred hand still counts only if the session is *currently* hand_raised.
// A hand you granted or cleared in the meantime drops out silently.
function handRaisedName(sessionId: string): string | null {
  try {
    const p = join(STATE_DIR, `${sessionId}.json`);
    if (!existsSync(p)) return null;
    const s = JSON.parse(readFileSync(p, "utf-8")) as {
      state?: string;
      name?: string;
    };
    if (s.state !== "hand_raised") return null;
    return s.name || sessionId.slice(0, 12);
  } catch {
    return null;
  }
}

const NUMBER_WORDS = [
  "Zero",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
];

function countWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

// "A" / "A and B" / "A, B, and C"
function joinNames(names: string[]): string {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

// Fire any deferred announce, but only when the floor is truly free. Reads the
// ledger, validates each sessionId against live hand_raised state, consumes the
// file, and speaks *only the still-raised names* via free local `say`. Called
// from the one settle point after playback (daemon drain end + `once` path) so
// it covers auto, grant, and manual plays alike.
export function maybeFireDeferredAnnounce(): void {
  try {
    if (!existsSync(PENDING_ANNOUNCE)) return;

    // Take the stream lock try-once BEFORE consuming the ledger. If the floor is
    // busy, leave the file intact and return — the next settle point retries.
    // Holding the lock across `say` keeps a grant/auto-play from talking over the
    // nudge, and only unlinking after acquiring means a lost race never drops it.
    if (!acquireLock()) return;
    try {
      const raw = readFileSync(PENDING_ANNOUNCE, "utf-8");
      const ids = [
        ...new Set(
          raw
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean)
        ),
      ];

      // Consume the ledger — a deferred announce is a one-shot nudge; hands still
      // up but not in the file were left up on purpose.
      try {
        unlinkSync(PENDING_ANNOUNCE);
      } catch {}

      const names: string[] = [];
      for (const id of ids) {
        const n = handRaisedName(id);
        if (n) names.push(n);
      }
      if (names.length === 0) return; // all granted/cleared in the meantime

      const phrase =
        names.length === 1
          ? `One hand up: ${names[0]}.`
          : `${countWord(names.length)} hands up: ${joinNames(names)}.`;
      log("announce", `Deferred announce: ${phrase}`);
      spawnSync("say", [phrase], { stdio: "ignore" });
    } finally {
      releaseLock();
    }
  } catch (err: any) {
    log("announce", `maybeFireDeferredAnnounce failed: ${err.message}`);
  }
}
