/**
 * Runtime persona registry path — lives under TTS_DIR (alongside config.json),
 * not under tts-server/src/, so deploys cannot wipe it (audit C-2).
 */
import { join } from "path";
import { TTS_DIR } from "./config.js";

export const CHARACTERS_PATH = join(TTS_DIR, "characters.json");
