import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { loadConfig, loadSessionVoices } from "./config.js";
import { log } from "./logger.js";

let client: ElevenLabsClient | null = null;

function getClient(): ElevenLabsClient | null {
  if (client) return client;
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return null;
  client = new ElevenLabsClient({ apiKey: key });
  return client;
}

export interface TTSOptions {
  voiceId: string;
  modelId?: string;
  speed?: number;
  stability?: number;
  similarityBoost?: number;
  style?: number;
}

export async function streamTTS(
  text: string,
  opts: TTSOptions
): Promise<ReadableStream<Uint8Array> | null> {
  const el = getClient();
  if (!el) {
    log("elevenlabs", "No ELEVENLABS_API_KEY — skipping");
    return null;
  }

  const config = loadConfig();
  const modelId = opts.modelId ?? config.elevenlabs_model_id;
  const rawSpeed = opts.speed ?? config.default_speed;
  const elSpeed = Math.min(1.2, Math.max(0.7, rawSpeed));

  try {
    const response = await el.textToSpeech.stream(opts.voiceId, {
      text,
      modelId,
      outputFormat: "mp3_44100_128",
      voiceSettings: {
        stability: opts.stability ?? 0.4,
        similarityBoost: opts.similarityBoost ?? 0.75,
        style: opts.style ?? 0.15,
        speed: elSpeed,
      },
    });

    log(
      "elevenlabs",
      `Streaming: voice=${opts.voiceId}, model=${modelId}, speed=${rawSpeed}x (el=${elSpeed}), chars=${text.length}`
    );
    return response as any;
  } catch (err: any) {
    log("elevenlabs", `Stream error: ${err.message || err}`);
    return null;
  }
}

// --- Word-level timestamps (karaoke captions) ---------------------------

export interface WordTiming {
  word: string;
  startMs: number;
  endMs: number;
}

interface CharTiming {
  char: string;
  startMs: number;
  endMs: number;
}

// Group per-character timings into whitespace-delimited words, keeping
// punctuation attached so the rendered caption matches the spoken text.
function groupCharsIntoWords(chars: CharTiming[]): WordTiming[] {
  const words: WordTiming[] = [];
  let buf = "";
  let start = 0;
  let end = 0;
  for (const c of chars) {
    if (/\s/.test(c.char)) {
      if (buf) {
        words.push({ word: buf, startMs: start, endMs: end });
        buf = "";
      }
      continue;
    }
    if (!buf) start = c.startMs;
    buf += c.char;
    end = c.endMs;
  }
  if (buf) words.push({ word: buf, startMs: start, endMs: end });
  return words;
}

export interface TimestampedTTS {
  // Audio chunks decoded from each base64 JSON frame — pipe exactly like a
  // plain stream. Consuming this generator is what populates the alignment.
  audio: AsyncGenerator<Uint8Array>;
  // Word timings accumulated so far; call after (or during) audio consumption.
  getWords: () => WordTiming[];
}

// Streaming with-timestamps: same audio + billing as streamTTS, plus free
// character-level alignment metadata. Returns null when the SDK/endpoint call
// fails so the caller can fall back to plain streamTTS. Mid-stream failures
// throw out of the generator (handled by the audio pipe's try/catch).
export async function streamTTSWithTimestamps(
  text: string,
  opts: TTSOptions
): Promise<TimestampedTTS | null> {
  const el = getClient();
  if (!el) {
    log("elevenlabs", "No ELEVENLABS_API_KEY — skipping (timestamps)");
    return null;
  }

  const config = loadConfig();
  const modelId = opts.modelId ?? config.elevenlabs_model_id;
  const rawSpeed = opts.speed ?? config.default_speed;
  const elSpeed = Math.min(1.2, Math.max(0.7, rawSpeed));

  let stream: AsyncIterable<{
    audioBase64?: string;
    alignment?: {
      characters?: string[];
      characterStartTimesSeconds?: number[];
      characterEndTimesSeconds?: number[];
    } | null;
    normalizedAlignment?: {
      characters?: string[];
      characterStartTimesSeconds?: number[];
      characterEndTimesSeconds?: number[];
    } | null;
  }>;
  try {
    stream = (await el.textToSpeech.streamWithTimestamps(opts.voiceId, {
      text,
      modelId,
      outputFormat: "mp3_44100_128",
      voiceSettings: {
        stability: opts.stability ?? 0.4,
        similarityBoost: opts.similarityBoost ?? 0.75,
        style: opts.style ?? 0.15,
        speed: elSpeed,
      },
    })) as any;
  } catch (err: any) {
    log("elevenlabs", `Timestamps stream error (will fall back): ${err.message || err}`);
    return null;
  }

  log(
    "elevenlabs",
    `Streaming+timestamps: voice=${opts.voiceId}, model=${modelId}, speed=${rawSpeed}x (el=${elSpeed}), chars=${text.length}`
  );

  const chars: CharTiming[] = [];
  // Each chunk's alignment times are treated as absolute from utterance start;
  // if a chunk's times reset toward zero (per-chunk mode), we roll a running
  // offset forward so accumulated timings stay monotonic either way.
  let offsetSec = 0;
  let lastAbsEnd = 0;

  async function* gen(): AsyncGenerator<Uint8Array> {
    for await (const chunk of stream) {
      const a = chunk.alignment ?? chunk.normalizedAlignment;
      if (a) {
        const cs = a.characters ?? [];
        const st = a.characterStartTimesSeconds ?? [];
        const en = a.characterEndTimesSeconds ?? [];
        if (st.length && (st[0] ?? 0) + 1e-6 < lastAbsEnd - 0.05) {
          offsetSec = lastAbsEnd;
        }
        for (let i = 0; i < cs.length; i++) {
          const s = (st[i] ?? 0) + offsetSec;
          const e = (en[i] ?? st[i] ?? 0) + offsetSec;
          chars.push({
            char: cs[i] ?? "",
            startMs: Math.round(s * 1000),
            endMs: Math.round(e * 1000),
          });
          if (e > lastAbsEnd) lastAbsEnd = e;
        }
      }
      if (chunk.audioBase64) {
        yield new Uint8Array(Buffer.from(chunk.audioBase64, "base64"));
      }
    }
  }

  return { audio: gen(), getWords: () => groupCharsIntoWords(chars) };
}

export async function generateTTS(
  text: string,
  opts: TTSOptions
): Promise<Buffer | null> {
  const el = getClient();
  if (!el) {
    log("elevenlabs", "No ELEVENLABS_API_KEY — skipping");
    return null;
  }

  const config = loadConfig();
  const modelId = opts.modelId ?? config.elevenlabs_model_id;
  const rawSpeed = opts.speed ?? config.default_speed;
  const elSpeed = Math.min(1.2, Math.max(0.7, rawSpeed));

  try {
    const audio = await el.textToSpeech.convert(opts.voiceId, {
      text,
      modelId,
      outputFormat: "mp3_44100_128",
      voiceSettings: {
        stability: opts.stability ?? 0.4,
        similarityBoost: opts.similarityBoost ?? 0.75,
        style: opts.style ?? 0.15,
        speed: elSpeed,
      },
    });

    const chunks: Uint8Array[] = [];
    for await (const chunk of audio as any) {
      chunks.push(chunk);
    }
    const buf = Buffer.concat(chunks);
    log(
      "elevenlabs",
      `Generated: voice=${opts.voiceId}, chars=${text.length}, bytes=${buf.length}`
    );
    return buf;
  } catch (err: any) {
    log("elevenlabs", `Generate error: ${err.message || err}`);
    return null;
  }
}

export function resolveVoiceId(sessionId?: string): string {
  const config = loadConfig();
  if (sessionId) {
    const sessionVoices = loadSessionVoices();
    if (sessionVoices[sessionId]) return sessionVoices[sessionId];
  }
  return config.elevenlabs_voice_id;
}

export async function fetchCredits(): Promise<{
  tier: string;
  characterCount: number;
  characterLimit: number;
  nextReset: string;
} | null> {
  const el = getClient();
  if (!el) return null;

  try {
    const sub = await el.user.subscription.get();
    return {
      tier: (sub as any).tier ?? "unknown",
      characterCount: (sub as any).character_count ?? 0,
      characterLimit: (sub as any).character_limit ?? 0,
      nextReset: (sub as any).next_character_count_reset_unix
        ? new Date(
            (sub as any).next_character_count_reset_unix * 1000
          ).toISOString()
        : "",
    };
  } catch (err: any) {
    log("elevenlabs", `Credits error: ${err.message || err}`);
    return null;
  }
}
