import { appendFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { LOG_FILE } from "./config.js";

let ensured = false;

export function log(tag: string, msg: string): void {
  if (!ensured) {
    try {
      mkdirSync(dirname(LOG_FILE), { recursive: true });
    } catch {}
    ensured = true;
  }
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  const line = `[${ts}] ${tag}: ${msg}\n`;
  try {
    appendFileSync(LOG_FILE, line);
  } catch {}
}
