import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { spawn } from "child_process";
import { TTS_DIR, STATE_DIR, loadSessionVoices, effectivePlaybackMode } from "./config.js";
import { getCharacter } from "./dynamic-response.js";
import { log } from "./logger.js";
import { loadTeamMap } from "./team-map.js";

const SCRIPTS_DIR = join(TTS_DIR, "scripts");
const SERVER_DIR = join(TTS_DIR, "tts-server");

// ── Failure isolation ─────────────────────────────────────────────
// Every handler runs through this: a throwing button handler logs and dies
// quietly, it never propagates out to crash the shared tts-server daemon.
export function safe(fn: () => void): void {
  try {
    fn();
  } catch (err: any) {
    log("hid", `handler error: ${err?.message ?? err}`);
  }
}

// ── Spawning (non-blocking; the daemon must not stall on a button) ─
export function runScript(name: string, args: string[]): void {
  try {
    const child = spawn(join(SCRIPTS_DIR, name), args, { stdio: "ignore" });
    child.on("error", (e) => log("hid", `${name} spawn error: ${e.message}`));
  } catch (err: any) {
    log("hid", `${name} spawn failed: ${err?.message ?? err}`);
  }
}

export function runSignalReplay(): void {
  try {
    const child = spawn("pnpm", ["exec", "tsx", "src/signal.ts", "replay", "", "1"], {
      cwd: SERVER_DIR,
      stdio: "ignore",
    });
    child.on("error", (e) => log("hid", `signal replay spawn error: ${e.message}`));
  } catch (err: any) {
    log("hid", `signal replay spawn failed: ${err?.message ?? err}`);
  }
}

// ── Character → session resolution ────────────────────────────────
// Reverse of press-time lookup: character name → voiceId (via characters.json)
// → the session wearing that voice (session_voices.json). Newest active
// session wins; a team_map.json persona whose name matches wins ties.
interface StateSnapshot {
  state?: string;
  updatedAt?: string;
  raisedAt?: string;
}

export function readState(sessionId: string): StateSnapshot | null {
  try {
    const p = join(STATE_DIR, `${sessionId}.json`);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf-8")) as StateSnapshot;
  } catch {
    return null;
  }
}

export function resolveCharacterSession(character: string): string | null {
  const want = character.trim().toLowerCase();
  if (!want) return null;

  // Sessions whose assigned voice belongs to this character.
  const candidates: string[] = [];
  for (const [sessionId, voiceId] of Object.entries(loadSessionVoices())) {
    const char = getCharacter(voiceId);
    if (char && char.name.trim().toLowerCase() === want) candidates.push(sessionId);
  }
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  // Team-map persona wins ties: if a persona keyed by this character name pins
  // a sessionId that is one of the candidates, prefer it.
  const team = loadTeamMap();
  const teamEntry = team[want];
  if (teamEntry?.sessionId && candidates.includes(teamEntry.sessionId)) {
    return teamEntry.sessionId;
  }

  // Otherwise newest active session — most recently updated state file wins.
  let best: string | null = null;
  let bestT = -1;
  for (const sid of candidates) {
    const st = readState(sid);
    if (!st) continue;
    const t = st.updatedAt ? Date.parse(st.updatedAt) : 0;
    if (t >= bestT) {
      bestT = t;
      best = sid;
    }
  }
  return best ?? candidates[0];
}

const MODE_CYCLE: Record<string, string> = {
  auto: "announce",
  announce: "silent",
  silent: "auto",
};

// Valid `action` / `hold_action` values for arcade_buttons.json (panel UI lists these).
export const HID_ACTIONS = [
  "grant_next",
  "replay",
  "stop",
  "pause",
  "panel",
  "cycle_mode",
  "toggle_mode",
  "hold_room",
] as const;

export type HidAction = (typeof HID_ACTIONS)[number];

export function doAction(action: string): void {
  switch (action) {
    case "grant_next":
      runScript("grant_floor.sh", []);
      return;
    case "replay":
      runSignalReplay();
      return;
    case "stop":
      runScript("stop.sh", []);
      return;
    case "pause":
      runScript("pause.sh", []); // SIGSTOP/SIGCONT toggle — tap to pause, tap to resume
      return;
    case "panel":
      runScript("panel.sh", []); // open/focus the Room widget
      return;
    case "cycle_mode":
    case "toggle_mode": {
      const next = MODE_CYCLE[effectivePlaybackMode()] ?? "auto";
      runScript("set_playback_mode.sh", [next]);
      return;
    }
    case "hold_room": {
      // Toggle: hold if free, release if already held.
      const held = existsSync(join(TTS_DIR, ".hold-room.json"));
      runScript("hold_room.sh", held ? ["off"] : []);
      return;
    }
    default:
      log("hid", `unknown action: ${action}`);
  }
}

export function characterPress(character: string): void {
  const sid = resolveCharacterSession(character);
  if (!sid) {
    log("hid", `no active session wearing ${character}'s voice — press ignored`);
    return;
  }
  // Already talking → the tap means "I heard enough": duck it instead of
  // re-granting the floor (design doc's ducking rule).
  if (readState(sid)?.state === "speaking") {
    log("hid", `${character} (${sid.slice(0, 12)}) speaking → stop`);
    runScript("stop.sh", []);
  } else {
    log("hid", `grant floor → ${character} (${sid.slice(0, 12)})`);
    runScript("grant_floor.sh", [sid]);
  }
}

export function characterHold(character: string, phase: "start" | "stop"): void {
  const sid = resolveCharacterSession(character);
  if (!sid) {
    log("hid", `no active session wearing ${character}'s voice — PTT ${phase} ignored`);
    return;
  }
  // Hold-to-talk means INJECTION, which only works for team.sh (tmux) sessions.
  // Fail fast with a friendly spoken error — never start recording toward a
  // session we can't reach, and never speak a raw sessionId aloud.
  const team = loadTeamMap();
  const inTeam = Object.values(team).some((e) => e?.sessionId === sid);
  if (!inTeam) {
    if (phase === "start") {
      log("hid", `PTT to ${character} refused — session not in team_map`);
      try {
        const child = spawn(
          "say",
          [`${character} isn't in the team room yet. Launch them with team dot S H first.`],
          { stdio: "ignore" },
        );
        child.on("error", () => {});
      } catch {}
    }
    return;
  }
  log("hid", `PTT ${phase} → ${character} (${sid.slice(0, 12)})`);
  runScript("ptt.sh", [phase, sid]);
}
