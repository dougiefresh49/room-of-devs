import { spawn } from "child_process";
import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { STATE_DIR, QUEUE_DIR } from "./config.js";
import type { SessionState } from "./state.js";
import { log } from "./logger.js";

interface StateSnapshot {
  name?: string;
  state?: SessionState;
  raisedAt?: string | null;
}

function readState(sessionId: string): StateSnapshot | null {
  try {
    const p = join(STATE_DIR, `${sessionId}.json`);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf-8")) as StateSnapshot;
  } catch {
    return null;
  }
}

function countQueued(shortSession: string): number {
  try {
    if (!existsSync(QUEUE_DIR)) return 0;
    const suffix = `-cc-${shortSession}.json`;
    return readdirSync(QUEUE_DIR).filter((f) => f.endsWith(suffix)).length;
  } catch {
    return 0;
  }
}

function formatWaitMinutes(raisedAt: string | null | undefined): string {
  if (!raisedAt) return "a while";
  const ms = Date.now() - Date.parse(raisedAt);
  if (Number.isNaN(ms) || ms < 0) return "a while";
  const mins = Math.max(1, Math.round(ms / 60000));
  return mins === 1 ? "1 minute" : `${mins} minutes`;
}

export function buildStatusSentence(sessionId: string): string | null {
  const state = readState(sessionId);
  if (!state) return null;
  const name = state.name || sessionId.slice(0, 12);
  const queue = countQueued(sessionId.slice(0, 12));

  switch (state.state) {
    case "working":
      return `${name}: working`;
    case "hand_raised":
      return `${name}: hand raised, waiting ${formatWaitMinutes(state.raisedAt)}`;
    case "speaking":
      return `${name}: speaking`;
    case "idle":
      return queue > 0 ? `${name}: idle, ${queue} queued` : `${name}: idle`;
    default:
      return `${name}: ${state.state ?? "unknown"}`;
  }
}

export function runStatusSay(sessionId: string): void {
  const sentence = buildStatusSentence(sessionId);
  if (!sentence) {
    log("status-say", `no state for ${sessionId.slice(0, 12)}`);
    return;
  }
  try {
    const child = spawn("say", [sentence], { stdio: "ignore" });
    child.on("error", (e) => log("status-say", `say spawn error: ${e.message}`));
    log("status-say", sentence);
  } catch (err: any) {
    log("status-say", `say failed: ${err?.message ?? err}`);
  }
}
