import { loadEnv, lookupSessionName, loadMutedSessions } from "./config.js";
import { resolveVoiceId } from "./elevenlabs.js";
import { handleDynamicResponse, handleAskUser } from "./dynamic-response.js";
import { replayLast } from "./audio.js";
import { log } from "./logger.js";

loadEnv();

const action = process.argv[2];
const sessionId = process.argv[3] || "";
const textArg = process.argv[4] || "";

// Muted sessions stay silent — checked BEFORE any Gemini/ElevenLabs call.
if (sessionId && loadMutedSessions().includes(sessionId)) {
  log("signal", `Session ${sessionId} muted — skipping ${action}`);
  process.exit(0);
}

const voiceId = resolveVoiceId(sessionId);
const sessionName = (sessionId && lookupSessionName(sessionId)) || undefined;

if (action === "prompt-submitted") {
  log("signal", `UserPromptSubmit → dynamic response (voice=${voiceId}, prompt=${textArg.slice(0, 60)})`);
  const played = await handleDynamicResponse(voiceId, textArg, sessionId || undefined, sessionName);
  if (!played) log("signal", "No response generated — silent");
} else if (action === "ask-user") {
  log("signal", `AskUser → reading question (voice=${voiceId}, question=${textArg.slice(0, 60)})`);
  const played = await handleAskUser(voiceId, textArg, sessionId || undefined, sessionName);
  if (!played) log("signal", "No question read — silent");
} else if (action === "replay") {
  const nth = parseInt(textArg, 10) || 1;
  log("signal", `Replay request — playing ${nth === 1 ? "last" : `${nth}th from last`} message`);
  const code = await replayLast(nth);
  if (code !== 0) log("signal", "Nothing to replay");
} else {
  console.error(`Unknown signal: ${action}`);
  process.exit(1);
}
