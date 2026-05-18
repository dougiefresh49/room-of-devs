import { loadConfig, loadEnv } from "./config.js";
import { resolveVoiceId } from "./elevenlabs.js";
import { handleDynamicResponse } from "./dynamic-response.js";
import { log } from "./logger.js";

loadEnv();

const action = process.argv[2];

if (action === "prompt-submitted") {
  const sessionId = process.argv[3];
  const userPrompt = process.argv[4] || "";
  const voiceId = resolveVoiceId(sessionId);
  log("signal", `UserPromptSubmit → dynamic response (voice=${voiceId}, prompt=${userPrompt.slice(0, 60)})`);
  const played = await handleDynamicResponse(voiceId, userPrompt);
  if (!played) {
    log("signal", "No response generated — silent");
  }
} else {
  console.error(`Unknown signal: ${action}`);
  process.exit(1);
}
