/**
 * RuleRouter — pure voice grammar + name resolution (zero-cost fast path).
 *
 * Extracted from voice.ts so the interpreter and the legacy CLI share one
 * grammar. No speak(), no script spawns — returns data only.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import {
  TTS_DIR,
  STATE_DIR,
  STREAM_LOCK,
  getActiveSessions,
  loadSessionVoices,
  loadMutedSessions,
  loadNicknames,
} from "../config.js";
import { getCharacter } from "../dynamic-response.js";

const TEAM_MAP_PATH = join(TTS_DIR, "team_map.json");
const ALIASES_PATH = join(TTS_DIR, "aliases.json");

let cachedAliases: Record<string, string> | null = null;
let aliasesMtime = 0;

export type Action =
  | { kind: "grant"; sessionId?: string }
  | { kind: "pause" }
  | { kind: "stop" }
  | { kind: "replay"; speed?: number }
  | { kind: "status" }
  | { kind: "mute"; sessionId: string }
  | { kind: "unmute"; sessionId: string }
  | { kind: "clear"; sessionId: string }
  | { kind: "inject"; target: string; message: string }
  | { kind: "slash_command"; command: string; target?: string }
  | { kind: "mood"; preset: string }
  | { kind: "hold_room"; minutes?: number }
  | { kind: "release_room" }
  | { kind: "cancel_inject" };

export interface RouterContext {
  /** Default inject/slash target when the utterance has no explicit one. */
  boundTarget?: string | null;
}

export interface NameCandidate {
  label: string;
  sessionId: string;
  priority: number;
}

export type ResolveResult = { ok: string } | { ambiguous: string[] } | { none: true };

function loadAliases(): Record<string, string> {
  try {
    if (!existsSync(ALIASES_PATH)) return {};
    const mtime = statSync(ALIASES_PATH).mtimeMs;
    if (cachedAliases && mtime === aliasesMtime) return cachedAliases;

    const raw = JSON.parse(readFileSync(ALIASES_PATH, "utf-8")) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [spoken, canonical] of Object.entries(raw)) {
      if (typeof canonical !== "string") continue;
      out[normalizeTranscript(spoken)] = normalizeTranscript(canonical);
    }
    cachedAliases = out;
    aliasesMtime = mtime;
    return out;
  } catch {
    return {};
  }
}

export function applyAliases(text: string): string {
  return loadAliases()[text] ?? text;
}

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
      row[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, row[j], row[j - 1]);
      prev = tmp;
    }
  }
  return row[n];
}

export function normalizeToken(s: string): string {
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
      s = s
        .replace(/^hey\s+/, "")
        .replace(/\s+hey$/, "")
        .trim();
    }
  } while (s !== prev);
  return s;
}

export function loadTeamMap(): Record<string, { sessionId: string }> {
  try {
    if (!existsSync(TEAM_MAP_PATH)) return {};
    return JSON.parse(readFileSync(TEAM_MAP_PATH, "utf-8"));
  } catch {
    return {};
  }
}

// Spoken nicknames can't be reached by prefix/edit-distance matching
// ("donnie" vs "donatello" is 4 edits) — the names you'd actually say
// need an explicit alias table.
export const NICKNAMES: Record<string, string[]> = {
  donatello: ["donnie", "don", "donny"],
  michelangelo: ["mikey", "mike", "mickey"],
  raphael: ["raph", "ralph"],
  leonardo: ["leo"],
  splinter: ["master splinter", "sensei"],
};

export function buildFloorCandidates(): NameCandidate[] {
  const out: NameCandidate[] = [];
  const seen = new Set<string>();
  const nicknames = loadNicknames();

  const add = (label: string, sessionId: string, priority: number) => {
    const key = `${normalizeToken(label)}:${sessionId}`;
    if (!label || seen.has(key)) return;
    seen.add(key);
    out.push({ label: normalizeToken(label), sessionId, priority });
  };

  for (const s of getActiveSessions()) {
    const custom = nicknames[s.sessionId];
    if (custom) add(custom, s.sessionId, 3);
    add(s.name, s.sessionId, 1);
  }

  const voices = loadSessionVoices();
  for (const [sessionId, voiceId] of Object.entries(voices)) {
    const char = getCharacter(voiceId);
    if (!char) continue;
    add(char.name, sessionId, 2);
    for (const nick of NICKNAMES[normalizeToken(char.name)] ?? []) {
      add(nick, sessionId, 2);
    }
  }

  return out;
}

export function buildInjectionCandidates(): Array<{ label: string; target: string }> {
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

/** Candidate names for the LLM router prompt (same builders ptt.sh uses). */
export function listCandidateNames(): string[] {
  const names = new Set<string>();
  for (const c of buildFloorCandidates()) names.add(c.label);
  for (const c of buildInjectionCandidates()) names.add(c.label);
  return [...names].sort();
}

export function resolveByName(
  spoken: string,
  candidates: Array<{ label: string; sessionId: string; priority?: number }>,
): ResolveResult {
  const q = normalizeToken(spoken);
  if (!q) return { none: true };

  const tiers = [
    (c: { label: string }) => c.label === q,
    (c: { label: string }) => c.label.startsWith(q) || q.startsWith(c.label),
    (c: { label: string }) => levenshtein(c.label, q) <= 2,
  ];

  for (const pred of tiers) {
    const hits = candidates.filter(pred);
    if (hits.length === 0) continue;
    const maxPri = Math.max(...hits.map((h) => h.priority ?? 1));
    const topHits = hits.filter((h) => (h.priority ?? 1) === maxPri);
    const ids = [...new Set(topHits.map((h) => h.sessionId))];
    if (ids.length === 1) return { ok: ids[0] };
    if (ids.length > 1) {
      // Tie-break: a team_map-bound session outranks manually-voiced ones —
      // "go ahead donnie" should reach the team room's Donnie, not whichever
      // scratch session happens to wear the same voice.
      const teamIds = new Set(
        Object.values(loadTeamMap())
          .map((e) => e?.sessionId)
          .filter(Boolean),
      );
      const teamHits = ids.filter((id) => teamIds.has(id));
      if (teamHits.length === 1) return { ok: teamHits[0] };
      const labels = [...new Set(topHits.map((h) => h.label))];
      return { ambiguous: labels };
    }
  }
  return { none: true };
}

export function resolveInjectionTarget(spoken: string): ResolveResult {
  const candidates = buildInjectionCandidates().map((c) => ({
    label: c.label,
    sessionId: c.target,
  }));
  return resolveByName(spoken, candidates);
}

export function resolveDefaultInjectionTarget(): ResolveResult {
  const map = loadTeamMap();
  const personas = Object.keys(map).filter((k) => map[k]?.sessionId);
  if (personas.length === 1) return { ok: personas[0] };
  if (personas.length > 1) {
    return { ambiguous: personas.map((p) => normalizeToken(p)) };
  }
  return { none: true };
}

export function matchGrammar(text: string): Action | null {
  // Phrase table mirrored in shortcuts.ts (VOICE_GRAMMAR_ROWS) — keep in sync.
  let m: RegExpMatchArray | null;

  m = text.match(/^(go ahead|go)(?:\s+(.+))?$/);
  if (m) return { kind: "grant", sessionId: m[2]?.trim() || undefined };

  if (/^(pause|hold on|wait)$/.test(text)) return { kind: "pause" };
  if (/^(resume|continue|keep going)$/.test(text)) return { kind: "pause" };
  if (/^(stop|enough|shut up)$/.test(text)) return { kind: "stop" };
  if (/^(cancel|cancel that|never ?mind)$/.test(text)) {
    return { kind: "cancel_inject" };
  }

  m = text.match(/^hold (?:the )?room(?:\s+for\s+(\d+)\s+minutes?)?$/);
  if (m) return { kind: "hold_room", minutes: m[1] ? Number(m[1]) : undefined };
  if (/^(release|open) (?:the )?room$/.test(text)) return { kind: "release_room" };

  if (/^(say (that )?again|repeat|again) slower$/.test(text)) {
    return { kind: "replay", speed: 0.85 };
  }
  if (/^(say (that )?again|repeat|again)$/.test(text)) return { kind: "replay" };
  if (/^status$/.test(text) || /^who(?:'s| is) (?:up|waiting)/.test(text)) {
    return { kind: "status" };
  }

  m = text.match(/^(focus|arcade|quiet|normal) mode$/);
  if (m) return { kind: "mood", preset: m[1] };

  m = text.match(/^(mute|unmute)\s+(.+)$/);
  if (m) {
    const verb = m[1] as "mute" | "unmute";
    return { kind: verb, sessionId: m[2].trim() };
  }

  m = text.match(/^(?:clear|never ?mind|skip)\s+(.+)$/);
  if (m) return { kind: "clear", sessionId: m[1].trim() };

  m = text.match(/^(?:tell|talk to|ask|hey)\s+([\w-]+),?\s+(.+)$/);
  if (m) return { kind: "inject", target: m[1].trim(), message: m[2].trim() };

  m = text.match(/^run the ([\w-]+) (?:slash )?command(?: for (.+))?$/);
  if (m) {
    return {
      kind: "slash_command",
      command: m[1],
      target: m[2]?.trim() || undefined,
    };
  }

  return null;
}

/**
 * Zero-cost rule path. `boundTarget` is the default target for later
 * inject fallback — bare commands still match here (the arcade-waste fix).
 */
export function matchIntent(transcript: string, _ctx: RouterContext = {}): Action | null {
  const text = applyAliases(normalizeTranscript(transcript));
  return matchGrammar(text);
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

/** Status phrase for the `status` action (shared by voice CLI + coordinator). */
export function composeStatus(): string {
  const muted = new Set(loadMutedSessions());
  const hands: Array<{ name: string; wait: string }> = [];
  const working: string[] = [];
  let speaking: string | null = null;

  if (existsSync(STATE_DIR)) {
    for (const f of readdirSync(STATE_DIR)) {
      if (!f.endsWith(".json")) continue;
      try {
        const s = JSON.parse(readFileSync(join(STATE_DIR, f), "utf-8")) as {
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
            : h.name,
      )
      .join(", and ");
    const head =
      hands.length === 1 ? "One hand up" : `${COUNT_WORDS[hands.length] ?? hands.length} hands up`;
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

/** Errors are SPOKEN — never read a raw sessionId/UUID aloud. */
export function speakableName(target: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}/i.test(target)) return target;
  try {
    const p = join(STATE_DIR, `${target}.json`);
    if (existsSync(p)) {
      const name = JSON.parse(readFileSync(p, "utf-8"))?.name;
      if (name) return String(name);
    }
  } catch {
    /* ignore */
  }
  for (const [persona, entry] of Object.entries(loadTeamMap())) {
    if (entry?.sessionId === target) return persona;
  }
  return "that session";
}
