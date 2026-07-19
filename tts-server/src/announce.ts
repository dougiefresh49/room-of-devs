import { existsSync, readFileSync, appendFileSync, unlinkSync } from "fs";
import { join } from "path";
import { pathToFileURL } from "url";
import { TTS_DIR, STATE_DIR } from "./config.js";
import { acquireLock, releaseLock } from "./audio.js";
import { resolveVoiceId } from "./elevenlabs.js";
import { playRandomPhrase } from "./phrases.js";
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
function handRaisedEntry(
  sessionId: string
): { sessionId: string; name: string } | null {
  try {
    const p = join(STATE_DIR, `${sessionId}.json`);
    if (!existsSync(p)) return null;
    const s = JSON.parse(readFileSync(p, "utf-8")) as {
      state?: string;
      name?: string;
    };
    if (s.state !== "hand_raised") return null;
    return { sessionId, name: s.name || sessionId.slice(0, 12) };
  } catch {
    return null;
  }
}

// Fire any deferred announce, but only when the floor is truly free. Reads the
// ledger, validates each sessionId against live hand_raised state, consumes the
// file, and plays a cached announce chime per distinct voice (in-process —
// caller/this function holds the stream lock; never re-acquire via the phrases
// CLI). No cached phrase → silent. Called from the settle points after playback
// (daemon drain end + `once` path) so it covers auto, grant, and manual plays.
export async function maybeFireDeferredAnnounce(): Promise<void> {
  try {
    if (!existsSync(PENDING_ANNOUNCE)) return;

    // Take the stream lock try-once BEFORE consuming the ledger. If the floor is
    // busy, leave the file intact and return — the next settle point retries.
    // Holding the lock across playback keeps a grant/auto-play from talking over
    // the nudge, and only unlinking after acquiring means a lost race never drops it.
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

      const raised: { sessionId: string; name: string }[] = [];
      for (const id of ids) {
        const entry = handRaisedEntry(id);
        if (entry) raised.push(entry);
      }
      if (raised.length === 0) return; // all granted/cleared in the meantime

      // One chime per distinct voice (in practice usually one). playRandomPhrase
      // does not acquire the lock — we already hold it.
      const seenVoices = new Set<string>();
      for (const { sessionId, name } of raised) {
        const voiceId = resolveVoiceId(sessionId);
        if (!voiceId || seenVoices.has(voiceId)) continue;
        seenVoices.add(voiceId);

        log("announce", `Deferred announce: chime for ${name} (voice=${voiceId})`);
        const played = await playRandomPhrase(voiceId, "announce", "meta");
        if (!played) {
          log("announce", `No announce phrases cached for ${voiceId} — silent`);
        }
      }
    } finally {
      releaseLock();
    }
  } catch (err: any) {
    log("announce", `maybeFireDeferredAnnounce failed: ${err.message}`);
  }
}

// CLI: `tsx src/announce.ts fire` — fire any deferred hands-up nudge now. Used
// by hold_room.sh on release so hands raised during a hold announce on lift.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === "fire") {
    await maybeFireDeferredAnnounce();
  } else {
    console.error("Usage: tsx src/announce.ts fire");
    process.exit(1);
  }
}
