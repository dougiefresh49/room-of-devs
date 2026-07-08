import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { spawnSync } from "child_process";
import { pathToFileURL } from "url";
import {
  TTS_DIR,
  STATE_DIR,
  STREAM_LOCK,
  getActiveSessions,
  loadSessionVoices,
  loadMutedSessions,
} from "./config.js";
import { getCharacter } from "./dynamic-response.js";

const SCRIPTS_DIR = join(TTS_DIR, "scripts");
const SERVER_DIR = join(TTS_DIR, "tts-server");
const TEAM_MAP_PATH = join(TTS_DIR, "team_map.json");

type Action =
  | { kind: "grant"; sessionId?: string }
  | { kind: "pause" }
  | { kind: "stop" }
  | { kind: "replay" }
  | { kind: "status" }
  | { kind: "mute"; sessionId: string }
  | { kind: "unmute"; sessionId: string }
  | { kind: "clear"; sessionId: string }
  | { kind: "inject"; target: string; message: string };

const FLOOR_EXIT = 10;

export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const row = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = row[j];
      row[j] =
        a[i - 1] === b[j - 1]
          ? prev
          : 1 + Math.min(prev, row[j], row[j - 1]);
      prev = tmp;
    }
  }
  return row[n];
}

function normalizeToken(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\w\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeTranscript(raw: string): string {
  let s = normalizeToken(raw);
  let prev: string;
  do {
    prev = s;
    s = s
      .replace(/^(um|uh|please)\s+/, "")
      .replace(/\s+(um|uh|please)$/, "")
      .trim();
    if (!/^hey\s+\w/.test(s)) {
      s = s.replace(/^hey\s+/, "").replace(/\s+hey$/, "").trim();
    }
  } while (s !== prev);
  return s;
}

interface NameCandidate {
  label: string;
  sessionId: string;
}

function loadTeamMap(): Record<string, { sessionId: string }> {
  try {
    if (!existsSync(TEAM_MAP_PATH)) return {};
    return JSON.parse(readFileSync(TEAM_MAP_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function buildFloorCandidates(): NameCandidate[] {
  const out: NameCandidate[] = [];
  const seen = new Set<string>();

  const add = (label: string, sessionId: string) => {
    const key = `${normalizeToken(label)}:${sessionId}`;
    if (!label || seen.has(key)) return;
    seen.add(key);
    out.push({ label: normalizeToken(label), sessionId });
  };

  for (const s of getActiveSessions()) add(s.name, s.sessionId);

  const voices = loadSessionVoices();
  for (const [sessionId, voiceId] of Object.entries(voices)) {
    const char = getCharacter(voiceId);
    if (!char) continue;
    add(char.name, sessionId);
    for (const nick of NICKNAMES[normalizeToken(char.name)] ?? []) {
      add(nick, sessionId);
    }
  }

  return out;
}

// Spoken nicknames can't be reached by prefix/edit-distance matching
// ("donnie" vs "donatello" is 4 edits) — the names you'd actually say
// need an explicit alias table.
const NICKNAMES: Record<string, string[]> = {
  donatello: ["donnie", "don", "donny"],
  michelangelo: ["mikey", "mike", "mickey"],
  raphael: ["raph", "ralph"],
  leonardo: ["leo"],
  splinter: ["master splinter", "sensei"],
};

function buildInjectionCandidates(): Array<{ label: string; target: string }> {
  const out: Array<{ label: string; target: string }> = [];
  for (const [persona, entry] of Object.entries(loadTeamMap())) {
    if (!entry?.sessionId) continue;
    const key = normalizeToken(persona);
    out.push({ label: key, target: persona });
    for (const nick of NICKNAMES[key] ?? []) {
      out.push({ label: normalizeToken(nick), target: persona });
    }
  }
  return out;
}

type ResolveResult =
  | { ok: string }
  | { ambiguous: string[] }
  | { none: true };

function resolveByName(
  spoken: string,
  candidates: Array<{ label: string; sessionId: string }>
): ResolveResult {
  const q = normalizeToken(spoken);
  if (!q) return { none: true };

  const tiers = [
    (c: NameCandidate) => c.label === q,
    (c: NameCandidate) => c.label.startsWith(q) || q.startsWith(c.label),
    (c: NameCandidate) => levenshtein(c.label, q) <= 2,
  ];

  for (const pred of tiers) {
    const hits = candidates.filter(pred);
    const ids = [...new Set(hits.map((h) => h.sessionId))];
    if (ids.length === 1) return { ok: ids[0] };
    if (ids.length > 1) {
      // Tie-break: a team_map-bound session outranks manually-voiced ones —
      // "go ahead donnie" should reach the team room's Donnie, not whichever
      // scratch session happens to wear the same voice.
      const teamIds = new Set(
        Object.values(loadTeamMap())
          .map((e) => e?.sessionId)
          .filter(Boolean)
      );
      const teamHits = ids.filter((id) => teamIds.has(id));
      if (teamHits.length === 1) return { ok: teamHits[0] };
      const labels = [...new Set(hits.map((h) => h.label))];
      return { ambiguous: labels };
    }
  }
  return { none: true };
}

function resolveInjectionTarget(spoken: string): ResolveResult {
  const q = normalizeToken(spoken);
  if (!q) return { none: true };
  const candidates = buildInjectionCandidates().map((c) => ({
    label: c.label,
    sessionId: c.target,
  }));
  return resolveByName(spoken, candidates);
}

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

function runSignalReplay(): number {
  const r = spawnSync(
    "pnpm",
    ["exec", "tsx", "src/signal.ts", "replay", "", "1"],
    { cwd: SERVER_DIR, stdio: "inherit" }
  );
  return r.status ?? 1;
}

function lockBusy(): boolean {
  if (!existsSync(STREAM_LOCK)) return false;
  try {
    const pid = Number(readFileSync(STREAM_LOCK, "utf-8").trim());
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function humanizeWait(raisedAt: string | null): string {
  if (!raisedAt) return "?";
  try {
    const then = new Date(raisedAt).getTime();
    const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
    if (secs < 60) return `${secs} seconds`;
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"}`;
    const hours = Math.floor(mins / 60);
    const rem = mins % 60;
    return rem ? `${hours} hours ${rem} minutes` : `${hours} hours`;
  } catch {
    return "?";
  }
}

function joinNames(names: string[]): string {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

const COUNT_WORDS = [
  "Zero",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
];

function composeStatus(): string {
  const muted = new Set(loadMutedSessions());
  const hands: Array<{ name: string; wait: string }> = [];
  const working: string[] = [];
  let speaking: string | null = null;

  if (existsSync(STATE_DIR)) {
    for (const f of readdirSync(STATE_DIR)) {
      if (!f.endsWith(".json")) continue;
      try {
        const s = JSON.parse(
          readFileSync(join(STATE_DIR, f), "utf-8")
        ) as {
          sessionId?: string;
          name?: string;
          state?: string;
          raisedAt?: string | null;
        };
        const sid = s.sessionId || f.slice(0, -5);
        if (muted.has(sid)) continue;
        const name = s.name || sid.slice(0, 12);
        if (s.state === "hand_raised") {
          hands.push({ name, wait: humanizeWait(s.raisedAt ?? null) });
        } else if (s.state === "working") {
          working.push(name);
        } else if (s.state === "speaking" && !speaking) {
          speaking = name;
        }
      } catch {
        continue;
      }
    }
  }

  const parts: string[] = [];
  if (hands.length) {
    const detail = hands
      .map((h, i) =>
        i === 0 && hands.length > 1
          ? `${h.name}, waiting ${h.wait}`
          : i === 0
            ? `${h.name}, waiting ${h.wait}`
            : h.name
      )
      .join(", and ");
    const head =
      hands.length === 1
        ? "One hand up"
        : `${COUNT_WORDS[hands.length] ?? hands.length} hands up`;
    parts.push(`${head}: ${detail}.`);
  }
  for (const w of working) parts.push(`${w} is working.`);
  if (speaking) parts.push(`${speaking} is speaking.`);

  const floorFree = !lockBusy() && !speaking;
  parts.push(floorFree ? "Floor is free." : "Floor is busy.");

  if (parts.length === 1 && parts[0].startsWith("Floor")) {
    return "No agents in the room. Floor is free.";
  }
  return parts.join(" ");
}

export function matchGrammar(text: string): Action | null {
  let m: RegExpMatchArray | null;

  m = text.match(/^(go ahead|go)(?:\s+(.+))?$/);
  if (m) return { kind: "grant", sessionId: m[2]?.trim() || undefined };

  if (/^(pause|hold on|wait)$/.test(text)) return { kind: "pause" };
  if (/^(resume|continue|keep going)$/.test(text)) return { kind: "pause" };
  if (/^(stop|enough|shut up)$/.test(text)) return { kind: "stop" };
  if (/^(say (that )?again|repeat|again)$/.test(text)) return { kind: "replay" };
  if (/^status$/.test(text) || /^who(?:'s| is) (?:up|waiting)/.test(text)) {
    return { kind: "status" };
  }

  m = text.match(/^(mute|unmute)\s+(.+)$/);
  if (m) {
    const verb = m[1] as "mute" | "unmute";
    return { kind: verb, sessionId: m[2].trim() };
  }

  m = text.match(/^(?:clear|never ?mind|skip)\s+(.+)$/);
  if (m) return { kind: "clear", sessionId: m[1].trim() };

  m = text.match(/^(?:tell|talk to|ask|hey)\s+([\w-]+),?\s+(.+)$/);
  if (m) return { kind: "inject", target: m[1].trim(), message: m[2].trim() };

  return null;
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
    speak(`Can't reach ${target} — not running in the team room.`);
    return 1;
  }
  if (r.status === 3) {
    speak(`Can't reach ${target} — not running in the team room.`);
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
    case "replay":
      if (dryRun) return dry("replay", ["1"]);
      runSignalReplay();
      return FLOOR_EXIT;
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
  }
}

export function route(
  transcript: string,
  opts: { target?: string; dryRun?: boolean } = {}
): number {
  if (opts.target) {
    return execInject(opts.target, transcript.trim(), !!opts.dryRun);
  }

  const text = normalizeTranscript(transcript);
  const action = matchGrammar(text);
  if (!action) {
    if (opts.dryRun) return dry("unmatched", ["Didn't catch that"]);
    speak("Didn't catch that");
    return 0;
  }
  return executeAction(action, !!opts.dryRun);
}

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
