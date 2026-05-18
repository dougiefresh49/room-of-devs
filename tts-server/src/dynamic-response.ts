import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";
import { loadConfig } from "./config.js";
import { streamTTS } from "./elevenlabs.js";
import { playStreamBuffer, playMp3Buffer } from "./audio.js";
import { playRandomPhrase } from "./phrases.js";
import { log } from "./logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface CharacterProfile {
  name: string;
  franchise: string;
  media: string;
  voiceActor: string | null;
  personality: string;
  speechStyle: string;
  exampleResponses: string[];
}

let characters: Record<string, CharacterProfile> | null = null;

function loadCharacters(): Record<string, CharacterProfile> {
  if (characters) return characters;
  const p = join(__dirname, "characters.json");
  if (!existsSync(p)) return {};
  characters = JSON.parse(readFileSync(p, "utf-8"));
  return characters!;
}

function getCharacter(voiceId: string): CharacterProfile | null {
  return loadCharacters()[voiceId] ?? null;
}

async function generateCharacterResponse(
  userPrompt: string,
  character: CharacterProfile
): Promise<string | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;

  const config = loadConfig();
  const ai = new GoogleGenAI({ apiKey: key });

  const systemPrompt = `You are ${character.name} from ${character.franchise} (${character.media}).

Personality: ${character.personality}

Speech style: ${character.speechStyle}

Example responses for reference (do NOT copy these verbatim, use them to understand tone):
${character.exampleResponses.map((r) => `- "${r}"`).join("\n")}

The user just sent a message to their AI coding assistant. Generate a SHORT (1-2 sentences max) in-character acknowledgment. This is a "thinking/working on it" response — you're about to start working on their request.

Rules:
- Stay in character. Sound like ${character.name}, not a generic assistant.
- Match the TONE of the user's message. If they're excited, be excited back. If they're frustrated, acknowledge it in character. If it's casual, be casual.
- Keep it under 20 words. Shorter is better.
- No quotes, no stage directions, no parenthetical notes.
- Do NOT answer their question — just acknowledge you received it and are working on it.
- Output ONLY the spoken text, nothing else.`;

  try {
    const response = await ai.models.generateContent({
      model: config.gemini_model,
      contents: `User's message: "${userPrompt}"`,
      config: {
        systemInstruction: systemPrompt,
        temperature: 0.9,
        maxOutputTokens: 100,
      },
    });

    const text = response.text?.trim();
    if (!text) return null;

    log("dynamic", `${character.name} response: "${text}" (for: "${userPrompt.slice(0, 50)}")`);
    return text;
  } catch (err: any) {
    log("dynamic", `Gemini error: ${err.message}`);
    return null;
  }
}

export async function handleDynamicResponse(
  voiceId: string,
  userPrompt?: string
): Promise<boolean> {
  const character = getCharacter(voiceId);

  if (!character || !userPrompt?.trim()) {
    return playRandomPhrase(voiceId);
  }

  log("dynamic", `Generating ${character.name} response for prompt (${userPrompt.length} chars)`);

  const responseText = await generateCharacterResponse(userPrompt, character);

  if (!responseText) {
    log("dynamic", "Generation failed — falling back to cached phrase");
    return playRandomPhrase(voiceId);
  }

  const stream = await streamTTS(responseText, { voiceId });
  if (stream) {
    log("dynamic", `Streaming: "${responseText}"`);
    await playStreamBuffer(stream as any, "dynamic-response");
    return true;
  }

  log("dynamic", "Stream failed — falling back to cached phrase");
  return playRandomPhrase(voiceId);
}
