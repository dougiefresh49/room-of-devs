import { readFileSync, existsSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";
import { loadConfig, effectivePlaybackMode, QUEUE_DIR } from "./config.js";
import { streamTTS } from "./elevenlabs.js";
import {
  playStreamBuffer,
  acquireLock,
  waitForLock,
  releaseLock,
  type ReplayMeta,
  type PlaybackContext,
} from "./audio.js";
import { playRandomPhrase } from "./phrases.js";
import { setSessionState } from "./state.js";
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
  // dynamic_responses governs prompt acks only:
  // "always" = fresh Gemini ack, "cached" = free cached phrase, "off" = silent.
  const mode = loadConfig().dynamic_responses;
  if (mode === "off") {
    log("dynamic", "dynamic_responses=off — skipping prompt ack");
    return false;
  }

  // Acks are disposable: try the lock ONCE (before any Gemini call) and
  // skip entirely if playback is in progress — cheap, and doesn't talk over.
  if (!acquireLock()) {
    log("dynamic", "Playback in progress — skipping prompt ack");
    return false;
  }

  // The ack is attributed to the submitting session (dynamic acks are
  // session-bound per §2) so it flips speaking→recompute; a session-less
  // caller stays room-level "meta".
  const ctx: PlaybackContext = sessionId ? { sessionId } : "meta";

  try {
    const character = getCharacter(voiceId);

    if (mode === "cached" || !character || !userPrompt?.trim()) {
      return await playRandomPhrase(voiceId, "ack", ctx);
    }

    log("dynamic", `Generating ${character.name} response for prompt (${userPrompt.length} chars)`);

    const responseText = await generateCharacterResponse(userPrompt, character);

    if (!responseText) {
      log("dynamic", "Generation failed — falling back to cached phrase");
      return await playRandomPhrase(voiceId, "ack", ctx);
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
      await playStreamBuffer(stream as any, "dynamic-response", ctx, meta);
      return true;
    }

    log("dynamic", "Stream failed — falling back to cached phrase");
    return await playRandomPhrase(voiceId, "ack", ctx);
  } finally {
    releaseLock();
  }
}

// Gemini-failure fallback: speak just the question itself (first sentence
// or line, before the option list) instead of streaming the whole options
// block to ElevenLabs.
function truncateQuestion(text: string): string {
  const firstLine = text.trim().split("\n")[0].trim();
  const sentenceEnd = firstLine.search(/[.?!](\s|$)/);
  return sentenceEnd >= 0 ? firstLine.slice(0, sentenceEnd + 1) : firstLine;
}

// Write an ask-user question into the queue with the same shape ingest uses
// (`-cc-<shortSession>.json`, source "ask-user") so grant_floor / the daemon
// read and synthesize it through the normal on-grant path — no second code path.
function enqueueQuestionFile(
  sessionId: string,
  sessionName: string | undefined,
  text: string
): void {
  try {
    const now = Date.now();
    const epoch = Math.floor(now / 1000);
    const ms = String(now % 1000).padStart(3, "0");
    const filename = `${epoch}-${ms}-cc-${sessionId.slice(0, 12)}.json`;
    const data = {
      text,
      conversation_id: sessionId,
      generation_id: "",
      model: "claude-code",
      timestamp: String(epoch),
      thread_title: sessionName ?? "Claude Code",
      spoken: false,
      source: "ask-user",
    };
    writeFileSync(join(QUEUE_DIR, filename), JSON.stringify(data, null, 2));
    log("dynamic", `Ask-user queued for grant: ${filename}`);
  } catch (err: any) {
    log("dynamic", `enqueueQuestionFile failed: ${err.message}`);
  }
}

export async function handleAskUser(
  voiceId: string,
  questionText: string,
  sessionId?: string,
  sessionName?: string
): Promise<boolean> {
  if (!questionText?.trim()) return false;

  // Ask-user readouts are session-bound (§2) — attribute to the asking session.
  const ctx: PlaybackContext = sessionId ? { sessionId } : "meta";

  // Announce mode etiquette (§3): questions are the exact uninvited audio (and
  // credit spend) this mode exists to prevent. Don't synthesize — queue the
  // question for the normal on-grant path, raise the hand, and sound the cached
  // "I've got a question" chime. Granting the floor reads it. Auto mode below
  // keeps today's immediate readout unchanged.
  if (effectivePlaybackMode() === "announce") {
    if (sessionId) {
      enqueueQuestionFile(sessionId, sessionName, questionText);
      setSessionState(sessionId, "hand_raised");
    }
    log("dynamic", "Announce mode — question chimed, hand raised, no synthesis");
    return await playRandomPhrase(voiceId, "question", ctx);
  }

  // Question readouts carry real content — wait for the lock rather than skip.
  await waitForLock();
  try {
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
      log("dynamic", "No GEMINI_API_KEY for ask-user — reading question line only");
      return await streamAndPlay(voiceId, truncateQuestion(questionText), ctx, meta);
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
      if (!text) {
        return await streamAndPlay(voiceId, truncateQuestion(questionText), ctx, meta);
      }

      meta.textPreview = text.slice(0, 120);
      log("dynamic", `Ask-user response: "${text}"`);
      return await streamAndPlay(voiceId, text, ctx, meta);
    } catch (err: any) {
      log("dynamic", `Ask-user Gemini error: ${err.message}`);
      return await streamAndPlay(voiceId, truncateQuestion(questionText), ctx, meta);
    }
  } finally {
    releaseLock();
  }
}

async function streamAndPlay(
  voiceId: string,
  text: string,
  ctx: PlaybackContext,
  meta?: ReplayMeta
): Promise<boolean> {
  const stream = await streamTTS(text, { voiceId });
  if (stream) {
    await playStreamBuffer(stream as any, "ask-user-response", ctx, meta);
    return true;
  }
  return false;
}
