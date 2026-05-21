import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";
import { loadConfig } from "./config.js";
import { streamTTS } from "./elevenlabs.js";
import { playStreamBuffer, playMp3Buffer, type ReplayMeta } from "./audio.js";
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

export function getCharacter(voiceId: string): CharacterProfile | null {
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
  userPrompt?: string,
  sessionId?: string,
  sessionName?: string
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

  const meta: ReplayMeta = {
    source: "dynamic-response",
    sessionId,
    sessionName,
    character: character.name,
    textPreview: responseText.slice(0, 120),
    timestamp: new Date().toISOString(),
  };

  const stream = await streamTTS(responseText, { voiceId });
  if (stream) {
    log("dynamic", `Streaming: "${responseText}"`);
    await playStreamBuffer(stream as any, "dynamic-response", meta);
    return true;
  }

  log("dynamic", "Stream failed — falling back to cached phrase");
  return playRandomPhrase(voiceId);
}

export async function handleAskUser(
  voiceId: string,
  questionText: string,
  sessionId?: string,
  sessionName?: string
): Promise<boolean> {
  if (!questionText?.trim()) return false;

  const character = getCharacter(voiceId);
  const key = process.env.GEMINI_API_KEY;

  const meta: ReplayMeta = {
    source: "ask-user",
    sessionId,
    sessionName,
    character: character?.name,
    textPreview: questionText.slice(0, 120),
    timestamp: new Date().toISOString(),
  };

  if (!key) {
    log("dynamic", "No GEMINI_API_KEY for ask-user — streaming raw question");
    return streamAndPlay(voiceId, questionText, meta);
  }

  const config = loadConfig();
  const ai = new GoogleGenAI({ apiKey: key });

  const charContext = character
    ? `You are ${character.name} from ${character.franchise}. Personality: ${character.personality}. Speech style: ${character.speechStyle}.`
    : "You are a helpful coding assistant.";

  const systemPrompt = `${charContext}

Your AI coding assistant just asked the developer a question with multiple choices. Read the question and options aloud naturally, as if YOU are the one asking. Stay in character.

Rules:
- Paraphrase the question naturally — don't read it verbatim like a robot.
- List the options briefly (just the label and a few words of context).
- Keep it concise — under 40 words total.
- No quotes, no stage directions, no markdown.
- Output ONLY the spoken text.`;

  try {
    const response = await ai.models.generateContent({
      model: config.gemini_model,
      contents: `Question and options: "${questionText}"`,
      config: {
        systemInstruction: systemPrompt,
        temperature: 0.7,
        maxOutputTokens: 150,
      },
    });

    const text = response.text?.trim();
    if (!text) return streamAndPlay(voiceId, questionText, meta);

    meta.textPreview = text.slice(0, 120);
    log("dynamic", `Ask-user response: "${text}"`);
    return streamAndPlay(voiceId, text, meta);
  } catch (err: any) {
    log("dynamic", `Ask-user Gemini error: ${err.message}`);
    return streamAndPlay(voiceId, questionText, meta);
  }
}

async function streamAndPlay(
  voiceId: string,
  text: string,
  meta?: ReplayMeta
): Promise<boolean> {
  const stream = await streamTTS(text, { voiceId });
  if (stream) {
    await playStreamBuffer(stream as any, "ask-user-response", meta);
    return true;
  }
  return false;
}
