import { existsSync, mkdirSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";
import { PHRASES_DIR, loadConfig } from "./config.js";
import { generateTTS } from "./elevenlabs.js";
import { playMp3Buffer } from "./audio.js";
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

function voiceDir(voiceId: string): string {
  return join(PHRASES_DIR, voiceId);
}

export function getPhrasesForVoice(voiceId: string): string[] {
  const dir = voiceDir(voiceId);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".mp3"))
    .map((f) => join(dir, f));
}

export async function generatePhrases(voiceId: string): Promise<number> {
  const dir = voiceDir(voiceId);
  mkdirSync(dir, { recursive: true });

  const existing = getPhrasesForVoice(voiceId);
  if (existing.length >= DEFAULT_PHRASES.length) {
    log("phrases", `Voice ${voiceId} already has ${existing.length} phrases`);
    return existing.length;
  }

  let generated = 0;
  for (let i = 0; i < DEFAULT_PHRASES.length; i++) {
    const outPath = join(dir, `phrase_${i}.mp3`);
    if (existsSync(outPath)) continue;

    const buf = await generateTTS(DEFAULT_PHRASES[i], {
      voiceId,
      stability: 0.5,
      similarityBoost: 0.8,
      style: 0.1,
    });
    if (buf) {
      writeFileSync(outPath, buf);
      generated++;
      log("phrases", `Generated phrase ${i}: "${DEFAULT_PHRASES[i]}"`);
    }
  }

  log("phrases", `Generated ${generated} new phrases for ${voiceId}`);
  return generated;
}

export async function playRandomPhrase(voiceId: string): Promise<boolean> {
  const files = getPhrasesForVoice(voiceId);
  if (files.length === 0) {
    log("phrases", `No phrases cached for ${voiceId}`);
    return false;
  }

  const pick = files[Math.floor(Math.random() * files.length)];
  log("phrases", `Playing: ${pick}`);
  const buf = readFileSync(pick);
  await playMp3Buffer(buf);
  return true;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { loadEnv } = await import("./config.js");
  loadEnv();
  const config = loadConfig();
  const voiceId = process.argv[2] || config.elevenlabs_voice_id;
  if (!voiceId) {
    console.error("Usage: tsx src/phrases.ts [voiceId]");
    process.exit(1);
  }
  console.log(`Generating phrases for voice: ${voiceId}`);
  const count = await generatePhrases(voiceId);
  console.log(`Done. ${count} phrases ready.`);
}
