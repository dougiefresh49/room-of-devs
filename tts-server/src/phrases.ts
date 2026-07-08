import { existsSync, mkdirSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";
import { pathToFileURL } from "url";
import { PHRASES_DIR, loadConfig } from "./config.js";
import { generateTTS } from "./elevenlabs.js";
import { playMp3Buffer, acquireLock, releaseLock, type PlaybackContext } from "./audio.js";
import { log } from "./logger.js";
import { readFileSync } from "fs";

const DEFAULT_PHRASES = [
  "Let me take a look.",
  "Hmm, one moment...",
  "On it!",
  "Let me check that for you.",
  "Looking into this now...",
  "Alright, let me dig into this.",
  "Give me just a second...",
  "Let me think about that...",
];

export type PhraseKind = "ack" | "announce" | "question";

const PHRASE_SETS: Record<PhraseKind, readonly string[]> = {
  ack: DEFAULT_PHRASES,
  announce: [
    "Yo, I got an update!",
    "Got something for you when you're ready.",
    "Update's ready over here.",
    "I've got news whenever you want it.",
    "Done with a chunk — say the word.",
  ],
  question: [
    "Yo, I've got a question when you're ready.",
    "Quick question for you, boss.",
    "Need your input on something.",
    "Got a decision for you to make.",
  ],
};

function filePrefix(kind: PhraseKind): string {
  return kind === "ack" ? "phrase_" : `${kind}_`;
}

function voiceDir(voiceId: string): string {
  return join(PHRASES_DIR, voiceId);
}

export function getPhrasesForVoice(voiceId: string, kind: PhraseKind = "ack"): string[] {
  const dir = voiceDir(voiceId);
  if (!existsSync(dir)) return [];
  const prefix = filePrefix(kind);
  return readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && f.endsWith(".mp3"))
    .map((f) => join(dir, f));
}

export async function generatePhrases(
  voiceId: string,
  kind: PhraseKind = "ack",
): Promise<number> {
  const phrases = PHRASE_SETS[kind];
  const dir = voiceDir(voiceId);
  mkdirSync(dir, { recursive: true });

  const existing = getPhrasesForVoice(voiceId, kind);
  if (existing.length >= phrases.length) {
    log("phrases", `Voice ${voiceId} already has ${existing.length} ${kind} phrases`);
    return existing.length;
  }

  let generated = 0;
  for (let i = 0; i < phrases.length; i++) {
    const outPath = join(dir, `${filePrefix(kind)}${i}.mp3`);
    if (existsSync(outPath)) continue;

    const buf = await generateTTS(phrases[i], {
      voiceId,
      // Generate at 1.0x — cached phrases are reused across speed changes;
      // playMp3Buffer applies the current default_speed at playback time.
      speed: 1.0,
      stability: 0.5,
      similarityBoost: 0.8,
      style: 0.1,
    });
    if (buf) {
      writeFileSync(outPath, buf);
      generated++;
      log("phrases", `Generated ${kind} phrase ${i}: "${phrases[i]}"`);
    }
  }

  log("phrases", `Generated ${generated} new ${kind} phrases for ${voiceId}`);
  return generated;
}

// Phrases are room-level "meta" by default (announce chimes, SFX fallbacks);
// callers using a phrase AS a session-bound ack pass their session context.
export async function playRandomPhrase(
  voiceId: string,
  kind: PhraseKind = "ack",
  ctx: PlaybackContext = "meta"
): Promise<boolean> {
  const files = getPhrasesForVoice(voiceId, kind);
  if (files.length === 0) {
    log("phrases", `No ${kind} phrases cached for ${voiceId}`);
    return false;
  }

  const pick = files[Math.floor(Math.random() * files.length)];
  log("phrases", `Playing: ${pick}`);
  const buf = readFileSync(pick);
  await playMp3Buffer(buf, ctx);
  return true;
}

const PHRASE_KINDS: PhraseKind[] = ["ack", "announce", "question"];

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { loadEnv } = await import("./config.js");
  loadEnv();
  const config = loadConfig();

  // `play <voiceId> <kind>` — playback only (no generation, no credits).
  // announce.sh shells to this to sound a cached chime as room-level meta audio.
  if (process.argv[2] === "play") {
    const voiceId = process.argv[3] || config.elevenlabs_voice_id;
    const kind = (process.argv[4] as PhraseKind) || "announce";
    if (!voiceId || !PHRASE_KINDS.includes(kind)) {
      console.error("Usage: tsx src/phrases.ts play <voiceId> <ack|announce|question>");
      process.exit(1);
    }
    // Hold the stream lock across playback so a chime can't talk over a grant or
    // auto-play that starts at the same instant. Try once (never wait — a chime
    // is disposable); exit 2 signals the caller the floor was busy so it can
    // defer the hand instead of playing. Release before exit (process.exit skips
    // the finally otherwise).
    if (!acquireLock()) process.exit(2);
    let played = false;
    try {
      played = await playRandomPhrase(voiceId, kind, "meta");
    } finally {
      releaseLock();
    }
    process.exit(played ? 0 : 1);
  }

  const voiceId = process.argv[2] || config.elevenlabs_voice_id;
  const kind = (process.argv[3] as PhraseKind) || "ack";
  if (!voiceId) {
    console.error("Usage: tsx src/phrases.ts [voiceId] [ack|announce|question]");
    process.exit(1);
  }
  if (!PHRASE_KINDS.includes(kind)) {
    console.error(`Invalid kind "${kind}". Use ack, announce, or question.`);
    process.exit(1);
  }
  console.log(`Generating ${kind} phrases for voice: ${voiceId}`);
  const count = await generatePhrases(voiceId, kind);
  console.log(`Done. ${count} ${kind} phrases ready.`);
}
