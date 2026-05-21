import { GoogleGenAI } from "@google/genai";
import { log } from "./logger.js";

const BASE_SYSTEM_PROMPT = `You convert AI agent markdown responses into natural spoken text for ElevenLabs v3 TTS.

Rules:
1. REMOVE all code blocks, shell commands, import statements, and raw code. Never read code aloud.
2. REMOVE file paths and convert them to natural references. Instead of "src/components/Button.tsx", say "the Button component". Instead of "package.json", say "the package dot json".
3. REMOVE markdown formatting (headers, bullets, bold, links, images, tables).
4. CONVERT technical jargon into conversational speech. "Refactored the useAuth hook" → "I refactored the use auth hook".
5. ADD ElevenLabs v3 audio tags where natural:
   - [sighs] before delivering bad news or acknowledging difficulty
   - [excited] or [enthusiastic] for positive completions
   - Use CAPS for emphasis on key words: "This is REALLY important"
   - Use ellipses (...) for natural pauses and thinking moments
   - [whispers] for asides or caveats
   - [laughs] only if genuinely funny or self-deprecating
6. Keep the MEANING exactly — do not add information or change what was communicated.
7. Abbreviations: spell out uncommon ones, keep common ones (API, CSS, HTML, JSON, URL, SQL, CLI, npm, git).
8. Numbers: spell out small numbers (one through twelve), use words for large round numbers ("about two hundred").
9. Punctuation: use periods and commas for natural speech rhythm. Use question marks for rhetorical questions.
10. Keep it concise. If the original is very long, summarize the key points naturally. Aim for under 4000 characters.
11. Start directly with the content — no "Here's what happened" or "So basically" preamble.
12. For lists of changes/files, summarize the theme rather than reading each item: "I updated several components" not a list of every file.

Output ONLY the processed speech text. No explanations, no quotes, no surrounding markdown.`;

export interface CharacterContext {
  name: string;
  personality: string;
  speechStyle: string;
}

function buildSystemPrompt(character?: CharacterContext | null): string {
  if (!character) {
    return BASE_SYSTEM_PROMPT + `\n\nRead it like a dev friend summarizing what the agent did.`;
  }

  return BASE_SYSTEM_PROMPT + `\n\nYou are rewriting this as ${character.name}. Stay in character throughout.

Personality: ${character.personality}
Speech style: ${character.speechStyle}

Rewrite the agent's response as if ${character.name} is the one reporting back to the developer. Use ${character.name}'s vocabulary, tone, and mannerisms naturally. Do NOT add catchphrases on every line — use them sparingly. The character should sound natural, not like a parody.`;
}

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI | null {
  if (client) return client;
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  client = new GoogleGenAI({ apiKey: key });
  return client;
}

export async function processWithGemini(
  text: string,
  model = "gemini-3.1-flash-lite",
  character?: CharacterContext | null
): Promise<string | null> {
  const ai = getClient();
  if (!ai) {
    log("gemini", "No GEMINI_API_KEY — skipping");
    return null;
  }

  try {
    const systemPrompt = buildSystemPrompt(character);
    const response = await ai.models.generateContent({
      model,
      contents: text,
      config: {
        systemInstruction: systemPrompt,
        temperature: character ? 0.5 : 0.3,
        maxOutputTokens: 4096,
      },
    });

    const result = response.text?.trim();
    if (!result) {
      log("gemini", "Empty response");
      return null;
    }

    log("gemini", `Processed: ${text.length} chars → ${result.length} chars`);
    return result;
  } catch (err: any) {
    log("gemini", `Error: ${err.message || err}`);
    return null;
  }
}

export function fallbackClean(text: string): string {
  let cleaned = text;
  cleaned = cleaned.replace(/```[\s\S]*?```/g, "");
  cleaned = cleaned.replace(/^#{1,6}\s+/gm, "");
  cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, "$1");
  cleaned = cleaned.replace(/`([^`]+)`/g, "$1");
  cleaned = cleaned.replace(/!\[.*?\]\(.*?\)/g, "");
  cleaned = cleaned.replace(/\[([^\]]+)\]\(.*?\)/g, "$1");
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");
  return cleaned.trim();
}
