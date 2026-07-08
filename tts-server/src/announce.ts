import { existsSync, readFileSync, readdirSync, unlinkSync } from "fs";
import { join } from "path";
import { spawnSync } from "child_process";
import { TTS_DIR, STREAM_LOCK, STATE_DIR } from "./config.js";
import { log } from "./logger.js";

// Deferred-announce ledger: sessionIds that raised a hand while the floor was
// busy (written one-per-line by scripts/announce.sh). Fired once, by name, the
// moment the floor is truly free — a helpful nudge, never a nag.
const PENDING_ANNOUNCE = join(TTS_DIR, ".pending-announce");

// The floor is free when the stream lock is absent or held by a dead pid.
// Mirrors audio.ts acquireLock liveness — but read-only, never steals.
function lockFree(): boolean {
  if (!existsSync(STREAM_LOCK)) return true;
  try {
    const pid = Number(readFileSync(STREAM_LOCK, "utf-8").trim());
    process.kill(pid, 0);
    return false; // live holder — someone is still speaking / mid-grant
  } catch {
    return true; // stale marker
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
    if (!lockFree()) return; // mid-play / mid-grant — not "free", try again later

    const raw = readFileSync(PENDING_ANNOUNCE, "utf-8");
    const ids = [
      ...new Set(
        raw
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
      ),
    ];

    // Consume the ledger unconditionally — a deferred announce is a one-shot
    // nudge; hands still up but not in the file were left up on purpose.
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
  } catch (err: any) {
    log("announce", `maybeFireDeferredAnnounce failed: ${err.message}`);
  }
}
