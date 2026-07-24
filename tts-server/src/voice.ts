/**
 * Legacy voice CLI — speak()/execution glue over the shared RuleRouter grammar.
 * Behavior when invoked directly is unchanged (including the bound-target
 * raw-inject short-circuit). New PTT routing goes through interpreter/.
 */
import { join } from "path";
import { spawnSync } from "child_process";
import { pathToFileURL } from "url";
import { TTS_DIR } from "./config.js";
import {
  type Action,
  applyAliases,
  buildFloorCandidates,
  composeStatus,
  matchGrammar,
  normalizeTranscript,
  resolveByName,
  resolveDefaultInjectionTarget,
  resolveInjectionTarget,
  speakableName,
} from "./interpreter/rule-router.js";

const SCRIPTS_DIR = join(TTS_DIR, "scripts");
const SERVER_DIR = join(TTS_DIR, "tts-server");

const FLOOR_EXIT = 10;

function speak(text: string): void {
  spawnSync("say", [text], { stdio: "ignore" });
}

function dry(action: string, args: string[]): number {
  console.log(`ACTION: ${action} ARGS: ${args.join(" ")}`.trim());
  return 0;
}

function runScript(name: string, args: string[]): number {
  const r = spawnSync(join(SCRIPTS_DIR, name), args, { stdio: "inherit" });
  return r.status ?? 1;
}

function runSignalReplay(speed?: number): number {
  const args = ["exec", "tsx", "src/signal.ts", "replay", "", "1"];
  if (speed != null) args.push(String(speed));
  const r = spawnSync("pnpm", args, { cwd: SERVER_DIR, stdio: "inherit" });
  return r.status ?? 1;
}

function resolveFloorName(spoken: string, dryRun: boolean): string | null {
  const res = resolveByName(spoken, buildFloorCandidates());
  if ("ok" in res && res.ok) return res.ok;
  if ("ambiguous" in res && res.ambiguous) {
    const msg = `Which one? ${res.ambiguous.join(", ")}.`;
    if (dryRun) dry("error", [msg]);
    else speak(msg);
    return null;
  }
  const msg = "Couldn't find that session.";
  if (dryRun) dry("error", [msg]);
  else speak(msg);
  return null;
}

function execInject(target: string, message: string, dryRun: boolean): number {
  if (dryRun) return dry("inject", [target, message]);
  const r = spawnSync(join(SCRIPTS_DIR, "inject_prompt.sh"), [target, message], {
    stdio: "inherit",
  });
  if (r.error && (r.error as NodeJS.ErrnoException).code === "ENOENT") {
    speak(`Can't reach ${speakableName(target)} — not running in the team room.`);
    return 1;
  }
  if (r.status === 3) {
    speak(`Can't reach ${speakableName(target)} — not running in the team room.`);
    return r.status;
  }
  return r.status ?? 1;
}

function executeAction(action: Action, dryRun: boolean): number {
  switch (action.kind) {
    case "grant": {
      if (action.sessionId) {
        const sid = resolveFloorName(action.sessionId, dryRun);
        if (!sid) return 0;
        if (dryRun) return dry("grant", [sid]);
        runScript("grant_floor.sh", [sid]);
      } else {
        if (dryRun) return dry("grant", []);
        runScript("grant_floor.sh", []);
      }
      return FLOOR_EXIT;
    }
    case "pause":
      if (dryRun) return dry("pause", []);
      runScript("pause.sh", []);
      return FLOOR_EXIT;
    case "stop":
      if (dryRun) return dry("stop", []);
      runScript("stop.sh", []);
      return FLOOR_EXIT;
    case "replay": {
      const replayArgs = action.speed != null ? ["1", String(action.speed)] : ["1"];
      if (dryRun) return dry("replay", replayArgs);
      runSignalReplay(action.speed);
      return FLOOR_EXIT;
    }
    case "status": {
      const phrase = composeStatus();
      if (dryRun) return dry("status", [phrase]);
      speak(phrase);
      return 0;
    }
    case "mute":
    case "unmute":
    case "clear": {
      const sid = resolveFloorName(action.sessionId, dryRun);
      if (!sid) return 0;
      const script =
        action.kind === "mute" || action.kind === "unmute"
          ? "set_session_mute.sh"
          : "clear_session_queue.sh";
      const args =
        action.kind === "mute" || action.kind === "unmute"
          ? [sid, action.kind]
          : [sid];
      if (dryRun) return dry(action.kind, args);
      runScript(script, args);
      return 0;
    }
    case "inject": {
      const res = resolveInjectionTarget(action.target);
      if ("ok" in res && res.ok) {
        return execInject(res.ok, action.message, dryRun);
      }
      if ("ambiguous" in res && res.ambiguous) {
        const msg = `Which one? ${res.ambiguous.join(", ")}.`;
        if (dryRun) dry("error", [msg]);
        else speak(msg);
        return 0;
      }
      const msg = `Can't reach ${action.target} — not running in the team room.`;
      if (dryRun) dry("error", [msg]);
      else speak(msg);
      return 0;
    }
    case "slash_command": {
      const message = `/${action.command}`;
      const res = action.target
        ? resolveInjectionTarget(action.target)
        : resolveDefaultInjectionTarget();
      if ("ok" in res && res.ok) {
        return execInject(res.ok, message, dryRun);
      }
      if ("ambiguous" in res && res.ambiguous) {
        const msg = `Which one? ${res.ambiguous.join(", ")}.`;
        if (dryRun) dry("error", [msg]);
        else speak(msg);
        return 0;
      }
      const target = action.target ?? "them";
      const msg = `Can't reach ${target} — not running in the team room.`;
      if (dryRun) dry("error", [msg]);
      else speak(msg);
      return 0;
    }
    case "mood":
      if (dryRun) return dry("set_mood", [action.preset]);
      runScript("set_mood.sh", [action.preset]);
      return FLOOR_EXIT;
    case "hold_room": {
      const args = action.minutes != null ? [String(action.minutes)] : [];
      if (dryRun) return dry("hold_room", args);
      runScript("hold_room.sh", args);
      return FLOOR_EXIT;
    }
    case "release_room":
      if (dryRun) return dry("hold_room", ["off"]);
      runScript("hold_room.sh", ["off"]);
      return FLOOR_EXIT;
    case "cancel_inject":
      if (dryRun) return dry("cancel_inject", []);
      runScript("cancel_inject.sh", []);
      return 0;
  }
}

export function route(
  transcript: string,
  opts: { target?: string; dryRun?: boolean } = {}
): number {
  // Legacy short-circuit preserved for direct CLI callers. Bound-target PTT
  // now routes through the interpreter (see interpreter/coordinator.ts).
  if (opts.target) {
    return execInject(opts.target, transcript.trim(), !!opts.dryRun);
  }

  const text = applyAliases(normalizeTranscript(transcript));
  const action = matchGrammar(text);
  if (!action) {
    if (opts.dryRun) return dry("unmatched", ["Didn't catch that"]);
    speak("Didn't catch that");
    return 0;
  }
  return executeAction(action, !!opts.dryRun);
}

// Re-exports kept for any external importers of the old voice.ts surface.
export {
  applyAliases,
  levenshtein,
  matchGrammar,
  normalizeTranscript,
} from "./interpreter/rule-router.js";
export type { Action } from "./interpreter/rule-router.js";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args[0] !== "route") {
    console.error('Usage: tsx src/voice.ts route [--target <sessionId>] [--dry-run] "<transcript>"');
    process.exit(1);
  }

  let target: string | undefined;
  let dryRun = false;
  const rest: string[] = [];
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--target" && args[i + 1]) {
      target = args[++i];
    } else if (args[i] === "--dry-run") {
      dryRun = true;
    } else {
      rest.push(args[i]);
    }
  }

  const transcript = rest.join(" ").trim();
  if (!transcript && !target) {
    console.error('Usage: tsx src/voice.ts route [--target <sessionId>] [--dry-run] "<transcript>"');
    process.exit(1);
  }

  process.exit(route(transcript, { target, dryRun }));
}
