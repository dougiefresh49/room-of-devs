/**
 * Command service — the single place client intents become daemon actions.
 *
 * WS (panel-ws.ts) and HTTP (mobile-http.ts) are thin transport adapters over
 * this service; neither owns validation, capability policy, or dispatch.
 * The service is DOMAIN-shaped, not panel-action-shaped: `voice.ts`/PTT are
 * the documented eventual callers (the conversational interpreter in
 * docs/design-conversational-layer.md routes through here too) — their
 * migration can be lazy, but new capabilities land here, not in a transport.
 *
 * Credit-guard invariants preserved verbatim from the pre-refactor panel-ws:
 * mobile allowlist is server-authoritative; grant supersede refuses while a
 * phone grant is mid-synthesis; spawn validation rejects before any script
 * runs; reply marks the phone-ack BEFORE injecting.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawn, spawnSync } from "child_process";
import { TTS_DIR, FAILED_DIR } from "../config.js";
import { buildPanelSnapshotFresh, buildSnapshot, sessionStateAgeMs } from "../state-watch.js";
import { log } from "../logger.js";
import {
  isTeamSession,
  tmuxForSession,
  removeSessionFromTeamMap,
  loadTeamMap,
} from "../team-map.js";
import { purgeSessionQueue, recomputeAfterPlayback, cleanupSession, isSdkCard } from "../state.js";
import { runStatusSay } from "../status-say.js";
import { isResumableSession, knownDirs } from "../session-catalog.js";
import { startPlayReplay } from "../audio.js";
import {
  isUnexpiredPhoneGrant,
  supersedePhoneGrant,
  markPhonePlaybackDone,
} from "../now-playing.js";
import {
  setLiveSession,
  setLiveMuted,
  markPendingPhoneAck,
  clearPendingPhoneAck,
} from "../live-mode.js";
import { sendT3Reply, t3ReplyProvisioned, type T3ReplyFailureCode } from "../t3-reply.js";
import {
  parseCommand,
  isKnownCommandType,
  type Command,
  type CommandSource,
  type ButtonPatch,
  type SpawnModel,
} from "../protocol/index.js";

import { CHARACTERS_PATH } from "../characters-path.js";
const SCRIPTS_DIR = join(TTS_DIR, "scripts");
const SERVER_DIR = join(TTS_DIR, "tts-server");
export const HOLD_ROOM_FILE = join(TTS_DIR, ".hold-room.json");

export type PanelMessage = Command;
export type { ButtonPatch };

function safe(fn: () => void): void {
  try {
    fn();
  } catch (err: any) {
    log("commands", `handler error: ${err?.message ?? err}`);
  }
}

// ── Notice bus ──────────────────────────────────────────────────────────
// Service-owned; transports subscribe (panel-ws broadcasts to WS clients,
// mobile-http to SSE). The service never knows who is listening.

type NoticeSink = (msg: { type: "notice"; message: string }) => void;
const noticeSinks = new Set<NoticeSink>();

export function onNotice(cb: NoticeSink): () => void {
  noticeSinks.add(cb);
  return () => {
    noticeSinks.delete(cb);
  };
}

export function emitNotice(message: string): void {
  const msg = { type: "notice" as const, message };
  for (const sink of noticeSinks) {
    safe(() => sink(msg));
  }
}

// ── Script execution layer ──────────────────────────────────────────────

function scriptEnv(): NodeJS.ProcessEnv {
  return { ...process.env, TTS_DIR };
}

/**
 * The daemon holds ELEVENLABS_API_KEY / GEMINI_API_KEY; a spawned agent is a
 * different trust domain and must not inherit them (nor anything else we
 * didn't decide to hand over). Only the variables a shell + tmux + the claude
 * CLI genuinely need are copied through — everything else is dropped.
 */
const SPAWN_ENV_PASSTHROUGH = ["PATH", "HOME", "USER", "SHELL", "LANG", "TMPDIR", "TERM"] as const;

function minimalSpawnEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { TTS_DIR };
  for (const key of SPAWN_ENV_PASSTHROUGH) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

/**
 * Speak an arbitrary agent message on demand (chat-bubble "generate" tap).
 * BILLABLE (one Gemini + one ElevenLabs call) — explicit user tap only.
 * The item is staged OUTSIDE queue/ so the watcher never sees it (no
 * auto-play race, no phantom hand-raise) and handed to play_node.sh, the same
 * once-play machinery grants use: session voice, stream lock, replay save.
 */
function speakTextNow(sessionId: string, text: string, output?: "mac" | "phone"): void {
  try {
    const stageDir = join(TTS_DIR, "say");
    mkdirSync(stageDir, { recursive: true });
    const name =
      buildSnapshot().find((a) => a.sessionId === sessionId)?.name ?? sessionId.slice(0, 12);
    const path = join(stageDir, `${Date.now()}-say-${sessionId.slice(0, 12)}.json`);
    const item = {
      text,
      conversation_id: sessionId,
      generation_id: "",
      model: "",
      timestamp: String(Math.floor(Date.now() / 1000)),
      thread_title: name,
      spoken: false,
      source: "say",
    };
    writeFileSync(path, JSON.stringify(item, null, 2));
    log(
      "commands",
      `speak_text: ${sessionId.slice(0, 12)} (${text.length} chars, ${output ?? "mac"})`,
    );
    runScript("play_node.sh", [path], output === "phone" ? { CR_OUTPUT: "phone" } : undefined);
  } catch (err: any) {
    log("commands", `speak_text failed: ${err?.message ?? err}`);
  }
}

export function runScript(name: string, args: string[], extraEnv?: Record<string, string>): void {
  try {
    const child = spawn(join(SCRIPTS_DIR, name), args, {
      stdio: "ignore",
      env: { ...scriptEnv(), ...extraEnv },
    });
    child.on("error", (e) => log("commands", `${name} spawn error: ${e.message}`));
  } catch (err: any) {
    log("commands", `${name} spawn failed: ${err?.message ?? err}`);
  }
}

/** Fire-and-forget with exit code + stderr tail for spawn failure notices. */
function runScriptCaptured(
  name: string,
  args: string[],
  onDone: (code: number | null, stderrTail: string) => void,
  extraEnv?: Record<string, string>,
  baseEnv: NodeJS.ProcessEnv = scriptEnv(),
): void {
  try {
    const child = spawn(join(SCRIPTS_DIR, name), args, {
      stdio: ["ignore", "ignore", "pipe"],
      env: { ...baseEnv, ...extraEnv },
    });
    const chunks: Buffer[] = [];
    let total = 0;
    child.stderr?.on("data", (c: Buffer) => {
      const buf = Buffer.isBuffer(c) ? c : Buffer.from(c);
      chunks.push(buf);
      total += buf.length;
      while (total > 8_000 && chunks.length > 1) {
        total -= chunks.shift()!.length;
      }
    });
    child.on("error", (e) => {
      log("commands", `${name} spawn error: ${e.message}`);
      onDone(null, e.message);
    });
    child.on("close", (code) => {
      const stderrTail = Buffer.concat(chunks).toString("utf-8").trim().slice(-500);
      onDone(code, stderrTail);
    });
  } catch (err: any) {
    log("commands", `${name} spawn failed: ${err?.message ?? err}`);
    onDone(null, String(err?.message ?? err));
  }
}

/** spawnSync blocks the whole event loop — a wedged child freezes every WS/
 *  HTTP request (2026-07-23: a hung `tmux send-keys` inside inject_prompt.sh
 *  froze the daemon for 10+ minutes). Every sync run gets a hard timeout. */
const SYNC_SCRIPT_TIMEOUT_MS = 10_000;

export function runScriptSync(name: string, args: string[]): boolean {
  try {
    const result = spawnSync(join(SCRIPTS_DIR, name), args, {
      stdio: "ignore",
      env: scriptEnv(),
      timeout: SYNC_SCRIPT_TIMEOUT_MS,
      killSignal: "SIGKILL",
    });
    if (result.error) log("commands", `${name} sync run error: ${result.error.message}`);
    return result.status === 0;
  } catch (err: any) {
    log("commands", `${name} sync spawn failed: ${err?.message ?? err}`);
    return false;
  }
}

/** Sync script run that surfaces the exit status (for reply mapping). */
function runScriptSyncStatus(name: string, args: string[]): number | null {
  try {
    const result = spawnSync(join(SCRIPTS_DIR, name), args, {
      stdio: "ignore",
      env: scriptEnv(),
      timeout: SYNC_SCRIPT_TIMEOUT_MS,
      killSignal: "SIGKILL",
    });
    if (result.error) {
      log("commands", `${name} sync run error: ${result.error.message}`);
      return null;
    }
    return result.status;
  } catch (err: any) {
    log("commands", `${name} sync spawn failed: ${err?.message ?? err}`);
    return null;
  }
}

function runSignalReplay(speed?: number, sessionId?: string): void {
  try {
    const args = ["exec", "tsx", "src/signal.ts", "replay", "", "1"];
    if (speed != null || sessionId) args.push(String(speed ?? 1.0));
    if (sessionId) args.push(sessionId);
    const child = spawn("pnpm", args, { cwd: SERVER_DIR, stdio: "ignore" });
    child.on("error", (e) => log("commands", `signal replay spawn error: ${e.message}`));
  } catch (err: any) {
    log("commands", `signal replay spawn failed: ${err?.message ?? err}`);
  }
}

// ── Character / persona helpers ─────────────────────────────────────────

function loadCharactersMap(): Record<string, { name?: string }> {
  if (!existsSync(CHARACTERS_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CHARACTERS_PATH, "utf-8")) as Record<string, { name?: string }>;
  } catch {
    return {};
  }
}

export function listCharacterNames(): string[] {
  const names = new Set<string>();
  for (const entry of Object.values(loadCharactersMap())) {
    const n = entry?.name?.trim();
    if (n) names.add(n);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

export function resolveVoiceIdForCharacter(character: string): string | null {
  const lower = character.toLowerCase();
  for (const [voiceId, entry] of Object.entries(loadCharactersMap())) {
    if (entry?.name?.toLowerCase() === lower) return voiceId;
  }
  return null;
}

export function resolvePersonaName(persona: string): string | null {
  const lower = persona.trim().toLowerCase();
  for (const name of listCharacterNames()) {
    if (name.toLowerCase() === lower) return name;
  }
  return null;
}

export function sanitizeNickname(label: string): string | null {
  const s = label.replace(/[\x00-\x1f\x7f]/g, "").trim();
  if (!s) return null;
  return s.slice(0, 24);
}

// ── Validation ──────────────────────────────────────────────────────────

export function sessionInSnapshot(sessionId: string): boolean {
  // Authorization check — always fresh, never the memoized snapshot (grant/
  // reply against a just-removed session must fail like it always did).
  return buildPanelSnapshotFresh().agents.some((a) => a.sessionId === sessionId);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function isOptionalString(v: unknown): v is string | undefined {
  return v === undefined || typeof v === "string";
}

function isOptionalNullableString(v: unknown): v is string | null | undefined {
  return v === undefined || v === null || typeof v === "string";
}

export function parseButtonPatch(raw: unknown): ButtonPatch | "bad_message" {
  if (!isPlainObject(raw)) return "bad_message";
  const keys = Object.keys(raw);
  const allowed = new Set(["name", "character", "action", "hold_action", "color", "notes"]);
  if (keys.length === 0 || keys.some((k) => !allowed.has(k))) return "bad_message";
  const patch = raw as Record<string, unknown>;
  if (
    !isOptionalString(patch.name) ||
    !isOptionalNullableString(patch.character) ||
    !isOptionalNullableString(patch.action) ||
    !isOptionalNullableString(patch.hold_action) ||
    !isOptionalNullableString(patch.color) ||
    !isOptionalNullableString(patch.notes)
  ) {
    return "bad_message";
  }
  if (
    typeof patch.character === "string" &&
    patch.character.length > 0 &&
    typeof patch.action === "string" &&
    patch.action.length > 0
  ) {
    return "bad_message";
  }
  return {
    name: patch.name,
    character: patch.character,
    action: patch.action,
    hold_action: patch.hold_action,
    color: patch.color,
    notes: patch.notes,
  };
}

export interface CommandEnvelope {
  requestId: string | null;
  source: CommandSource | null;
  body: unknown;
}

/**
 * Additive envelope (Phase 0): accept and strip `requestId`/`source` before
 * the strict key-counting validator sees the message. `source` is
 * reservation-only. Invalid envelope values are NOT stripped — they stay on
 * the body so strict validation rejects them exactly as it always did.
 */
export function splitCommandEnvelope(raw: unknown): CommandEnvelope {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { requestId: null, source: null, body: raw };
  }
  const record = raw as Record<string, unknown>;
  if (record.requestId === undefined && record.source === undefined) {
    return { requestId: null, source: null, body: raw };
  }
  const validRequestId = typeof record.requestId === "string" && record.requestId.length > 0;
  const validSource =
    record.source === "desktop" ||
    record.source === "mobile" ||
    record.source === "voice" ||
    record.source === "interpreter";
  if (
    (record.requestId !== undefined && !validRequestId) ||
    (record.source !== undefined && !validSource)
  ) {
    return { requestId: null, source: null, body: raw };
  }
  const { requestId, source, ...body } = record;
  return {
    requestId: validRequestId ? (requestId as string) : null,
    source: validSource ? (source as CommandSource) : null,
    body,
  };
}

/**
 * A spawn dir must exist AND be one the room already knows (the same list the
 * picker offers). Without the allowlist, anyone who reached /action could
 * start a permissionless agent anywhere on disk — "is a directory" is not an
 * authorization check. Compared realpath'd so symlinks/`..` can't smuggle a
 * different target past a matching string.
 */
function isValidDir(dir: string): boolean {
  try {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return false;
    const canon = realpathSync(dir);
    return knownDirs().some((known) => {
      try {
        return realpathSync(known) === canon;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

/**
 * Wire-contract validation — protocol parseCommand is authoritative
 * (audit Q-1 / R8). Known kinds that fail validation are logged (Q-3);
 * unknown kinds stay silent so the contract can grow additively.
 */
export function validatePanelMessage(raw: unknown): PanelMessage | "bad_message" {
  const parsed = parseCommand(raw);
  if (parsed) return parsed;
  const type =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as { type?: unknown }).type
      : undefined;
  if (isKnownCommandType(type)) {
    log("commands", `malformed command dropped: ${type}`);
  }
  return "bad_message";
}

// ── Spawn / resume ──────────────────────────────────────────────────────

/** In-flight spawn reservations — persona lowercased. Cleared on child exit. */
const pendingPersonas = new Set<string>();

function tmuxExists(tmuxName: string): boolean {
  try {
    return (
      spawnSync("tmux", ["has-session", "-t", `=${tmuxName}`], {
        stdio: "ignore",
        timeout: 3_000,
        killSignal: "SIGKILL",
      }).status === 0
    );
  } catch {
    return false;
  }
}

/** A room card whose state file hasn't been touched by any hook for this
 *  long is a ghost (session died without SessionEnd) — it must not hold its
 *  persona hostage. Mirrors state-watch's 90-min working→idle demotion. */
const GHOST_SESSION_MS = 90 * 60 * 1000;

/** Persona already live in room / team_map / pending / tmux — sync reject. */
function personaBusyReason(persona: string): string | null {
  const key = persona.toLowerCase();
  if (pendingPersonas.has(key)) {
    return `${persona} is already in the room`;
  }
  for (const agent of buildSnapshot()) {
    if (agent.character?.toLowerCase() !== key) continue;
    // Team sessions are adjudicated by the tmux liveness checks below —
    // a team card with dead tmux is a ghost, not a conflict.
    if (agent.isTeam) continue;
    const age = sessionStateAgeMs(agent.sessionId);
    if (age !== null && age > GHOST_SESSION_MS) {
      log(
        "commands",
        `ignoring stale room card for ${persona} (${agent.sessionId.slice(0, 12)}, idle ${Math.round(age / 60000)}m)`,
      );
      continue;
    }
    return `${persona} is already in the room`;
  }
  const team = loadTeamMap();
  for (const [p, entry] of Object.entries(team)) {
    if (p.toLowerCase() !== key) continue;
    if (entry?.tmux && tmuxExists(entry.tmux)) {
      return `${persona} is already in the room`;
    }
  }
  if (tmuxExists(`cr-${persona}`)) {
    return `${persona} is already in the room`;
  }
  return null;
}

/** Launch-flag toggles from the picker; undefined = default on. */
export interface SpawnOpts {
  remoteControl?: boolean;
  skipPermissions?: boolean;
  model?: SpawnModel;
}

/** Aliases accepted by `claude --model`; absent/empty = CLI default. */
const SPAWN_MODELS = new Set(["fable", "opus", "sonnet", "haiku"]);

function validSpawnFlags(msg: Record<string, unknown>): boolean {
  return (
    (msg.remoteControl === undefined || typeof msg.remoteControl === "boolean") &&
    (msg.skipPermissions === undefined || typeof msg.skipPermissions === "boolean") &&
    (msg.model === undefined || (typeof msg.model === "string" && SPAWN_MODELS.has(msg.model)))
  );
}

export function spawnFlags(msg: Record<string, unknown>): SpawnOpts {
  return {
    ...(typeof msg.remoteControl === "boolean" ? { remoteControl: msg.remoteControl } : {}),
    ...(typeof msg.skipPermissions === "boolean" ? { skipPermissions: msg.skipPermissions } : {}),
    // validSpawnFlags already vetted membership in SPAWN_MODELS.
    ...(typeof msg.model === "string" ? { model: msg.model as SpawnModel } : {}),
  };
}

function spawnTeam(
  persona: string,
  dir: string,
  resumeSessionId?: string,
  opts: SpawnOpts = {},
): void {
  const key = persona.toLowerCase();
  pendingPersonas.add(key);
  const args = resumeSessionId ? [persona, dir, "--resume", resumeSessionId] : [persona, dir];
  const extraEnv = {
    CR_REMOTE_CONTROL: opts.remoteControl === false ? "0" : "1",
    // Permissionless agents are opt-IN: only an explicit `true` from the
    // picker skips prompts. An absent/garbled flag must never widen power.
    CR_SKIP_PERMISSIONS: opts.skipPermissions === true ? "1" : "0",
    CR_MODEL: opts.model ?? "",
  };
  runScriptCaptured(
    "team.sh",
    args,
    (code, stderrTail) => {
      pendingPersonas.delete(key);
      if (code === 0) return;
      const detail = stderrTail.split("\n").filter(Boolean).pop() || `exit ${code ?? "?"}`;
      const msg =
        code === 2 ? `${persona} is already in the room` : `Couldn't start ${persona}: ${detail}`;
      log("commands", `team.sh failed for ${persona}: ${detail}`);
      emitNotice(msg);
    },
    extraEnv,
    minimalSpawnEnv(),
  );
}

export type SpawnValidateResult = "ok" | "bad_dir" | "bad_persona" | "bad_session" | "persona_busy";

export function validateAndSpawn(
  dir: string,
  persona: string,
  opts: SpawnOpts = {},
): SpawnValidateResult {
  if (!isValidDir(dir)) return "bad_dir";
  const canon = resolvePersonaName(persona);
  if (!canon) return "bad_persona";
  const busy = personaBusyReason(canon);
  if (busy) {
    emitNotice(busy);
    return "persona_busy";
  }
  spawnTeam(canon, dir, undefined, opts);
  return "ok";
}

export function validateAndResume(
  sessionId: string,
  dir: string,
  persona: string,
  opts: SpawnOpts = {},
): SpawnValidateResult {
  if (!isValidDir(dir)) return "bad_dir";
  const canon = resolvePersonaName(persona);
  if (!canon) return "bad_persona";
  if (!isResumableSession(sessionId)) return "bad_session";
  const busy = personaBusyReason(canon);
  if (busy) {
    emitNotice(busy);
    return "persona_busy";
  }
  spawnTeam(canon, dir, sessionId, opts);
  return "ok";
}

// ── Reply (phone → tmux/T3) ─────────────────────────────────────────────

// A T3 dispatch may cold-start the SDK session before its UserPromptSubmit
// fires, well past the ~1s tmux-inject path. Hold the phone-ack marker long
// enough to cover that (still one-shot: consumed by the next UPS for the
// session, and never re-armed).
const T3_REPLY_ACK_FRESH_MS = 5 * 60_000;

export type ReplyStatus = "ok" | "not_in_team" | "pane_not_ready" | "failed" | T3ReplyFailureCode;

interface ValidReply {
  sessionId: string;
  text: string;
}

function validateReply(raw: unknown): ValidReply | null {
  raw = splitCommandEnvelope(raw).body;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const msg = raw as Record<string, unknown>;
  if (msg.type !== "reply") return null;
  if (typeof msg.sessionId !== "string" || !msg.sessionId.trim()) {
    log("commands", "malformed command dropped: reply");
    return null;
  }
  if (typeof msg.text !== "string") {
    log("commands", "malformed command dropped: reply");
    return null;
  }
  const text = msg.text.trim();
  if (!text || text.length > 4000) {
    log("commands", "malformed command dropped: reply");
    return null;
  }
  if (!sessionInSnapshot(msg.sessionId)) return null;
  return { sessionId: msg.sessionId, text };
}

/** Existing team reply path. Keep the marker/inject ordering byte-for-byte. */
function injectTeamReply(msg: ValidReply): { status: ReplyStatus } {
  const text = msg.text;
  // Marker BEFORE injecting: the UserPromptSubmit hook can fire while the
  // inject script is still returning — a late marker would miss the ack (and
  // linger to claim a wrong later prompt). Cleared below if injection fails.
  markPendingPhoneAck(msg.sessionId);
  // Flag MUST be first — inject_prompt.sh only accepts --now as $1.
  const status = runScriptSyncStatus("inject_prompt.sh", ["--now", msg.sessionId, text]);
  if (status === 0) return { status: "ok" };
  clearPendingPhoneAck();
  if (status === 3) return { status: "not_in_team" };
  // 4 = pane isn't running an agent (fell back to a shell / died). Refusing
  // there is the point: the reply would have been executed as a command.
  if (status === 4) return { status: "pane_not_ready" };
  return { status: "failed" };
}

export function handleTeamReplyAction(raw: unknown): { status: ReplyStatus } | null {
  const msg = validateReply(raw);
  if (!msg) return null;
  return injectTeamReply(msg);
}

/** Ordered, exhaustive reply routing. Returns null only for malformed input. */
export async function handleReplyAction(raw: unknown): Promise<{ status: ReplyStatus } | null> {
  const msg = validateReply(raw);
  if (!msg) return null;

  if (isTeamSession(msg.sessionId)) return injectTeamReply(msg);

  if (isSdkCard(msg.sessionId) && t3ReplyProvisioned()) {
    // Same credit guard as tmux inject: the turn's UserPromptSubmit must
    // consume a cached phone ack instead of spending Gemini + ElevenLabs. T3
    // may cold-start the session before UPS fires, so the marker gets a longer
    // freshness window than the ~1s tmux path.
    if (!markPendingPhoneAck(msg.sessionId, T3_REPLY_ACK_FRESH_MS)) {
      // No marker written → a successful dispatch would bill a dynamic
      // response. Refuse rather than risk it.
      return { status: "t3_unreachable" };
    }
    try {
      const result = await sendT3Reply(msg.sessionId, msg.text);
      if (result.ok) return { status: "ok" };
      // Keep the marker when the dispatch MIGHT have landed (network/timeout at
      // or after the POST) — the turn could still run and hit UPS. Only clear
      // on a failure proven to be before/at a rejected dispatch.
      if (!result.ambiguous) clearPendingPhoneAck();
      return { status: result.code };
    } catch {
      // sendT3Reply never throws, but if it somehow did we can't prove the
      // dispatch didn't land — keep the marker.
      return { status: "t3_unreachable" };
    }
  }

  if (isSdkCard(msg.sessionId)) return { status: "not_provisioned" };
  return { status: "not_in_team" };
}

// ── Terminal / team session management ──────────────────────────────────

/** Probe tmux first; on miss, drop stale team_map entry and return false. */
export function focusTerminal(sessionId: string): boolean {
  const tmux = tmuxForSession(sessionId);
  if (!tmux) return false;
  if (!tmuxExists(tmux)) {
    removeSessionFromTeamMap(sessionId);
    log("commands", `focus_terminal: stale tmux ${tmux} — removed team_map entry`);
    return false;
  }
  const script = `tmux attach -t ${tmux.replace(/"/g, '\\"')}`;
  try {
    const child = spawn(
      "osascript",
      [
        "-e",
        `tell app "Terminal" to do script "${script}"`,
        "-e",
        'tell app "Terminal" to activate',
      ],
      { stdio: "ignore" },
    );
    child.on("error", (e) => log("commands", `focus_terminal spawn error: ${e.message}`));
    return true;
  } catch (err: any) {
    log("commands", `focus_terminal failed: ${err?.message ?? err}`);
    return false;
  }
}

export function killTeam(sessionId: string): void {
  const tmux = tmuxForSession(sessionId);
  if (tmux) {
    try {
      spawnSync("tmux", ["kill-session", "-t", `=${tmux}`], {
        stdio: "ignore",
        timeout: 3_000,
        killSignal: "SIGKILL",
      });
    } catch (err: any) {
      log("commands", `kill_team failed: ${err?.message ?? err}`);
    }
  }
  // tmux gone → cleanupSession drops team_map + state + voice.
  purgeSessionQueue(sessionId);
  cleanupSession(sessionId);
}

/**
 * Dismiss a stale raised hand from the phone: move the session's pending
 * queue files to played/ (same dismissed semantics as purgeSessionQueue
 * elsewhere) and recompute the room card so the ✋ clears. Free — no
 * synthesis, no script spawn.
 */
function dismissQueue(sessionId: string): void {
  const moved = purgeSessionQueue(sessionId);
  recomputeAfterPlayback(sessionId);
  log("commands", `dismiss_queue: ${sessionId.slice(0, 12)} (${moved} item(s) moved)`);
}

/**
 * Ack the FAILED badge: move every top-level failed/*.json into
 * failed/acked/ so countFailedItems (state-watch.ts) sees zero, without
 * deleting the record. Best-effort per file, never throws. FAILED_DIR is
 * watched at depth 0 (state-watch.ts startStateWatch); renaming files out of
 * it fires chokidar's "unlink" for each, so the snapshot rebroadcasts on its
 * own — no explicit invalidate needed here.
 */
function clearFailedItems(): void {
  if (!existsSync(FAILED_DIR)) return;
  const ackedDir = join(FAILED_DIR, "acked");
  try {
    mkdirSync(ackedDir, { recursive: true });
  } catch (err: any) {
    log("commands", `clear_failed: couldn't create acked dir: ${err?.message ?? err}`);
    return;
  }
  let moved = 0;
  let entries: string[] = [];
  try {
    entries = readdirSync(FAILED_DIR);
  } catch (err: any) {
    log("commands", `clear_failed: couldn't list ${FAILED_DIR}: ${err?.message ?? err}`);
    return;
  }
  for (const f of entries) {
    if (!f.endsWith(".json")) continue;
    try {
      renameSync(join(FAILED_DIR, f), join(ackedDir, f));
      moved++;
    } catch (err: any) {
      log("commands", `clear_failed: couldn't move ${f}: ${err?.message ?? err}`);
    }
  }
  log("commands", `clear_failed: acked ${moved} item(s)`);
}

// ── Dispatch ────────────────────────────────────────────────────────────

/**
 * Server-authoritative mobile capability allowlist. `reply` is here even
 * though it never reaches `dispatch()` (mobile-http runs it through the
 * dedicated sync path for a real exit code) — one list decides what the phone
 * may do, and the transport consults it via isMobileActionType() first.
 */
const MOBILE_ACTION_TYPES = new Set([
  "reply",
  "grant",
  "replay",
  "replay_slower",
  "replay_session",
  "play_replay",
  "phone_done",
  "pause",
  "stop",
  "hold_room",
  "status_say",
  "spawn_session",
  "resume_session",
  "set_live",
  "set_live_mute",
  "speak_text",
  "dismiss_queue",
  "clear_failed",
]);

/** Transport-facing guard over the allowlist above. */
export function isMobileActionType(type: string): boolean {
  return MOBILE_ACTION_TYPES.has(type);
}

export function dispatch(msg: PanelMessage): void {
  switch (msg.type) {
    case "set_live":
      // Live narration for team (tmux) or SDK-harness (T3) sessions.
      if (msg.on && !(isTeamSession(msg.sessionId) || isSdkCard(msg.sessionId))) {
        emitNotice("Live mode needs a team or T3 session");
        return;
      }
      setLiveSession(msg.sessionId, msg.on, { muted: msg.muted });
      return;
    case "set_live_mute":
      setLiveMuted(msg.sessionId, msg.muted);
      return;
    case "grant":
      runScript(
        "grant_floor.sh",
        [msg.sessionId],
        msg.output === "phone" ? { CR_OUTPUT: "phone" } : undefined,
      );
      return;
    case "ptt":
      runScript("ptt.sh", [msg.phase, msg.sessionId]);
      return;
    case "focus_terminal":
    case "kill_team":
      // Handled by the transport (needs an error reply on stale tmux / a
      // prompt snapshot broadcast) via focusTerminal()/killTeam() above.
      return;
    case "status_say":
      runStatusSay(msg.sessionId);
      return;
    case "speak_text":
      speakTextNow(msg.sessionId, msg.text, msg.output);
      return;
    case "replay":
      runSignalReplay();
      return;
    case "replay_slower":
      runSignalReplay(0.8);
      return;
    case "replay_session":
      runSignalReplay(undefined, msg.sessionId);
      return;
    case "play_replay":
      // Handled synchronously in dispatchPanelAction (lock + file checks).
      return;
    case "phone_done":
      markPhonePlaybackDone(msg.file);
      return;
    case "restart":
      runScript("restart.sh", []);
      return;
    case "stop":
      runScript("stop.sh", []);
      return;
    case "pause":
      runScript("pause.sh", []);
      return;
    case "hold_room":
      if (existsSync(HOLD_ROOM_FILE)) {
        runScript("hold_room.sh", ["off"]);
      } else {
        runScript("hold_room.sh", []);
      }
      return;
    case "dismiss_queue":
      dismissQueue(msg.sessionId);
      return;
    case "clear_failed":
      clearFailedItems();
      return;
  }
}

/** Mobile HTTP whitelist + validate + dispatch. Returns false on reject. */
export function dispatchPanelAction(raw: unknown): boolean {
  // Envelope fields are accepted-and-stripped here too (additive).
  const msg = validatePanelMessage(splitCommandEnvelope(raw).body);
  if (msg === "bad_message") return false;
  if (!MOBILE_ACTION_TYPES.has(msg.type)) return false;

  if (msg.type === "spawn_session") {
    return validateAndSpawn(msg.dir, msg.persona, spawnFlags(msg)) === "ok";
  }
  if (msg.type === "resume_session") {
    return validateAndResume(msg.sessionId, msg.dir, msg.persona, spawnFlags(msg)) === "ok";
  }
  if (msg.type === "play_replay") {
    // Missing file or stream lock held → 400. Free path (no synthesis).
    return startPlayReplay(msg.file, msg.offsetSec ?? 0);
  }

  if (
    (msg.type === "grant" ||
      msg.type === "status_say" ||
      msg.type === "speak_text" ||
      msg.type === "dismiss_queue") &&
    !sessionInSnapshot(msg.sessionId)
  ) {
    return false;
  }

  // An explicit grant supersedes an active phone grant (paused mid-message,
  // tapped another agent). Refused only while the old grant is mid-synthesis.
  if (msg.type === "grant" && isUnexpiredPhoneGrant()) {
    if (!supersedePhoneGrant()) {
      log("commands", "refusing grant — phone grant still synthesizing");
      return false;
    }
    log("commands", "superseding active phone grant");
  }

  dispatch(msg);
  return true;
}
