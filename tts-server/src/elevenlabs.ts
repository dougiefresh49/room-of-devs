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
