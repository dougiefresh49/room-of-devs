#!/usr/bin/env tsx
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

type LiveEntry = {
  on: boolean;
  since: string;
  toolCount: number;
  turnStartedAt: string | null;
  lastActivity: { label: string; at: string } | null;
  muted: boolean;
  lastEmitAt: string | null;
};
type LiveMap = Record<string, LiveEntry>;
type NowPlaying = {
  sessionId?: string;
  text?: string;
  startedAt?: string;
  endedAt?: string;
  kind?: string;
  grantId?: string;
  synthesisComplete?: boolean;
};

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = resolve(SCRIPT_DIR, "..");
const TTS_DIR =
  process.env.TTS_DIR ?? process.env.TTS_DIR_OVERRIDE ?? join(homedir(), ".cursor", "tts");
const PROJECTS_DIR = join(homedir(), ".claude", "projects");
const TRANSCRIPT_DIR = join(PROJECTS_DIR, "mock-live-harness");
const LIVE_PATH = join(TTS_DIR, "live_sessions.json");
const STATE_DIR = join(TTS_DIR, "state");
const REPLAY_DIR = join(TTS_DIR, "replay");
const NOW_PLAYING_PATH = join(TTS_DIR, ".now-playing.json");
const STREAM_LOCK = join(TTS_DIR, ".stream-lock");
const TEAM_MAP_PATH = join(TTS_DIR, "team_map.json");
const FIXTURES_DIR = join(SERVER_DIR, "fixtures", "live");
const REAL_FRAME_FRESH_MS = 10 * 60_000;

function fail(message: string): never {
  console.error(`mock-live: ${message}`);
  process.exit(1);
}

function atomicWrite(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  renameSync(tmp, path);
}

function readJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function liveMap(): LiveMap {
  const value = readJson<unknown>(LIVE_PATH, {});
  return value && typeof value === "object" ? (value as LiveMap) : {};
}

function requireMockId(id: string | undefined): string {
  if (!id?.startsWith("mock-") || !/^[a-zA-Z0-9_-]+$/.test(id)) {
    fail("session id must be a mock-* identifier");
  }
  return id;
}

function transcriptPath(id: string): string {
  return join(TRANSCRIPT_DIR, `${id}.jsonl`);
}

function isMockFrame(frame: NowPlaying): boolean {
  return (
    frame.sessionId?.startsWith("mock-") === true && frame.grantId?.startsWith("mock-") === true
  );
}

function realFrameIsFresh(frame: NowPlaying): boolean {
  if (isMockFrame(frame) || frame.endedAt) return false;
  if (frame.synthesisComplete === false) return true;
  const started = Date.parse(frame.startedAt ?? "");
  return (
    Number.isFinite(started) &&
    Date.now() - started >= 0 &&
    Date.now() - started < REAL_FRAME_FRESH_MS
  );
}

function assertNoRealNowPlaying(): void {
  if (!existsSync(NOW_PLAYING_PATH)) return;
  const frame = readJson<NowPlaying | null>(NOW_PLAYING_PATH, null);
  if (!frame) fail("refusing now-playing mutation: existing frame is unreadable");
  if (realFrameIsFresh(frame)) {
    fail(
      `refusing now-playing mutation: fresh non-mock frame belongs to ${frame.sessionId ?? "unknown"}`,
    );
  }
}

function acquireHarnessLock(): void {
  try {
    writeFileSync(STREAM_LOCK, String(process.pid), { flag: "wx" });
  } catch {
    fail("refusing stream: stream lock exists");
  }
}

function releaseHarnessLock(): void {
  try {
    if (readFileSync(STREAM_LOCK, "utf8").trim() === String(process.pid)) unlinkSync(STREAM_LOCK);
  } catch {}
}

function commandUp(args: string[]): void {
  let sdk = false;
  const nameParts: string[] = [];
  for (const a of args) {
    if (a === "--sdk") sdk = true;
    else nameParts.push(a);
  }
  const name = nameParts.join(" ").trim();
  const id = `mock-${Date.now()}-${process.pid}`;
  const now = new Date().toISOString();
  mkdirSync(STATE_DIR, { recursive: true });
  mkdirSync(TRANSCRIPT_DIR, { recursive: true });
  const card: Record<string, unknown> = {
    sessionId: id,
    name: name || "Mock Live",
    state: "working",
    raisedAt: null,
    updatedAt: now,
  };
  if (sdk) card.sdk = true;
  atomicWrite(join(STATE_DIR, `${id}.json`), card);
  writeFileSync(transcriptPath(id), "", { flag: "wx" });
  const map = liveMap();
  map[id] = {
    on: true,
    since: now,
    toolCount: 0,
    turnStartedAt: now,
    lastActivity: null,
    muted: false,
    lastEmitAt: null,
  };
  atomicWrite(LIVE_PATH, map);
  // Team sessions get a team_map entry so the snapshot marks injectable.
  // SDK (--sdk) mocks a T3-style card: no team_map, sdk:true on the state card.
  if (!sdk) {
    const team = readJson<Record<string, unknown>>(TEAM_MAP_PATH, {});
    team[id] = { tmux: `cr-${id}`, sessionId: id, createdAt: now };
    atomicWrite(TEAM_MAP_PATH, team);
  }
  console.log(id);
}

function updateEntry(idArg: string | undefined, mutate: (entry: LiveEntry) => void): void {
  const id = requireMockId(idArg);
  const map = liveMap();
  const entry = map[id];
  if (!entry?.on) fail(`live session not found: ${id}`);
  mutate(entry);
  atomicWrite(LIVE_PATH, map);
}

function commandActivity(id: string | undefined, labelParts: string[]): void {
  const label = labelParts.join(" ").trim();
  if (!label) fail("activity requires a label");
  updateEntry(id, (entry) => {
    entry.lastActivity = { label, at: new Date().toISOString() };
  });
}

function commandTools(id: string | undefined, rawN: string | undefined): void {
  const n = Number(rawN);
  if (!Number.isSafeInteger(n) || n < 0) fail("tools requires a non-negative integer");
  updateEntry(id, (entry) => {
    entry.toolCount += n;
  });
}

function smallestCachedClip(): string {
  let files: string[] = [];
  try {
    files = readdirSync(REPLAY_DIR).filter((f) => f.endsWith(".mp3") && !f.includes("mock-"));
  } catch {}
  if (!files.length) fail(`no cached replay clips found in ${REPLAY_DIR}`);
  files.sort(
    (a, b) =>
      statSync(join(REPLAY_DIR, a)).size - statSync(join(REPLAY_DIR, b)).size || a.localeCompare(b),
  );
  return join(REPLAY_DIR, files[0]);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function commandStream(idArg: string | undefined, args: string[]): Promise<void> {
  const id = requireMockId(idArg);
  const entry = liveMap()[id];
  if (!entry?.on || !existsSync(join(STATE_DIR, `${id}.json`)))
    fail(`live session not found: ${id}`);
  if (entry.muted === true) fail(`live session is muted: ${id} (unmute before streaming)`);
  let output: "phone" | "mac" = "phone";
  let rate = 16_000;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--output" && (args[i + 1] === "phone" || args[i + 1] === "mac"))
      output = args[++i] as typeof output;
    else if (
      args[i] === "--rate" &&
      Number.isFinite(Number(args[i + 1])) &&
      Number(args[i + 1]) > 0
    )
      rate = Number(args[++i]);
    else fail(`unknown stream option: ${args[i]}`);
  }
  assertNoRealNowPlaying();
  acquireHarnessLock();
  let partPath = "";
  let sidecarPath = "";
  let ownsFrame = false;
  try {
    assertNoRealNowPlaying();
    const source = smallestCachedClip();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `${stamp}_${id}_mock-live.mp3`;
    const finalPath = join(REPLAY_DIR, filename);
    partPath = `${finalPath}.part`;
    sidecarPath = finalPath.replace(/\.mp3$/, ".json");
    mkdirSync(REPLAY_DIR, { recursive: true });
    const meta = {
      source: "mock-live",
      sessionId: id,
      sessionName:
        readJson<{ name?: string }>(join(STATE_DIR, `${id}.json`), {}).name ?? "Mock Live",
      textPreview: "Cached audio — mock live stream",
      spokenText: "Cached audio — mock live stream",
      rawText: "Cached audio — mock live stream",
      timestamp: new Date().toISOString(),
      playbackRate: 1,
      kind: "live",
    };
    atomicWrite(sidecarPath, meta);
    const startedAt = new Date().toISOString();
    const grantId = `mock-${stamp}`;
    const frame = {
      sessionId: id,
      text: meta.spokenText,
      rawText: meta.rawText,
      startedAt,
      approxCharsPerSec: 15,
      kind: "live",
      playbackRate: 1,
      output,
      replayFile: filename,
      grantId,
      synthesisComplete: false,
    };
    atomicWrite(NOW_PLAYING_PATH, frame);
    ownsFrame = true;
    const input = readFileSync(source);
    const fd = openSync(partPath, "wx");
    try {
      const chunkSize = Math.max(1, Math.ceil(rate / 10));
      for (let offset = 0; offset < input.length; offset += chunkSize) {
        const chunk = input.subarray(offset, Math.min(input.length, offset + chunkSize));
        writeSync(fd, chunk);
        if (offset + chunk.length < input.length) await sleep(100);
      }
    } finally {
      closeSync(fd);
    }
    renameSync(partPath, finalPath);
    partPath = "";
    atomicWrite(NOW_PLAYING_PATH, { ...frame, synthesisComplete: true });
    console.log(`streamed cached ${basename(source)} as ${filename} (${input.length} bytes)`);
  } catch (error) {
    if (partPath) {
      try {
        unlinkSync(partPath);
      } catch {}
    }
    if (sidecarPath) {
      try {
        unlinkSync(sidecarPath);
      } catch {}
    }
    const frame = readJson<NowPlaying | null>(NOW_PLAYING_PATH, null);
    if (ownsFrame && frame?.sessionId === id && isMockFrame(frame)) {
      try {
        unlinkSync(NOW_PLAYING_PATH);
      } catch {}
    }
    throw error;
  } finally {
    releaseHarnessLock();
  }
}

function commandFinal(idArg: string | undefined, textParts: string[]): void {
  const id = requireMockId(idArg);
  const text = textParts.join(" ").trim();
  if (!text) fail("final requires text");
  if (!liveMap()[id]?.on || !existsSync(transcriptPath(id))) fail(`live session not found: ${id}`);
  // A second assistant text would prove the first was intermediate and make
  // the real tailer enqueue it. Keep this command structurally no-spend.
  if (readFileSync(transcriptPath(id), "utf8").trim()) {
    fail("final already appended; refusing a continuation that could enqueue synthesis");
  }
  appendFileSync(
    transcriptPath(id),
    JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text }] },
    }) + "\n",
  );
}

function mockReplayFiles(id?: string): string[] {
  try {
    return readdirSync(REPLAY_DIR).filter((f) => f.includes("mock-") && (!id || f.includes(id)));
  } catch {
    return [];
  }
}

function cleanupOne(id: string): void {
  const map = liveMap();
  if (id in map) {
    delete map[id];
    atomicWrite(LIVE_PATH, map);
  }
  try {
    unlinkSync(join(STATE_DIR, `${id}.json`));
  } catch {}
  try {
    unlinkSync(transcriptPath(id));
  } catch {}
  for (const file of mockReplayFiles(id)) {
    try {
      unlinkSync(join(REPLAY_DIR, file));
    } catch {}
  }
}

function commandDown(target: string | undefined): void {
  const ids = new Set<string>();
  if (target === "--all") {
    for (const id of Object.keys(liveMap())) if (id.startsWith("mock-")) ids.add(id);
    try {
      for (const f of readdirSync(STATE_DIR))
        if (f.startsWith("mock-") && f.endsWith(".json")) ids.add(f.slice(0, -5));
    } catch {}
    try {
      for (const f of readdirSync(TRANSCRIPT_DIR))
        if (f.startsWith("mock-") && f.endsWith(".jsonl")) ids.add(f.slice(0, -6));
    } catch {}
  } else {
    ids.add(requireMockId(target));
  }
  for (const id of ids) cleanupOne(id);
  const team = readJson<Record<string, { sessionId?: string } | undefined>>(TEAM_MAP_PATH, {});
  const teamKeys = Object.keys(team).filter(
    (k) => k.startsWith("mock-") || ids.has(team[k]?.sessionId ?? ""),
  );
  if (teamKeys.length) {
    for (const k of teamKeys) delete team[k];
    atomicWrite(TEAM_MAP_PATH, team);
  }
  if (target === "--all")
    for (const file of mockReplayFiles()) {
      try {
        unlinkSync(join(REPLAY_DIR, file));
      } catch {}
    }
  const frame = readJson<NowPlaying | null>(NOW_PLAYING_PATH, null);
  if (frame && isMockFrame(frame) && (target === "--all" || ids.has(frame.sessionId ?? ""))) {
    try {
      unlinkSync(NOW_PLAYING_PATH);
    } catch {}
  }
  console.log(`removed ${ids.size} mock session(s)`);
}

function normalizeOutput(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\n?$/, "\n");
}

function commandCheckTailer(): void {
  const fixtures = readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith(".jsonl"))
    .sort();
  if (!fixtures.length) fail("no live fixtures found");
  let failures = 0;
  for (const fixture of fixtures) {
    const path = join(FIXTURES_DIR, fixture);
    const result = spawnSync(
      process.execPath,
      [
        join(SERVER_DIR, "node_modules", "tsx", "dist", "cli.mjs"),
        join(SERVER_DIR, "src", "live-tail.ts"),
        "once",
        path,
      ],
      { encoding: "utf8" },
    );
    const actual = normalizeOutput(result.stdout ?? "");
    const expectedPath = path.replace(/\.jsonl$/, ".expected.txt");
    const expected = existsSync(expectedPath)
      ? normalizeOutput(readFileSync(expectedPath, "utf8"))
      : "";
    if (result.status !== 0 || actual !== expected) {
      failures++;
      console.error(`FAIL ${fixture}`);
      if (result.stderr) console.error(result.stderr.trim());
      console.error(`expected:\n${expected}actual:\n${actual}`);
    } else console.log(`PASS ${fixture}`);
  }
  if (failures) fail(`${failures} fixture(s) failed`);
  console.log(`${fixtures.length} live-tail fixture(s) passed`);
}

function usage(): never {
  fail(
    "usage: mock-live.ts up [--sdk] [name] | activity <id> <label> | tools <id> <n> | stream <id> [--output phone|mac] [--rate 16000] | final <id> <text> | down [id|--all] | check-tailer",
  );
}

const [command, ...args] = process.argv.slice(2);
try {
  if (command === "up") commandUp(args);
  else if (command === "activity") commandActivity(args[0], args.slice(1));
  else if (command === "tools") commandTools(args[0], args[1]);
  else if (command === "stream") await commandStream(args[0], args.slice(1));
  else if (command === "final") commandFinal(args[0], args.slice(1));
  else if (command === "down") commandDown(args[0]);
  else if (command === "check-tailer") commandCheckTailer();
  else usage();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
