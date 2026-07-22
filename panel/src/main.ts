import "./tailwind-entry.css";
import "./style.css";
import { initIslands, syncIslands } from "./islands/host";
import { pruneUiState } from "./islands/ui-state";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  LogicalPosition,
  LogicalSize,
  PhysicalPosition,
  PhysicalSize,
  availableMonitors,
  currentMonitor,
  getCurrentWindow,
} from "@tauri-apps/api/window";

// Wire shapes come from the shared protocol package — the panel's old
// partial AgentView copy (which omitted queuedPreview/injectable/live) died
// with Phase 0 of the UI refactor.
import type {
  AgentView,
  Command,
  NowPlaying,
  PanelSnapshot,
  ResumableSession,
  ServerEvent,
  SessionState,
} from "@room/protocol";
// Phase 2: connection, snapshot application ((epoch, rev)-gated), and grant
// optimism live in the shared room-client store; this file keeps its
// renderers and mirrors store state into the module vars they read.
import {
  RoomClient,
  WsTransport,
  isPhoneRoutedFrame,
  nowPlayingKey,
} from "@room/room-client";

type AgentState = SessionState;

interface WsConfig {
  token: string;
  port: number;
}

interface Persona {
  name: string;
  label: string;
  avatar: string;
}

interface ButtonConfig {
  name: string;
  character?: string | null;
  action?: string | null;
  hold_action?: string | null;
  color?: ButtonColor | null;
  notes?: string | null;
}

interface ShortcutSection {
  title: string;
  rows: [string, string][];
}

interface VoiceOption {
  id: string;
  name: string;
  character?: string | null;
}

interface RoomSettings {
  default_voice_id?: string | null;
  playback_mode?: string | null;
  mood?: string | null;
  speed?: number | null;
  notifications?: boolean | null;
  listening?: boolean | null;
  dynamic_acks?: string | null;
}

// name → full character name the server + team.sh match on; avatar → asset dir.
const PERSONAS: Persona[] = [
  { name: "Leonardo", label: "Leo", avatar: "leonardo" },
  { name: "Raphael", label: "Raph", avatar: "raphael" },
  { name: "Donatello", label: "Donnie", avatar: "donatello" },
  { name: "Michelangelo", label: "Mikey", avatar: "michelangelo" },
  { name: "Splinter", label: "Splinter", avatar: "splinter" },
  { name: "Shredder", label: "Shredder", avatar: "shredder" },
  { name: "Karai", label: "Karai", avatar: "karai" },
];

type PickerTab = "new" | "resume";
type SettingsTab = "general" | "buttons" | "help";
type ButtonColor = "white" | "blue" | "red" | "teal" | "yellow" | "green" | "black";
type LearnMode = "rebind" | "add";

const HOLD_MS = 300;
const DOCK_HOVER_LEAVE_MS = 250;
const FULL_MIN_SIZE = new LogicalSize(300, 240);
const DOCK_MIN_SIZE = new LogicalSize(88, 56);
const DOCK_AVATAR_STEP = 44;
const DOCK_PADDING = 54;
const DOCK_EXPAND_WIDTH = 30;
const DOCK_EXPANDED_WIDTH = 520;
const DOCK_COMPACT_HEIGHT = 126;
// Speaker spotlight row (big avatar + always-on actions + bubble) above the pill.
const DOCK_SPOTLIGHT_HEIGHT = 236;
const DOCK_SPOTLIGHT_EXPANDED = 300;
const DOCK_BOTTOM_GAP = 12;
const CAPTIONS_STORAGE_KEY = "roomDockCaptions";
const SUMMARY_PANE_KEY = "roomSummaryPane";
const BUTTON_COLORS: ButtonColor[] = ["white", "blue", "red", "teal", "yellow", "green", "black"];
const LEARN_CAPTURE_MS = 15000;
const PLAYBACK_MODES = ["auto", "announce", "silent"] as const;
const MOODS = ["focus", "arcade", "quiet", "normal"] as const;
const DYNAMIC_ACKS = ["always", "cached", "off"] as const;

type ActionClusterMode = "live" | "summary" | "idle";

const app = document.querySelector<HTMLDivElement>("#app")!;
let connected = false;
let agents: AgentView[] = [];
const staleSessions = new Set<string>();
let dockMode = false;
let savedWindowFrame: { size: PhysicalSize; position: PhysicalPosition } | null = null;
let roomHeld = false;
let triageFocus: string | null = null;
let nowPlaying: NowPlaying | null = null;
let dockCaptions = localStorage.getItem(CAPTIONS_STORAGE_KEY) === "1";
let roomSummaryPane = localStorage.getItem(SUMMARY_PANE_KEY) === "1";
let dockSummaryExpanded = false;
// Bubble the user ✕-ed away; keyed per message so the next one re-appears.
let dockSummaryDismissedKey: string | null = null;
let playbackPaused = false;
let pausedAtWall = 0;
let spotlightEnterKey: string | null = null;
let spotlightEnterUntil = 0;

// Phone-frame helpers + the message identity key now live in room-client's
// selectors (shared with the future mobile SPA). The phone chip itself —
// and its 15s staleness belt — moved into the chips island (host.tsx).
const summaryKey = nowPlayingKey;

let dockHoverSessionId: string | null = null;
let dockHoverHideTimer: ReturnType<typeof setTimeout> | null = null;
let renamingSessionId: string | null = null;

let pickerOpen = false;
let pickerTab: PickerTab = "new";
let settingsOpen = false;
let settingsTab: SettingsTab = "general";
let knownDirsList: string[] = [];
let resumableList: ResumableSession[] = [];
let toast: { kind: "launch" | "error"; text: string } | null = null;
let pickerReturnTimer: ReturnType<typeof setTimeout> | null = null;
let toastClearTimer: ReturnType<typeof setTimeout> | null = null;
let browseDir: string | null = null;
let buttonDeviceHint = "";
let buttonMappings: Record<string, ButtonConfig> = {};
let buttonActions: string[] = [];
let buttonCharacters: string[] = [];
let buttonsLoaded = false;
let buttonsWritable = true;
let settings: RoomSettings = {};
let settingsLoaded = false;
let settingsWritable = true;
let settingsVoices: VoiceOption[] = [];
let voicesLoaded = false;
let shortcutsSections: ShortcutSection[] = [];
let shortcutsLoaded = false;
let shortcutsAvailable = true;
let learnCapture:
  | { mode: LearnMode; oldIdx?: string; armedAt: number; timer: ReturnType<typeof setTimeout> }
  | null = null;

const stateLabels: Record<AgentState, string> = {
  working: "working",
  hand_raised: "hand raised",
  speaking: "speaking",
  idle: "idle",
};

// Transport/cluster glyphs moved to @room/ui components/icons.tsx — only
// the window-chrome + picker icons the legacy templates still emit remain.
const icons = {
  cc: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="3"/><path d="M10 10.5a2 2 0 1 0 0 3"/><path d="M16 10.5a2 2 0 1 0 0 3"/></svg>`,
  dock: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="6" width="14" height="9" rx="4.5"/><path d="m8 18 4 3 4-3"/></svg>`,
  expand: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 14 5-5 5 5"/></svg>`,
  close: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>`,
  gear: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z"/><path d="M19.4 15a1.8 1.8 0 0 0 .36 2l.04.04a2.1 2.1 0 0 1-2.97 2.97l-.04-.04a1.8 1.8 0 0 0-2-.36 1.8 1.8 0 0 0-1.1 1.65V21a2.1 2.1 0 0 1-4.2 0v-.06a1.8 1.8 0 0 0-1.1-1.65 1.8 1.8 0 0 0-2 .36l-.04.04a2.1 2.1 0 1 1-2.97-2.97l.04-.04a1.8 1.8 0 0 0 .36-2 1.8 1.8 0 0 0-1.65-1.1H3a2.1 2.1 0 0 1 0-4.2h.06a1.8 1.8 0 0 0 1.65-1.1 1.8 1.8 0 0 0-.36-2l-.04-.04a2.1 2.1 0 1 1 2.97-2.97l.04.04a1.8 1.8 0 0 0 2 .36h.01a1.8 1.8 0 0 0 1.09-1.65V3a2.1 2.1 0 0 1 4.2 0v.06a1.8 1.8 0 0 0 1.1 1.65 1.8 1.8 0 0 0 2-.36l.04-.04a2.1 2.1 0 1 1 2.97 2.97l-.04.04a1.8 1.8 0 0 0-.36 2 1.8 1.8 0 0 0 1.65 1.1H21a2.1 2.1 0 0 1 0 4.2h-.06a1.8 1.8 0 0 0-1.54.38z"/></svg>`,
  back: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5"/><path d="m11 6-6 6 6 6"/></svg>`,
  folder: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h5l2 2h9a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z"/></svg>`,
} as const;

// Token/port come from Tauri per connection attempt, so a daemon restart
// (which rotates the token) reconnects cleanly. WsTransport tolerates this
// provider rejecting (daemon down → no token file yet).
async function wsUrl(): Promise<string> {
  const config = await invoke<WsConfig>("ws_token");
  return `ws://127.0.0.1:${config.port}/?token=${encodeURIComponent(config.token)}`;
}

const client = new RoomClient(new WsTransport(wsUrl), { source: "desktop" });

function send(msg: Command) {
  client.send(msg);
}

function pendingGrantFor(sessionId: string): boolean {
  return client.getState().pendingGrants.has(sessionId);
}

/** Most recent pending grant — the one the dock spotlight stages. */
function latestPendingGrantSessionId(): string | null {
  let latest: string | null = null;
  for (const sessionId of client.getState().pendingGrants.keys()) latest = sessionId;
  return latest;
}

type MouthFrame = "idle" | "speaking" | "mouth-mid" | "mouth-closed";
type MessageMood = "excited" | "confused" | "neutral";
type MoodFamily = "excited" | "confused";
type ExpressionsManifest = Record<string, Partial<Record<MoodFamily, string>>>;

const MOUTH_FLAP_MS = 120;
const MOUTH_GAP_IDLE_MS = 180;
const MOUTH_LAST_WORD_CAP_MS = 900;
const MOUTH_FALLBACK_FLAP_MS = 140;
const LIPSYNC_TICK_MS = 70;
const BLINK_MS = 130;
const BLINK_MIN_GAP_MS = 3500;
const BLINK_MAX_GAP_MS = 7000;
const BLINK_TICK_MS = 100;

const mouthMidReady = new Map<string, boolean>();
const mouthClosedReady = new Map<string, boolean>();
const blinkReady = new Map<string, boolean>();
/** `${character}:${expr}:${frame}` → loaded successfully */
const exprFrameReady = new Map<string, boolean>();
type MoodSegment = { fromWord: number; mood: MessageMood };
const moodSegmentsBySummary = new Map<string, MoodSegment[]>();
let expressionsManifest: ExpressionsManifest = {};
let lipsyncTimer: ReturnType<typeof setInterval> | null = null;
let lipsyncAnchor: { startedAt: string | number; t0: number } | null = null;
let lipsyncSessionKey: string | null = null;
let blinkTimer: ReturnType<typeof setInterval> | null = null;
/** sessionId → wall time when the current blink frame should end */
const blinkUntil = new Map<string, number>();
/** sessionId → wall time of next blink attempt */
const nextBlinkAt = new Map<string, number>();

const EXCITED_RE = /\b(awesome|amazing|perfect|crushed|nailed|shipped it|boom)\b/i;
const CONFUSED_RE = /\b(hmm|not sure|strange|weird|unexpected|can't figure|confused)\b/i;
const ALL_CAPS_WORD_RE = /\b[A-Z]{4,}\b/;

function classifyMood(text: string): MessageMood {
  const bangs = (text.match(/!/g) ?? []).length;
  const ques = (text.match(/\?/g) ?? []).length;
  if (bangs >= 2 || ALL_CAPS_WORD_RE.test(text) || EXCITED_RE.test(text)) return "excited";
  if (ques > bangs || CONFUSED_RE.test(text)) return "confused";
  return "neutral";
}

// Sentence-level mood: character rewrites (Mikey!) are wall-to-wall "!", so a
// whole-message classification pins the excited face for the full duration —
// classify per sentence and map segments onto the word alignment instead.
function classifySentence(sent: string): MessageMood {
  const bangs = (sent.match(/!/g) ?? []).length;
  const ques = (sent.match(/\?/g) ?? []).length;
  if (bangs >= 2 || ALL_CAPS_WORD_RE.test(sent) || EXCITED_RE.test(sent)) return "excited";
  if ((ques > 0 && ques >= bangs) || CONFUSED_RE.test(sent)) return "confused";
  return "neutral";
}

function buildMoodSegments(np: NowPlaying): MoodSegment[] {
  // Segment the SPOKEN text — that's what the word alignment indexes into.
  const text = (np.text ?? "").trim();
  if (!text) return [{ fromWord: 0, mood: "neutral" }];
  const sentences = text.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) ?? [text];
  const segs: MoodSegment[] = [];
  let word = 0;
  for (const sent of sentences) {
    const n = sent.trim().split(/\s+/).filter(Boolean).length;
    if (!n) continue;
    segs.push({ fromWord: word, mood: classifySentence(sent) });
    word += n;
  }
  return segs.length ? segs : [{ fromWord: 0, mood: classifyMood(text) }];
}

function moodSegments(np: NowPlaying): MoodSegment[] {
  const key = summaryKey(np);
  let segs = moodSegmentsBySummary.get(key);
  if (!segs) {
    segs = buildMoodSegments(np);
    moodSegmentsBySummary.set(key, segs);
  }
  return segs;
}

function currentWordIndex(np: NowPlaying): number {
  const al = np.alignment;
  if (!al?.length) return 0;
  const ms = alignmentAudioMs(np);
  let idx = 0;
  for (let i = 0; i < al.length; i++) {
    if (al[i][1] <= ms) idx = i;
    else break;
  }
  return idx;
}

function moodAtNow(np: NowPlaying): MessageMood {
  if (np.kind === "ack") return "neutral";
  const segs = moodSegments(np);
  if (segs.length === 1 || !np.alignment?.length) return segs[0].mood;
  const w = currentWordIndex(np);
  let mood = segs[0].mood;
  for (const seg of segs) {
    if (seg.fromWord <= w) mood = seg.mood;
    else break;
  }
  return mood;
}

function exprFrameKey(
  character: string,
  expr: string,
  frame: "speaking" | "mouth-mid" | "mouth-closed"
): string {
  return `${character}:${expr}:${frame}`;
}

function isExprSetReady(character: string, expr: string): boolean {
  return (
    exprFrameReady.get(exprFrameKey(character, expr, "speaking")) === true &&
    exprFrameReady.get(exprFrameKey(character, expr, "mouth-mid")) === true &&
    exprFrameReady.get(exprFrameKey(character, expr, "mouth-closed")) === true
  );
}

/** Expression-set prefix for the live non-ack message, or null → neutral frames. */
function activeExprPrefix(character: string): string | null {
  if (!nowPlaying || nowPlaying.endedAt || nowPlaying.kind === "ack") return null;
  // Paused characters drop back to a neutral face — they're waiting, not emoting.
  if (playbackPaused) return null;
  const mood = moodAtNow(nowPlaying);
  if (mood === "neutral") return null;
  const expr = expressionsManifest[character]?.[mood];
  if (!expr || !isExprSetReady(character, expr)) return null;
  return expr;
}

function avatarFrameSrc(character: string, frame: MouthFrame): string {
  if (frame !== "idle") {
    const expr = activeExprPrefix(character);
    if (expr) return `avatars/tmnt/${character}/${expr}-${frame}.png`;
  }
  return `avatars/tmnt/${character}/${frame}.png`;
}

function blinkFrameSrc(character: string): string {
  return `avatars/tmnt/${character}/blink.png`;
}

function hasMouthMid(character: string): boolean {
  return mouthMidReady.get(character) === true;
}

function hasMouthClosed(character: string): boolean {
  return mouthClosedReady.get(character) === true;
}

function hasBlink(character: string): boolean {
  return blinkReady.get(character) === true;
}

// Word-gap / paused frame: closed mouth with the TALKING face (idle's relaxed
// eyes strobe against the wide-eyed speaking frames — the "blinking" bug).
function gapFrame(character: string): MouthFrame {
  if (activeExprPrefix(character) || hasMouthClosed(character)) return "mouth-closed";
  return "idle";
}

function preloadNeutralFrames(character: string) {
  // Neutral idle/speaking: warm cache only (no readiness gate — always assumed).
  for (const frame of ["idle", "speaking"] as const) {
    const img = new Image();
    img.src = `avatars/tmnt/${character}/${frame}.png`;
  }
  const mid = new Image();
  mid.onload = () => mouthMidReady.set(character, true);
  mid.onerror = () => mouthMidReady.set(character, false);
  mid.src = `avatars/tmnt/${character}/mouth-mid.png`;
  const closed = new Image();
  closed.onload = () => mouthClosedReady.set(character, true);
  closed.onerror = () => mouthClosedReady.set(character, false);
  closed.src = `avatars/tmnt/${character}/mouth-closed.png`;
  const blink = new Image();
  blink.onload = () => blinkReady.set(character, true);
  blink.onerror = () => blinkReady.set(character, false);
  blink.src = blinkFrameSrc(character);
}

function preloadExpressionFrames() {
  for (const [character, moods] of Object.entries(expressionsManifest)) {
    if (!moods || typeof moods !== "object") continue;
    for (const expr of Object.values(moods)) {
      if (typeof expr !== "string" || !expr) continue;
      for (const frame of ["speaking", "mouth-mid", "mouth-closed"] as const) {
        const key = exprFrameKey(character, expr, frame);
        const img = new Image();
        img.onload = () => exprFrameReady.set(key, true);
        img.onerror = () => exprFrameReady.set(key, false);
        img.src = `avatars/tmnt/${character}/${expr}-${frame}.png`;
      }
    }
  }
}

function preloadAvatarFrames() {
  const chars = new Set<string>(["default", ...PERSONAS.map((p) => p.avatar)]);
  for (const character of chars) preloadNeutralFrames(character);
  void loadExpressionsManifest();
  startBlinkScheduler();
}

async function loadExpressionsManifest() {
  try {
    const res = await fetch("avatars/tmnt/expressions.json");
    if (!res.ok) return;
    const data: unknown = await res.json();
    if (!data || typeof data !== "object" || Array.isArray(data)) return;
    expressionsManifest = data as ExpressionsManifest;
    preloadExpressionFrames();
  } catch {
    // Missing/404/invalid → neutral-only; art lands independently.
  }
}

function isLipsyncActive(sessionId?: string): boolean {
  if (!connected || !nowPlaying || nowPlaying.endedAt) return false;
  if (isPhoneRoutedFrame(nowPlaying)) return false;
  if (!agents.some((a) => a.sessionId === nowPlaying!.sessionId)) return false;
  if (sessionId != null && nowPlaying.sessionId !== sessionId) return false;
  return true;
}

function isStageWorthy(sessionId?: string): boolean {
  return isLipsyncActive(sessionId) && nowPlaying?.kind !== "ack";
}

function isSessionLive(sessionId: string): boolean {
  return isStageWorthy(sessionId);
}

function actionClusterMode(sessionId: string): ActionClusterMode {
  return isSessionLive(sessionId) ? "live" : "idle";
}

function spotlightEnterClass(key: string): string {
  if (key !== spotlightEnterKey) {
    spotlightEnterKey = key;
    spotlightEnterUntil = performance.now() + 280;
  }
  return performance.now() < spotlightEnterUntil ? " spotlight-enter" : "";
}

/** Single source of truth: wall clock → alignment timeline (atempo-aware). */
function alignmentAudioMs(np: NowPlaying): number {
  if (!lipsyncAnchor || lipsyncAnchor.startedAt !== np.startedAt) {
    lipsyncAnchor = { startedAt: np.startedAt, t0: performance.now() };
  }
  const wallMs = performance.now() - lipsyncAnchor.t0;
  const rate = typeof np.playbackRate === "number" && np.playbackRate > 0 ? np.playbackRate : 1;
  // atempo speeds content vs wall — multiply (not divide) so lookups track heard audio.
  return wallMs * rate;
}

function flapFrame(audioMs: number, periodMs: number, character: string): MouthFrame {
  const open = Math.floor(audioMs / periodMs) % 2 === 0;
  if (open) return "speaking";
  if (activeExprPrefix(character) || hasMouthMid(character)) return "mouth-mid";
  return gapFrame(character);
}

function pickMouthFrame(audioMs: number, alignment: [string, number][] | undefined, character: string): MouthFrame {
  if (!alignment?.length) {
    return flapFrame(audioMs, MOUTH_FALLBACK_FLAP_MS, character);
  }

  let spanStart = -1;
  let spanEnd = -1;
  for (let i = 0; i < alignment.length; i++) {
    const start = alignment[i][1];
    const end = i + 1 < alignment.length ? alignment[i + 1][1] : start + MOUTH_LAST_WORD_CAP_MS;
    if (audioMs >= start && audioMs < end) {
      spanStart = start;
      spanEnd = end;
      break;
    }
  }
  if (spanStart < 0) return gapFrame(character);

  // Gap ≥ 180ms between word starts → idle after the initial articulation window.
  if (spanEnd - spanStart >= MOUTH_GAP_IDLE_MS && audioMs - spanStart >= MOUTH_GAP_IDLE_MS) {
    return gapFrame(character);
  }
  return flapFrame(audioMs, MOUTH_FLAP_MS, character);
}

function currentMouthFrame(agent: AgentView): MouthFrame {
  if (!isLipsyncActive(agent.sessionId) || !nowPlaying) {
    return agent.state === "speaking" ? "speaking" : "idle";
  }
  const character = (agent.character ?? "default").toLowerCase();
  if (playbackPaused) return gapFrame(character);
  return pickMouthFrame(alignmentAudioMs(nowPlaying), nowPlaying.alignment, character);
}

function avatarSrc(agent: AgentView): string {
  const character = (agent.character ?? "default").toLowerCase();
  return avatarFrameSrc(character, currentMouthFrame(agent));
}

function stopLipsyncLoop() {
  if (lipsyncTimer) {
    clearInterval(lipsyncTimer);
    lipsyncTimer = null;
  }
  lipsyncSessionKey = null;
}

function applyLipsyncFrame() {
  if (!isLipsyncActive() || !nowPlaying) {
    stopLipsyncLoop();
    return;
  }
  const sessionId = nowPlaying.sessionId;
  const agent = agents.find((a) => a.sessionId === sessionId);
  if (!agent) {
    stopLipsyncLoop();
    return;
  }
  // Don't stomp an in-flight natural blink (paused/gap blinks are intentional).
  const until = blinkUntil.get(sessionId);
  if (until != null && performance.now() < until) return;

  const character = (agent.character ?? "default").toLowerCase();
  // Single source of truth (includes the paused freeze) — the guppy bug was
  // this loop calling pickMouthFrame directly and skipping the paused check.
  const frame = currentMouthFrame(agent);
  const src = avatarFrameSrc(character, frame);
  app.querySelectorAll<HTMLImageElement>(`[data-avatar-session="${CSS.escape(sessionId)}"]`).forEach((img) => {
    if (img.getAttribute("src") !== src) img.src = src;
  });
}

function syncLipsyncLoop() {
  if (!isLipsyncActive() || !nowPlaying) {
    stopLipsyncLoop();
    lipsyncAnchor = null;
    return;
  }
  if (nowPlaying.kind !== "ack") moodSegments(nowPlaying);
  const key = `${nowPlaying.sessionId}:${nowPlaying.startedAt}`;
  if (lipsyncSessionKey !== key) {
    lipsyncSessionKey = key;
    lipsyncAnchor = { startedAt: nowPlaying.startedAt, t0: performance.now() };
  }
  if (!lipsyncTimer) {
    lipsyncTimer = setInterval(applyLipsyncFrame, LIPSYNC_TICK_MS);
  }
  applyLipsyncFrame();
}

function randomBlinkGapMs(): number {
  return BLINK_MIN_GAP_MS + Math.random() * (BLINK_MAX_GAP_MS - BLINK_MIN_GAP_MS);
}

function scheduleNextBlink(sessionId: string, from = performance.now()) {
  nextBlinkAt.set(sessionId, from + randomBlinkGapMs());
}

/** Mid-word / open-mouth flaps — blink would strobe against speaking frames. */
function isMidWordMouth(agent: AgentView): boolean {
  if (!isLipsyncActive(agent.sessionId)) return false;
  const frame = currentMouthFrame(agent);
  return frame === "speaking" || frame === "mouth-mid";
}

function setAvatarSrc(sessionId: string, src: string) {
  app.querySelectorAll<HTMLImageElement>(`[data-avatar-session="${CSS.escape(sessionId)}"]`).forEach((img) => {
    if (img.getAttribute("src") !== src) img.src = src;
  });
}

function restoreAvatarAfterBlink(agent: AgentView) {
  setAvatarSrc(agent.sessionId, avatarSrc(agent));
}

function applyBlinkTick() {
  const now = performance.now();
  const visible = new Set<string>();
  app.querySelectorAll<HTMLImageElement>("[data-avatar-session]").forEach((img) => {
    const sid = img.dataset.avatarSession;
    if (sid) visible.add(sid);
  });

  for (const sessionId of [...blinkUntil.keys()]) {
    if (!visible.has(sessionId)) {
      blinkUntil.delete(sessionId);
      continue;
    }
    const until = blinkUntil.get(sessionId)!;
    if (now < until) continue;
    blinkUntil.delete(sessionId);
    scheduleNextBlink(sessionId, now);
    const agent = agents.find((a) => a.sessionId === sessionId);
    if (agent) restoreAvatarAfterBlink(agent);
  }

  for (const sessionId of visible) {
    if (blinkUntil.has(sessionId)) continue;
    const agent = agents.find((a) => a.sessionId === sessionId);
    if (!agent) continue;
    const character = (agent.character ?? "default").toLowerCase();
    if (!hasBlink(character)) continue;
    if (!nextBlinkAt.has(sessionId)) scheduleNextBlink(sessionId, now);
    if (now < nextBlinkAt.get(sessionId)!) continue;
    if (isMidWordMouth(agent)) {
      // Defer — don't burn the interval while the mouth is open.
      nextBlinkAt.set(sessionId, now + 200);
      continue;
    }
    blinkUntil.set(sessionId, now + BLINK_MS);
    setAvatarSrc(sessionId, blinkFrameSrc(character));
  }

  // Drop schedules for agents that left the room.
  for (const sessionId of [...nextBlinkAt.keys()]) {
    if (!agents.some((a) => a.sessionId === sessionId) && !visible.has(sessionId)) {
      nextBlinkAt.delete(sessionId);
      blinkUntil.delete(sessionId);
    }
  }
}

function startBlinkScheduler() {
  if (blinkTimer) return;
  blinkTimer = setInterval(applyBlinkTick, BLINK_TICK_MS);
}

function personaAvatarSrc(persona: Persona): string {
  return `avatars/tmnt/${persona.avatar}/idle.png`;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function renderCard(agent: AgentView): string {
  const greyed = !connected || staleSessions.has(agent.sessionId);
  const mutedClass = agent.muted ? " muted" : "";
  const displayName = escapeHtml(agent.label ?? agent.name);
  const safeName = escapeHtml(agent.name);
  const isRenaming = renamingSessionId === agent.sessionId;
  const pending = pendingGrantFor(agent.sessionId);
  const grow = isStageWorthy(agent.sessionId) || pending;
  const mode = actionClusterMode(agent.sessionId);
  const nameHtml = isRenaming
    ? `<input class="name-input no-drag" data-rename-input value="${displayName}" aria-label="Nickname" />`
    : `<div class="name${mutedClass}" title="${safeName}" data-rename-name>${displayName}</div>`;
  const sid = escapeHtml(agent.sessionId);

  // Badge/chips/queued-preview/action-cluster are React islands: the
  // semantic containers below are the portal targets (children render as
  // direct grid/flex children — no wrapper divs; see islands/host.tsx).
  return `
    <div
      class="card state-${agent.state}${greyed ? " disconnected" : ""}${staleSessions.has(agent.sessionId) ? " stale" : ""}${triageFocus === agent.sessionId ? " triage-focus" : ""}${grow ? " speaking-grow" : ""}"
      data-session="${agent.sessionId}"
      role="button"
      tabindex="0"
    >
      <div class="card-main">
        <div class="avatar-wrap${pending ? " grant-loading" : ""}">
          <img class="avatar" data-avatar-session="${sid}" src="${avatarSrc(agent)}" alt="" />
          <span class="avatar-fallback">${initials(agent.name)}</span>
        </div>
        <div class="card-body">
          ${nameHtml}
          <div data-island="state-badge" data-session="${sid}"></div>
          <div class="chips" data-island="chips" data-session="${sid}"></div>
          <div data-island="queued-preview" data-session="${sid}"></div>
        </div>
      </div>
      <div class="card-actions actions-${mode === "live" ? 3 : 5}" data-island="action-cluster" data-variant="card" data-mode="${mode}" data-session="${sid}" aria-label="Agent actions"></div>
    </div>
  `;
}

function renderDockAgent(agent: AgentView): string {
  const greyed = !connected || staleSessions.has(agent.sessionId);
  const displayName = escapeHtml(agent.label ?? agent.name);
  const hoverClass = dockHoverSessionId === agent.sessionId ? " hover-intent" : "";
  const mode = actionClusterMode(agent.sessionId);

  return `
    <div
      class="dock-agent state-${agent.state}${greyed ? " disconnected" : ""}${staleSessions.has(agent.sessionId) ? " stale" : ""}${triageFocus === agent.sessionId ? " triage-focus" : ""}${hoverClass}"
      data-session="${agent.sessionId}"
    >
      <button
        type="button"
        class="dock-avatar-btn"
        title="${displayName} - ${stateLabels[agent.state]}"
        aria-label="${displayName}, ${stateLabels[agent.state]}"
      >
        <span class="dock-ring">
          <img class="avatar dock-avatar" data-avatar-session="${escapeHtml(agent.sessionId)}" src="${avatarSrc(agent)}" alt="" />
          <span class="avatar-fallback dock-fallback">${initials(agent.name)}</span>
        </span>
        ${agent.raisedCount > 0 ? `<span class="dock-badge" title="${agent.raisedCount} update${agent.raisedCount > 1 ? "s" : ""} waiting">${agent.raisedCount}</span>` : ""}
      </button>
      <div class="dock-actions actions-${mode === "live" ? 3 : 5}" data-island="action-cluster" data-variant="dock" data-mode="${mode}" data-session="${escapeHtml(agent.sessionId)}" aria-label="Agent actions"></div>
    </div>
  `;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// The speaker spotlight replaces both the centered caption bubble and the
// in-pill scale-pop: while someone speaks (or their last summary lingers),
// a dedicated row above the pill holds a big flapping avatar, an always-on
// action row, and the bubble to its right — nothing overlaps the pill or the
// hover clusters anymore. Pending grants show the same stage immediately.
function dockSpotlight(): {
  agent?: AgentView;
  live: boolean;
  bubble: boolean;
  loading: boolean;
} | null {
  const pendingSessionId = latestPendingGrantSessionId();
  if (pendingSessionId) {
    const agent = agents.find((a) => a.sessionId === pendingSessionId);
    if (agent) return { agent, live: false, bubble: false, loading: true };
  }

  const np = nowPlaying;
  if (!np || np.kind === "ack" || isPhoneRoutedFrame(np)) return null;
  const agent = agents.find((a) => a.sessionId === np.sessionId);
  const live = !np.endedAt && !!agent && connected;
  const bubble =
    dockCaptions && !!np.text && dockSummaryDismissedKey !== summaryKey(np);
  if (!live && !bubble) return null;
  return { agent, live, bubble, loading: false };
}

function dockPillAgents(): AgentView[] {
  const spot = dockSpotlight();
  // Live speaker pops out of the pill — one avatar on stage, not two.
  if (spot?.live && spot.agent) {
    return agents.filter((a) => a.sessionId !== spot.agent!.sessionId);
  }
  return agents;
}

function dockWidth(): number {
  const pillCount = Math.max(dockPillAgents().length, 1);
  const compactWidth = pillCount * DOCK_AVATAR_STEP + DOCK_PADDING + DOCK_EXPAND_WIDTH;
  return dockSpotlight() ? Math.max(compactWidth, DOCK_EXPANDED_WIDTH) : compactWidth;
}

function dockHeight(): number {
  const spot = dockSpotlight();
  if (!spot) return DOCK_COMPACT_HEIGHT;
  return dockSummaryExpanded ? DOCK_SPOTLIGHT_EXPANDED : DOCK_SPOTLIGHT_HEIGHT;
}

function shellHtml(content: string): string {
  return `<div class="shell">${content}</div>`;
}

async function enterDockMode() {
  const win = getCurrentWindow();
  try {
    if (!savedWindowFrame) {
      const [size, position] = await Promise.all([win.outerSize(), win.outerPosition()]);
      savedWindowFrame = { size, position };
    }

    const width = dockWidth();
    const height = dockHeight();
    await win.setMinSize(DOCK_MIN_SIZE);
    await win.setSize(new LogicalSize(width, height));

    const monitor = await currentMonitor();
    if (monitor) {
      const scale = await win.scaleFactor();
      const monitorX = monitor.position.x / scale;
      const monitorY = monitor.position.y / scale;
      const monitorWidth = monitor.size.width / scale;
      const monitorHeight = monitor.size.height / scale;
      await win.setPosition(
        new LogicalPosition(
          Math.round(monitorX + (monitorWidth - width) / 2),
          Math.round(monitorY + monitorHeight - height - DOCK_BOTTOM_GAP),
        ),
      );
    }
  } catch (err) {
    console.error("failed to enter dock mode:", err);
  }
}

async function exitDockMode() {
  const win = getCurrentWindow();
  try {
    await win.setMinSize(FULL_MIN_SIZE);
    if (savedWindowFrame) {
      await win.setSize(savedWindowFrame.size);
      await win.setPosition(savedWindowFrame.position);
      savedWindowFrame = null;
    }
  } catch (err) {
    console.error("failed to exit dock mode:", err);
  }
}

type SnapCorner = "bl" | "br" | "bc" | "tr";
const SNAP_MARGIN = 12;


async function snapToCorner(corner: SnapCorner) {
  const win = getCurrentWindow();
  try {
    const monitor = await currentMonitor();
    if (!monitor) return;
    // ALL math in physical pixels — monitors can have different scale
    // factors, and mixing logical conversions across them threw the window
    // into the void once. outerSize/monitor rects are already physical.
    const size = await win.outerSize();
    const pos = await win.outerPosition();
    const rect = (m: typeof monitor) => ({
      x: m.position.x,
      y: m.position.y,
      w: m.size.width,
      h: m.size.height,
      margin: Math.round(SNAP_MARGIN * (m.scaleFactor || 1)),
    });

    const target = (m: ReturnType<typeof rect>) => {
      let x = m.x + m.margin;
      let y = m.y + m.margin;
      if (corner === "br" || corner === "tr") x = m.x + m.w - size.width - m.margin;
      else if (corner === "bc") x = m.x + Math.round((m.w - size.width) / 2);
      if (corner !== "tr") y = m.y + m.h - size.height - m.margin;
      return { x, y };
    };

    let mon = rect(monitor);
    let t = target(mon);

    // Repeat flick at an occupied corner = hop to the adjacent monitor.
    const atTarget = Math.abs(pos.x - t.x) < 32 && Math.abs(pos.y - t.y) < 32;
    if (atTarget && corner !== "bc") {
      const wantLeft = corner === "bl";
      const rects = (await availableMonitors()).map(rect);
      const candidates = rects.filter((m) =>
        wantLeft ? m.x + m.w <= mon.x + 1 : m.x >= mon.x + mon.w - 1
      );
      if (candidates.length) {
        candidates.sort((a, b) => (wantLeft ? b.x - a.x : a.x - b.x));
        mon = candidates[0];
        t = target(mon);
      }
    }

    // Safety clamp: the target's top-left must sit inside SOME monitor, or
    // the window becomes unfindable. Fall back to the current monitor.
    const all = (await availableMonitors()).map(rect);
    const visible = all.some(
      (m) => t.x >= m.x - 8 && t.x < m.x + m.w && t.y >= m.y - 8 && t.y < m.y + m.h
    );
    if (!visible) t = target(rect(monitor));

    await win.setPosition(new PhysicalPosition(Math.round(t.x), Math.round(t.y)));
  } catch (err) {
    console.error("failed to snap panel:", err);
  }
}

async function setDockMode(nextDockMode: boolean) {
  if (dockMode === nextDockMode) return;
  dockMode = nextDockMode;
  render();
  if (dockMode) {
    await enterDockMode();
  } else {
    await exitDockMode();
  }
}

function renderDock() {
  document.body.classList.add("dock-window");
  app.classList.add("dock-mode");
  const pillAgents = dockPillAgents();
  app.innerHTML = `
    <main class="dock-shell drag-region${connected ? "" : " disconnected"}" data-tauri-drag-region>
      ${renderDockSpotlight()}
      <div class="dock-pill" data-tauri-drag-region>
        <button
          type="button"
          class="icon-btn dock-caption-toggle no-drag${dockCaptions ? " active" : ""}"
          data-window-action="captions-toggle"
          title="${dockCaptions ? "Hide captions" : "Show captions"}"
          aria-pressed="${dockCaptions}"
        >${icons.cc}</button>
        <div class="dock-avatars">
          ${pillAgents.length ? pillAgents.map(renderDockAgent).join("") : '<span class="dock-empty">No agents</span>'}
        </div>
        <button type="button" class="icon-btn dock-expand no-drag" data-window-action="dock-off" title="Expand room">
          ${icons.expand}
        </button>
      </div>
    </main>
  `;

  bindDockHoverIntent();
  bindWindowActions();
  bindDockSummaryActions();
  bindGrantTargets();
  bindAvatars();
  bindDrag();
}

function renderDockSpotlight(): string {
  const spot = dockSpotlight();
  if (!spot) return "";
  const { agent, live, bubble, loading } = spot;

  let column = "";
  if (agent) {
    const character = (agent.character ?? "default").toLowerCase();
    const enterKey = loading
      ? `pending:${agent.sessionId}`
      : nowPlaying
        ? `${nowPlaying.sessionId}:${nowPlaying.startedAt}`
        : agent.sessionId;
    const imgSrc = loading
      ? avatarFrameSrc(character, "idle")
      : avatarSrc(agent);
    const mode: ActionClusterMode | null = loading ? null : live ? "live" : "summary";
    const actionsHtml = mode
      ? `<div class="spotlight-actions" data-island="action-cluster" data-variant="spotlight" data-mode="${mode}" data-session="${escapeHtml(agent.sessionId)}" aria-label="Speaker actions"></div>`
      : "";
    column = `
      <div class="spotlight-col no-drag${spotlightEnterClass(enterKey)}" data-session="${agent.sessionId}">
        ${actionsHtml}
        <span class="spotlight-ring${live ? " live" : ""}${loading ? " loading" : ""}" data-character="${escapeHtml(character)}">
          <img class="avatar spotlight-avatar" data-avatar-session="${escapeHtml(agent.sessionId)}" src="${imgSrc}" alt="" />
          <span class="avatar-fallback spotlight-fallback">${initials(agent.name)}</span>
        </span>
      </div>`;
  }

  let bubbleHtml = "";
  if (bubble && nowPlaying) {
    const name = escapeHtml(agent?.label ?? agent?.name ?? "Room");
    const expandedClass = dockSummaryExpanded ? " expanded" : "";
    const endedClass = nowPlaying.endedAt ? " ended" : "";
    bubbleHtml = `
      <button
        type="button"
        class="dock-caption no-drag${expandedClass}${endedClass}"
        data-summary-action="toggle"
        aria-expanded="${dockSummaryExpanded}"
        title="${dockSummaryExpanded ? "Collapse summary" : "Expand summary"}"
      >
        <span class="dock-caption-name">${name}</span>
        <span class="dock-caption-close" data-summary-action="dismiss" title="Dismiss" aria-hidden="true">${icons.close}</span>
        <span class="dock-caption-summary" data-island="dock-caption-text" data-expanded="${dockSummaryExpanded ? "1" : "0"}"></span>
      </button>`;
  }

  return `<div class="dock-spotlight">${column}${bubbleHtml}</div>`;
}

/** Legacy render + island re-sync. Every store change funnels through here;
 *  syncIslands flushSync-commits portals into the fresh placeholders in the
 *  same task, so the DOM never paints half-rendered. */
function render() {
  renderView();
  syncIslands(app);
}

function renderView() {
  if (dockMode) {
    renderDock();
    syncLipsyncLoop();
    return;
  }

  if (pickerOpen) {
    renderPicker();
    syncLipsyncLoop();
    return;
  }

  if (settingsOpen) {
    renderSettings();
    syncLipsyncLoop();
    return;
  }

  app.classList.remove("dock-mode");
  document.body.classList.remove("dock-window");
  const connClass = connected ? "up" : "down";
  app.innerHTML = shellHtml(`
    <header class="strip drag-region" data-tauri-drag-region>
      <span class="title" data-tauri-drag-region>Room</span>
      <div class="header-actions no-drag">
        <span class="conn-dot ${connClass}" title="${connected ? "Connected" : "Disconnected"}"></span>
        <button type="button" class="icon-btn window-btn" data-window-action="picker-open" title="New session">${icons.plus}</button>
        <button type="button" class="icon-btn window-btn" data-window-action="settings-open" title="Settings">${icons.gear}</button>
        <button
          type="button"
          class="icon-btn window-btn${roomSummaryPane ? " active" : ""}"
          data-window-action="summary-pane-toggle"
          title="${roomSummaryPane ? "Hide summary pane" : "Show summary pane"}"
          aria-pressed="${roomSummaryPane}"
        >${icons.cc}</button>
        <button type="button" class="icon-btn window-btn" data-window-action="dock-on" title="Dock room">${icons.dock}</button>
        <button type="button" class="icon-btn window-btn" data-window-action="close" title="Close room">${icons.close}</button>
      </div>
    </header>
    <div class="room-body">
      <main class="cards${connected ? "" : " disconnected"}" id="cards">
        ${agents.length ? agents.map(renderCard).join("") : '<p class="empty">No agents</p>'}
      </main>
      ${roomSummaryPane ? renderRoomSummaryPane() : ""}
    </div>
    <footer class="controls no-drag" data-island="transport"></footer>
    ${toastHtml()}
  `);

  bindGrantTargets();
  bindRename();
  bindWindowActions();
  bindDockSummaryActions();
  bindAvatars();
  bindDrag();
  syncLipsyncLoop();
}

function renderRoomSummaryPane(): string {
  const np = nowPlaying;
  const dismissed = np && dockSummaryDismissedKey === summaryKey(np);
  const hasText = np && !!np.text && !dismissed;
  if (!hasText || !np) {
    return `
      <aside class="room-summary-pane" aria-label="Spoken summary">
        <p class="room-summary-empty">Nothing spoken yet</p>
      </aside>`;
  }
  const agent = agents.find((a) => a.sessionId === np.sessionId);
  const name = escapeHtml(agent?.label ?? agent?.name ?? "Room");
  const endedClass = np.endedAt ? " ended" : "";
  return `
    <aside class="room-summary-pane${endedClass}" aria-label="Spoken summary">
      <div class="room-summary-header">
        <span class="room-summary-name">${name}</span>
        <button
          type="button"
          class="icon-btn room-summary-dismiss"
          data-summary-action="dismiss"
          title="Dismiss"
        >${icons.close}</button>
      </div>
      <div class="room-summary-body" data-island="summary-body"></div>
    </aside>`;
}

function toastHtml(): string {
  if (!toast) return "";
  return `<div class="toast ${toast.kind}" role="status">${escapeHtml(toast.text)}</div>`;
}

function basenameOf(dir: string): string {
  const parts = dir.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : dir;
}

function prettyPath(dir: string): string {
  return dir.replace(/^\/Users\/[^/]+/, "~");
}

function humanizeAge(mtimeMs: number): string {
  const mins = Math.floor((Date.now() - mtimeMs) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function personaChip(p: Persona): string {
  return `
    <button type="button" class="persona-chip" data-persona="${p.name}" data-label="${p.label}" title="Launch ${p.label}">
      <span class="persona-chip-av">
        <img class="avatar persona-chip-img" src="${personaAvatarSrc(p)}" alt="" />
        <span class="avatar-fallback persona-chip-fallback">${p.label[0]}</span>
      </span>
      <span class="persona-chip-label">${p.label}</span>
    </button>`;
}

function personaChips(): string {
  return `<div class="persona-chips no-drag">${PERSONAS.map(personaChip).join("")}</div>`;
}

function renderBrowseRow(): string {
  if (browseDir) {
    const name = escapeHtml(basenameOf(browseDir));
    const path = escapeHtml(prettyPath(browseDir));
    return `
      <div
        class="picker-row picker-browse expanded"
        data-dir="${escapeHtml(browseDir)}"
        data-project="${name}"
        data-browse-row
      >
        <div class="picker-row-info picker-browse-info" title="Choose a different folder">
          <div class="picker-row-name" title="${path}">${name}</div>
          <div class="picker-row-sub" title="${path}">${path}</div>
        </div>
        ${personaChips()}
      </div>`;
  }
  return `
    <div class="picker-row picker-browse" data-browse-row role="button" tabindex="0">
      <div class="picker-row-info">
        <div class="picker-row-name picker-browse-label">
          <span class="picker-browse-icon" aria-hidden="true">${icons.folder}</span>
          <span>Start in another folder…</span>
        </div>
      </div>
    </div>`;
}

async function pickFolder() {
  try {
    const selected = await open({ directory: true, multiple: false });
    if (selected && typeof selected === "string") {
      browseDir = selected;
      render();
    }
  } catch (err) {
    console.error("folder picker failed:", err);
  }
}

function renderNewRows(): string {
  const browse = renderBrowseRow();
  if (!knownDirsList.length) {
    return `${browse}<p class="picker-empty">No known projects</p>`;
  }
  return browse + knownDirsList
    .map((dir) => {
      const name = escapeHtml(basenameOf(dir));
      const path = escapeHtml(prettyPath(dir));
      return `
        <div class="picker-row" data-dir="${escapeHtml(dir)}" data-project="${name}">
          <div class="picker-row-info">
            <div class="picker-row-name" title="${path}">${name}</div>
            <div class="picker-row-sub" title="${path}">${path}</div>
          </div>
          ${personaChips()}
        </div>`;
    })
    .join("");
}

function renderResumeRows(): string {
  if (!resumableList.length) {
    return '<p class="picker-empty">No resumable sessions</p>';
  }
  return resumableList
    .map((s) => {
      const project = escapeHtml(s.project || basenameOf(s.dir));
      const age = escapeHtml(humanizeAge(s.mtimeMs));
      const shortId = escapeHtml(s.sessionId.slice(0, 8));
      return `
        <div
          class="picker-row"
          data-dir="${escapeHtml(s.dir)}"
          data-session="${escapeHtml(s.sessionId)}"
          data-project="${project}"
        >
          <div class="picker-row-info">
            <div class="picker-row-name" title="${escapeHtml(prettyPath(s.dir))}">${project}</div>
            <div class="picker-row-sub">
              <span class="picker-age">${age}</span>
              <span class="picker-sid">${shortId}</span>
            </div>
          </div>
          ${personaChips()}
        </div>`;
    })
    .join("");
}

function currentButtonColor(config: ButtonConfig): ButtonColor {
  return BUTTON_COLORS.includes(config.color as ButtonColor) ? (config.color as ButtonColor) : "white";
}

function nextButtonColor(config: ButtonConfig): ButtonColor {
  const current = currentButtonColor(config);
  return BUTTON_COLORS[(BUTTON_COLORS.indexOf(current) + 1) % BUTTON_COLORS.length];
}

function selectedAssignment(config: ButtonConfig): string {
  if (config.character) return `character:${config.character}`;
  if (config.action) return `action:${config.action}`;
  return "";
}

function renderAssignSelect(idx: string, config: ButtonConfig): string {
  const selected = selectedAssignment(config);
  const characterOptions = buttonCharacters
    .map((character) => {
      const value = `character:${character}`;
      return `<option value="${escapeHtml(value)}"${selected === value ? " selected" : ""}>${escapeHtml(character)}</option>`;
    })
    .join("");
  const actionOptions = buttonActions
    .map((action) => {
      const value = `action:${action}`;
      return `<option value="${escapeHtml(value)}"${selected === value ? " selected" : ""}>${escapeHtml(action)}</option>`;
    })
    .join("");

  return `
    <select class="button-assign no-drag" data-button-assign="${escapeHtml(idx)}" ${buttonsWritable ? "" : "disabled"}>
      <option value=""${selected ? "" : " selected"}>Unassigned</option>
      <optgroup label="Characters">${characterOptions || '<option disabled>No characters</option>'}</optgroup>
      <optgroup label="Actions">${actionOptions || '<option disabled>No actions</option>'}</optgroup>
    </select>`;
}

function renderButtonRow(idx: string, config: ButtonConfig): string {
  const color = currentButtonColor(config);
  const isLearning = learnCapture?.mode === "rebind" && learnCapture.oldIdx === idx;
  const name = config.name || `Button ${idx}`;
  return `
    <div class="button-row" data-button-row="${escapeHtml(idx)}">
      <button
        type="button"
        class="button-color button-color-${color} no-drag"
        data-button-color="${escapeHtml(idx)}"
        title="Cycle color"
        ${buttonsWritable ? "" : "disabled"}
      ></button>
      <input
        class="button-name no-drag"
        data-button-name="${escapeHtml(idx)}"
        value="${escapeHtml(name)}"
        title="display name - safe to rename"
        aria-label="Button display name"
        ${buttonsWritable ? "" : "disabled"}
      />
      <button
        type="button"
        class="button-code-chip${isLearning ? " learning" : ""} no-drag"
        data-button-learn="${escapeHtml(idx)}"
        ${buttonsWritable ? "" : "disabled"}
      >${isLearning ? "press a button..." : `#${escapeHtml(idx)}`}</button>
      ${renderAssignSelect(idx, config)}
      <input
        class="button-notes no-drag"
        data-button-notes="${escapeHtml(idx)}"
        value="${escapeHtml(config.notes ?? "")}"
        placeholder="Notes"
        ${buttonsWritable ? "" : "disabled"}
      />
      <button
        type="button"
        class="button-delete no-drag"
        data-button-delete="${escapeHtml(idx)}"
        title="Delete mapping"
        ${buttonsWritable ? "" : "disabled"}
      >&times;</button>
    </div>`;
}

function sortedButtonEntries(): [string, ButtonConfig][] {
  return Object.entries(buttonMappings).sort(([a], [b]) => Number(a) - Number(b));
}

function renderButtonsView(): string {
  const rows = sortedButtonEntries().map(([idx, config]) => renderButtonRow(idx, config)).join("");
  const learningAdd = learnCapture?.mode === "add";
  const status = !connected
    ? "Disconnected"
    : !buttonsLoaded
      ? "Waiting for button data"
      : buttonsWritable
        ? buttonDeviceHint || "Ready"
        : "Read-only: server commands unavailable";

  return `
    <section class="button-panel">
      <div class="panel-status">${escapeHtml(status)}</div>
      <div class="button-list">
        ${rows || '<p class="picker-empty">No mapped buttons</p>'}
        <button type="button" class="button-add no-drag${learningAdd ? " learning" : ""}" data-button-add ${buttonsWritable ? "" : "disabled"}>
          ${learningAdd ? "press a button..." : "+ Add button"}
        </button>
      </div>
    </section>`;
}

function renderShortcutsView(): string {
  if (!connected) {
    return '<div class="shortcut-panel"><p class="picker-empty">Disconnected</p></div>';
  }
  if (!shortcutsAvailable) {
    return '<div class="shortcut-panel"><p class="picker-empty">Shortcuts unavailable</p></div>';
  }
  if (!shortcutsLoaded) {
    return '<div class="shortcut-panel"><p class="picker-empty">Waiting for shortcuts</p></div>';
  }
  if (!shortcutsSections.length) {
    return '<div class="shortcut-panel"><p class="picker-empty">No shortcuts</p></div>';
  }

  return `
    <div class="shortcut-panel">
      ${shortcutsSections.map((section) => `
        <section class="shortcut-section">
          <h2>${escapeHtml(section.title)}</h2>
          <div class="shortcut-table">
            ${section.rows.map(([key, desc]) => `
              <div class="shortcut-row">
                <kbd>${escapeHtml(key)}</kbd>
                <span>${escapeHtml(desc)}</span>
              </div>
            `).join("")}
          </div>
        </section>
      `).join("")}
    </div>`;
}

function settingValue(key: keyof RoomSettings, fallback: string): string {
  const value = settings[key];
  return typeof value === "string" && value ? value : fallback;
}

function settingBool(key: keyof RoomSettings): boolean {
  return settings[key] === true;
}

function settingSpeed(): number {
  const value = settings.speed;
  return typeof value === "number" && Number.isFinite(value) ? Math.min(2, Math.max(0.75, value)) : 1;
}

function voiceLabel(voice: VoiceOption): string {
  return voice.name || voice.character || voice.id;
}

function voiceAvatarSrc(voice: VoiceOption): string {
  const character = (voice.character ?? "default").toLowerCase();
  return `avatars/tmnt/${character}/idle.png`;
}

function renderSegmented(
  group: string,
  options: readonly string[],
  current: string,
  labels: Record<string, string>,
): string {
  return `
    <div class="settings-segmented no-drag" data-setting-group="${group}">
      ${options.map((value) => `
        <button
          type="button"
          class="settings-segment${current === value ? " active" : ""}"
          data-setting-key="${group}"
          data-setting-value="${escapeHtml(value)}"
          aria-pressed="${current === value}"
          ${settingsWritable ? "" : "disabled"}
        >${escapeHtml(labels[value] ?? value)}</button>
      `).join("")}
    </div>`;
}

function renderVoiceRail(): string {
  if (!voicesLoaded) {
    return '<p class="settings-note">Waiting for voices</p>';
  }
  const characterVoices = settingsVoices.filter((voice) => voice.character != null);
  if (!characterVoices.length) {
    return '<p class="settings-note">Character voices unavailable</p>';
  }
  const current = settings.default_voice_id ?? "";
  return `
    <div class="settings-voice-rail no-drag">
      ${characterVoices.map((voice) => {
        const label = escapeHtml(voiceLabel(voice));
        const active = voice.id === current;
        return `
          <button
            type="button"
            class="settings-voice-chip${active ? " active" : ""}"
            data-default-voice="${escapeHtml(voice.id)}"
            title="${label}"
            aria-pressed="${active}"
            ${settingsWritable ? "" : "disabled"}
          >
            <span class="settings-voice-av">
              <img class="avatar settings-voice-img" src="${voiceAvatarSrc(voice)}" alt="" />
              <span class="avatar-fallback settings-voice-fallback">${escapeHtml(label.slice(0, 1).toUpperCase())}</span>
            </span>
            <span>${label}</span>
          </button>`;
      }).join("")}
    </div>`;
}

function renderOtherVoices(): string {
  const otherVoices = settingsVoices.filter((voice) => voice.character == null);
  if (!voicesLoaded || !otherVoices.length) return "";
  const current = settings.default_voice_id ?? "";
  return `
    <select class="settings-select no-drag" data-default-voice-select ${settingsWritable ? "" : "disabled"}>
      <option value="">Other voices...</option>
      ${otherVoices.map((voice) => `
        <option value="${escapeHtml(voice.id)}"${voice.id === current ? " selected" : ""}>${escapeHtml(voiceLabel(voice))}</option>
      `).join("")}
    </select>`;
}

function renderGeneralSettings(): string {
  if (!connected) {
    return '<section class="settings-panel"><p class="picker-empty">Disconnected</p></section>';
  }
  if (!settingsWritable) {
    return '<section class="settings-panel"><p class="picker-empty">Settings unavailable</p></section>';
  }
  const playbackMode = settingValue("playback_mode", "auto");
  const mood = settingValue("mood", "normal");
  const moodOptions: string[] = MOODS.includes(mood as (typeof MOODS)[number])
    ? [...MOODS]
    : [...MOODS, "custom"];
  const speed = settingSpeed();
  return `
    <section class="settings-panel">
      <div class="settings-status">${settingsLoaded ? "Ready" : "Waiting for settings"}</div>
      <div class="settings-group">
        <div class="settings-label">Default voice</div>
        ${renderVoiceRail()}
        ${renderOtherVoices()}
      </div>
      <div class="settings-grid">
        <div class="settings-group">
          <div class="settings-label">Playback mode</div>
          ${renderSegmented("playback_mode", PLAYBACK_MODES, playbackMode, { auto: "Auto", announce: "Announce", silent: "Silent" })}
        </div>
        <div class="settings-group">
          <div class="settings-label">Mood</div>
          ${renderSegmented("mood", moodOptions, moodOptions.includes(mood) ? mood : "custom", { focus: "Focus", arcade: "Arcade", quiet: "Quiet", normal: "Normal", custom: "Custom" })}
        </div>
      </div>
      <div class="settings-group">
        <div class="settings-label settings-label-row">
          <span>Speed</span>
          <span class="settings-value" data-setting-speed-label>${speed.toFixed(2)}x</span>
        </div>
        <input class="settings-slider no-drag" data-setting-speed type="range" min="0.75" max="2" step="0.25" value="${speed}" ${settingsWritable ? "" : "disabled"} />
      </div>
      <div class="settings-grid">
        <label class="settings-toggle no-drag">
          <span>Notifications</span>
          <input type="checkbox" data-setting-toggle="notifications" ${settingBool("notifications") ? "checked" : ""} ${settingsWritable ? "" : "disabled"} />
        </label>
        <label class="settings-toggle no-drag">
          <span>Listening</span>
          <input type="checkbox" data-setting-toggle="listening" ${settingBool("listening") ? "checked" : ""} ${settingsWritable ? "" : "disabled"} />
        </label>
      </div>
      <div class="settings-group">
        <div class="settings-label">Dynamic acks</div>
        ${renderSegmented("dynamic_acks", DYNAMIC_ACKS, settingValue("dynamic_acks", "cached"), { always: "Always", cached: "Cached", off: "Off" })}
      </div>
      <button type="button" class="settings-hold no-drag${roomHeld ? " active" : ""}" data-settings-hold aria-pressed="${roomHeld}">
        ${roomHeld ? "Release the Room" : "Hold the Room"}
      </button>
    </section>`;
}

function settingsTitle(): string {
  if (settingsTab === "buttons") return "Button Mapping";
  if (settingsTab === "help") return "Shortcuts";
  return "Settings";
}

function settingsTabButton(tab: SettingsTab, label: string): string {
  return `<button type="button" class="picker-tab${settingsTab === tab ? " active" : ""}" data-settings-tab="${tab}" role="tab">${label}</button>`;
}

function renderSettings() {
  app.classList.remove("dock-mode");
  document.body.classList.remove("dock-window");
  const connClass = connected ? "up" : "down";
  const body =
    settingsTab === "general"
      ? renderGeneralSettings()
      : settingsTab === "buttons"
        ? renderButtonsView()
        : renderShortcutsView();

  app.innerHTML = shellHtml(`
    <header class="strip drag-region" data-tauri-drag-region>
      <div class="strip-left">
        <button type="button" class="icon-btn window-btn no-drag" data-window-action="settings-back" title="Back to room">${icons.back}</button>
        <span class="title" data-tauri-drag-region>${settingsTitle()}</span>
      </div>
      <div class="header-actions no-drag">
        <span class="conn-dot ${connClass}" title="${connected ? "Connected" : "Disconnected"}"></span>
        <button type="button" class="icon-btn window-btn" data-window-action="close" title="Close room">${icons.close}</button>
      </div>
    </header>
    <main class="picker">
      <div class="picker-tabs no-drag" role="tablist">
        ${settingsTabButton("general", "General")}
        ${settingsTabButton("buttons", "Buttons")}
        ${settingsTabButton("help", "Help")}
      </div>
      ${body}
    </main>
    ${toastHtml()}
  `);

  bindWindowActions();
  bindSettingsTabs();
  bindGeneralSettings();
  bindButtonMapping();
  bindAvatars();
  bindDrag();
}

function pickerTitle(): string {
  return "New Session";
}

function pickerTabButton(tab: PickerTab, label: string): string {
  return `<button type="button" class="picker-tab${pickerTab === tab ? " active" : ""}" data-picker-tab="${tab}" role="tab">${label}</button>`;
}

function renderPicker() {
  app.classList.remove("dock-mode");
  document.body.classList.remove("dock-window");
  const connClass = connected ? "up" : "down";
  const body =
    pickerTab === "new"
      ? `<div class="picker-list">${renderNewRows()}</div>`
      : `<div class="picker-list">${renderResumeRows()}</div>`;

  app.innerHTML = shellHtml(`
    <header class="strip drag-region" data-tauri-drag-region>
      <div class="strip-left">
        <button type="button" class="icon-btn window-btn no-drag" data-window-action="picker-back" title="Back to room">${icons.back}</button>
        <span class="title" data-tauri-drag-region>${pickerTitle()}</span>
      </div>
      <div class="header-actions no-drag">
        <span class="conn-dot ${connClass}" title="${connected ? "Connected" : "Disconnected"}"></span>
        <button type="button" class="icon-btn window-btn" data-window-action="close" title="Close room">${icons.close}</button>
      </div>
    </header>
    <main class="picker">
      <div class="picker-tabs no-drag" role="tablist">
        ${pickerTabButton("new", "New")}
        ${pickerTabButton("resume", "Resume")}
      </div>
      <div class="picker-flags no-drag">
        <label class="picker-flag"><input type="checkbox" data-spawn-flag="${SPAWN_FLAG_SKIP_PERMS}" ${spawnFlagChecked(SPAWN_FLAG_SKIP_PERMS) ? "checked" : ""}> Skip permission prompts</label>
        <label class="picker-flag"><input type="checkbox" data-spawn-flag="${SPAWN_FLAG_REMOTE}" ${spawnFlagChecked(SPAWN_FLAG_REMOTE) ? "checked" : ""}> Remote control (Claude app)</label>
        <label class="picker-flag">Model
          <select data-spawn-model>
            ${SPAWN_MODEL_CHOICES.map(
              ([value, label]) =>
                `<option value="${value}" ${spawnModel() === value ? "selected" : ""}>${label}</option>`
            ).join("")}
          </select>
        </label>
      </div>
      ${body}
    </main>
    ${toastHtml()}
  `);

  bindWindowActions();
  bindPickerTabs();
  bindSpawnFlags();
  bindBrowseRow();
  bindPickerChips();
  bindButtonMapping();
  bindAvatars();
  bindDrag();
}

function openPicker() {
  pickerOpen = true;
  settingsOpen = false;
  pickerTab = "new";
  browseDir = null;
  clearToastTimers();
  toast = null;
  send({ type: "known_dirs" });
  send({ type: "list_resumable" });
  render();
}

function closePicker() {
  pickerOpen = false;
  browseDir = null;
  cancelLearnCapture();
  clearToastTimers();
  toast = null;
  render();
}

function openSettings() {
  settingsOpen = true;
  pickerOpen = false;
  settingsTab = "general";
  clearToastTimers();
  toast = null;
  requestSettingsTabData();
  render();
}

function closeSettings() {
  settingsOpen = false;
  cancelLearnCapture();
  clearToastTimers();
  toast = null;
  render();
}

function clearToastTimers() {
  if (pickerReturnTimer) {
    clearTimeout(pickerReturnTimer);
    pickerReturnTimer = null;
  }
  if (toastClearTimer) {
    clearTimeout(toastClearTimer);
    toastClearTimer = null;
  }
}

function showLaunchToast(text: string) {
  clearToastTimers();
  toast = { kind: "launch", text };
  render();
  pickerReturnTimer = setTimeout(() => {
    pickerReturnTimer = null;
    toast = null;
    pickerOpen = false;
    render();
  }, 2000);
}

function showErrorToast(text: string) {
  clearToastTimers();
  toast = { kind: "error", text };
  render();
  toastClearTimer = setTimeout(() => {
    toastClearTimer = null;
    toast = null;
    render();
  }, 2600);
}

function bindPickerTabs() {
  app.querySelectorAll<HTMLButtonElement>("[data-picker-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.pickerTab as PickerTab;
      if (tab && tab !== pickerTab) {
        pickerTab = tab;
        render();
      }
    });
  });
}

function requestSettingsBaseData() {
  send({ type: "get_settings" });
  send({ type: "list_voices" });
}

function requestSettingsTabData() {
  if (settingsTab === "general") {
    requestSettingsBaseData();
  } else if (settingsTab === "buttons") {
    send({ type: "get_buttons" });
  } else if (settingsTab === "help") {
    send({ type: "get_shortcuts" });
  }
}

function bindSettingsTabs() {
  app.querySelectorAll<HTMLButtonElement>("[data-settings-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.settingsTab as SettingsTab;
      if (tab && tab !== settingsTab) {
        settingsTab = tab;
        requestSettingsTabData();
        render();
      }
    });
  });
}

function commitSetting(key: keyof RoomSettings | "default_voice", value: string | number | boolean) {
  if (!settingsWritable) return;
  const localKey = key === "default_voice" ? "default_voice_id" : key;
  settings = { ...settings, [localKey]: value };
  send({ type: "set_setting", key, value });
  render();
}

function bindGeneralSettings() {
  if (!settingsOpen || settingsTab !== "general") return;

  app.querySelectorAll<HTMLButtonElement>("[data-default-voice]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const voiceId = btn.dataset.defaultVoice;
      if (voiceId) commitSetting("default_voice", voiceId);
    });
  });

  const otherVoices = app.querySelector<HTMLSelectElement>("[data-default-voice-select]");
  otherVoices?.addEventListener("change", (e) => {
    e.stopPropagation();
    if (otherVoices.value) commitSetting("default_voice", otherVoices.value);
  });

  app.querySelectorAll<HTMLButtonElement>("[data-setting-key]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const key = btn.dataset.settingKey as keyof RoomSettings | undefined;
      const value = btn.dataset.settingValue;
      if (!key || !value || value === "custom") return;
      commitSetting(key, value);
    });
  });

  const speed = app.querySelector<HTMLInputElement>("[data-setting-speed]");
  const commitSpeed = () => {
    if (!speed) return;
    commitSetting("speed", Number(speed.value));
  };
  speed?.addEventListener("input", () => {
    const next = Number(speed.value);
    settings = { ...settings, speed: next };
    const label = app.querySelector<HTMLElement>("[data-setting-speed-label]");
    if (label) label.textContent = `${next.toFixed(2)}x`;
  });
  speed?.addEventListener("change", commitSpeed);
  speed?.addEventListener("pointerup", commitSpeed);

  app.querySelectorAll<HTMLInputElement>("[data-setting-toggle]").forEach((input) => {
    input.addEventListener("change", (e) => {
      e.stopPropagation();
      const key = input.dataset.settingToggle as keyof RoomSettings | undefined;
      if (key) commitSetting(key, input.checked);
    });
  });

  app.querySelector<HTMLButtonElement>("[data-settings-hold]")?.addEventListener("click", (e) => {
    e.stopPropagation();
    send({ type: "hold_room" });
  });
}

function bindBrowseRow() {
  const row = app.querySelector<HTMLElement>("[data-browse-row]");
  if (!row) return;

  if (browseDir) {
    const info = row.querySelector<HTMLElement>(".picker-browse-info");
    info?.addEventListener("click", (e) => {
      e.stopPropagation();
      void pickFolder();
    });
    return;
  }

  const openBrowse = () => void pickFolder();
  row.addEventListener("click", openBrowse);
  row.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openBrowse();
    }
  });
}

// Picker launch-flag toggles — persisted, default both on.
const SPAWN_FLAG_SKIP_PERMS = "panel_flag_skip_perms";
const SPAWN_FLAG_REMOTE = "panel_flag_remote";
const SPAWN_FLAG_MODEL = "panel_flag_model";
const SPAWN_MODEL_CHOICES: [string, string][] = [
  ["", "Default"],
  ["fable", "Fable"],
  ["opus", "Opus"],
  ["sonnet", "Sonnet"],
  ["haiku", "Haiku"],
];

function spawnFlagChecked(key: string): boolean {
  try {
    return localStorage.getItem(key) !== "0";
  } catch {
    return true;
  }
}

function spawnModel(): "" | NonNullable<Extract<Command, { type: "spawn_session" }>["model"]> {
  try {
    const value = localStorage.getItem(SPAWN_FLAG_MODEL) ?? "";
    return SPAWN_MODEL_CHOICES.some(([v]) => v === value)
      ? (value as ReturnType<typeof spawnModel>)
      : "";
  } catch {
    return "";
  }
}

function bindSpawnFlags() {
  app.querySelectorAll<HTMLInputElement>("[data-spawn-flag]").forEach((box) => {
    box.addEventListener("change", () => {
      try {
        localStorage.setItem(box.dataset.spawnFlag!, box.checked ? "1" : "0");
      } catch { /* ignore */ }
    });
  });
  app.querySelectorAll<HTMLSelectElement>("[data-spawn-model]").forEach((sel) => {
    sel.addEventListener("change", () => {
      try {
        localStorage.setItem(SPAWN_FLAG_MODEL, sel.value);
      } catch { /* ignore */ }
    });
  });
}

function bindPickerChips() {
  app.querySelectorAll<HTMLButtonElement>(".persona-chip").forEach((chip) => {
    chip.addEventListener("click", (e) => {
      e.stopPropagation();
      const persona = chip.dataset.persona;
      const label = chip.dataset.label ?? persona ?? "";
      const row = chip.closest<HTMLElement>("[data-dir]");
      if (!persona || !row) return;
      const dir = row.dataset.dir!;
      const project = row.dataset.project ?? basenameOf(dir);
      const sessionId = row.dataset.session;
      const model = spawnModel();
      const flags = {
        skipPermissions: spawnFlagChecked(SPAWN_FLAG_SKIP_PERMS),
        remoteControl: spawnFlagChecked(SPAWN_FLAG_REMOTE),
        ...(model ? { model } : {}),
      };
      if (sessionId) {
        send({ type: "resume_session", sessionId, dir, persona, ...flags });
      } else {
        send({ type: "spawn_session", dir, persona, ...flags });
      }
      showLaunchToast(`launching ${label} in ${project}…`);
    });
  });
}

function cancelLearnCapture() {
  if (!learnCapture) return;
  clearTimeout(learnCapture.timer);
  learnCapture = null;
}

function armLearnCapture(mode: LearnMode, oldIdx?: string) {
  if (!buttonsWritable) return;
  cancelLearnCapture();
  learnCapture = {
    mode,
    oldIdx,
    armedAt: Date.now(),
    timer: setTimeout(() => {
      learnCapture = null;
      showErrorToast("Button capture timed out");
    }, LEARN_CAPTURE_MS),
  };
  send({ type: "learn_capture" });
  render();
}

// The wire schema types patch fields as string|undefined, but this panel has
// always sent null to clear assignments (and the server has always rejected
// those nulls as bad_message — pre-existing bug logged in the Phase 2
// decisions entry). Phase 2 keeps the bytes identical; fix both sides later.
function sendButtonPatch(idx: string, patch: Partial<ButtonConfig>) {
  send({ type: "set_button", idx: Number(idx), patch } as unknown as Command);
}

function commitButtonPatch(idx: string, patch: Partial<ButtonConfig>) {
  if (!buttonsWritable) return;
  buttonMappings[idx] = { ...(buttonMappings[idx] ?? { name: `Button ${idx}` }), ...patch };
  sendButtonPatch(idx, patch);
  render();
}

function handleCapturedButton(idx: string) {
  if (!learnCapture) return;
  const capture = learnCapture;
  cancelLearnCapture();

  if (capture.mode === "add") {
    const action = buttonActions[0] ?? null;
    const patch: Partial<ButtonConfig> = {
      name: `Button ${idx}`,
      action,
      character: null,
      color: "white",
      notes: "",
    };
    buttonMappings[idx] = { name: `Button ${idx}`, action, color: "white", notes: "" };
    sendButtonPatch(idx, patch);
    render();
    return;
  }

  const oldIdx = capture.oldIdx;
  if (!oldIdx) return;
  const existing = buttonMappings[oldIdx] ?? { name: `Button ${oldIdx}` };
  buttonMappings[idx] = { ...existing };
  sendButtonPatch(idx, existing);
  if (idx !== oldIdx) {
    delete buttonMappings[oldIdx];
    send({ type: "remove_button", idx: Number(oldIdx) });
  }
  render();
}

function bindButtonMapping() {
  if (!settingsOpen || settingsTab !== "buttons") return;

  app.querySelectorAll<HTMLButtonElement>("[data-button-color]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = btn.dataset.buttonColor;
      if (!idx) return;
      commitButtonPatch(idx, { color: nextButtonColor(buttonMappings[idx] ?? { name: `Button ${idx}` }) });
    });
  });

  app.querySelectorAll<HTMLButtonElement>("[data-button-learn]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = btn.dataset.buttonLearn;
      if (idx) armLearnCapture("rebind", idx);
    });
  });

  const add = app.querySelector<HTMLButtonElement>("[data-button-add]");
  add?.addEventListener("click", (e) => {
    e.stopPropagation();
    armLearnCapture("add");
  });

  app.querySelectorAll<HTMLSelectElement>("[data-button-assign]").forEach((select) => {
    select.addEventListener("change", (e) => {
      e.stopPropagation();
      const idx = select.dataset.buttonAssign;
      if (!idx) return;
      const [kind, ...rest] = select.value.split(":");
      const value = rest.join(":");
      if (kind === "character" && value) {
        commitButtonPatch(idx, { character: value, action: null });
      } else if (kind === "action" && value) {
        commitButtonPatch(idx, { action: value, character: null });
      } else {
        commitButtonPatch(idx, { action: null, character: null });
      }
    });
  });

  app.querySelectorAll<HTMLInputElement>("[data-button-name]").forEach((input) => {
    input.addEventListener("click", (e) => e.stopPropagation());
    input.addEventListener("blur", () => {
      const idx = input.dataset.buttonName;
      const name = input.value.trim();
      if (idx && name) commitButtonPatch(idx, { name });
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        input.blur();
      }
    });
  });

  app.querySelectorAll<HTMLInputElement>("[data-button-notes]").forEach((input) => {
    input.addEventListener("click", (e) => e.stopPropagation());
    input.addEventListener("blur", () => {
      const idx = input.dataset.buttonNotes;
      if (idx) commitButtonPatch(idx, { notes: input.value.trim() });
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        input.blur();
      }
    });
  });

  app.querySelectorAll<HTMLButtonElement>("[data-button-delete]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
    });
    btn.addEventListener("dblclick", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const idx = btn.dataset.buttonDelete;
      if (!idx || !buttonsWritable) return;
      delete buttonMappings[idx];
      send({ type: "remove_button", idx: Number(idx) });
      render();
    });
  });
}

// data-tauri-drag-region needs the start-dragging permission and only covers
// the exact element — a mousedown fallback makes the whole header reliable.
function bindDrag() {
  app.querySelectorAll<HTMLElement>(".drag-region").forEach((region) => {
    region.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest("button, .conn-dot, .no-drag")) return;
      void getCurrentWindow().startDragging();
      e.stopPropagation();
    });
  });
}

function bindWindowActions() {
  app.querySelectorAll<HTMLButtonElement>("[data-window-action]").forEach((btn) => {
    btn.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      if (btn.dataset.windowAction === "picker-back") {
        e.preventDefault();
        closePicker();
      } else if (btn.dataset.windowAction === "settings-back") {
        e.preventDefault();
        closeSettings();
      }
    });
    btn.addEventListener("mousedown", (e) => e.stopPropagation());
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const action = btn.dataset.windowAction;
      if (action === "dock-on") void setDockMode(true);
      else if (action === "dock-off") void setDockMode(false);
      else if (action === "captions-toggle") {
        dockCaptions = !dockCaptions;
        if (!dockCaptions) dockSummaryExpanded = false;
        localStorage.setItem(CAPTIONS_STORAGE_KEY, dockCaptions ? "1" : "0");
        render();
        if (dockMode) void enterDockMode();
      }
      else if (action === "summary-pane-toggle") {
        roomSummaryPane = !roomSummaryPane;
        localStorage.setItem(SUMMARY_PANE_KEY, roomSummaryPane ? "1" : "0");
        render();
      }
      else if (action === "picker-open") openPicker();
      else if (action === "picker-back" && pickerOpen) closePicker();
      else if (action === "settings-open") openSettings();
      else if (action === "settings-back" && settingsOpen) closeSettings();
      else if (action === "close") void getCurrentWindow().close();
    });
  });
}

function bindDockSummaryActions() {
  app.querySelectorAll<HTMLElement>("[data-summary-action]").forEach((target) => {
    target.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
    });
    target.addEventListener("mousedown", (e) => e.stopPropagation());
    target.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const action = target.dataset.summaryAction;
      if (action === "dismiss") {
        if (nowPlaying) dockSummaryDismissedKey = summaryKey(nowPlaying);
        dockSummaryExpanded = false;
      } else {
        dockSummaryExpanded = action === "collapse" ? false : !dockSummaryExpanded;
      }
      render();
      if (dockMode) void enterDockMode();
    });
  });
}

// Event firewall: the card/dock grant gesture must never fire from island-
// owned controls. React's ClusterBtn stops propagation at the portal
// container, but this native-side guard is the belt — a press on any
// button (other than the grant target itself) or inside an action-cluster
// container is not a grant/PTT gesture.
function isNonGrantTarget(el: EventTarget | null, boundTarget: HTMLElement): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const btn = el.closest("button");
  if (btn && btn !== boundTarget) return true;
  return !!el.closest(".card-actions, .dock-actions, .spotlight-actions");
}

function bindGrantTargets() {
  app.querySelectorAll<HTMLElement>(".card, .dock-avatar-btn").forEach((target) => {
    const sessionEl = target.closest<HTMLElement>("[data-session]");
    if (!sessionEl) return;
    const sessionId = sessionEl.dataset.session!;
    let holdTimer: ReturnType<typeof setTimeout> | null = null;
    let pttActive = false;
    let suppressClick = false;

    const clearHold = () => {
      if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
    };

    target.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      if (isNonGrantTarget(e.target, target)) return;
      suppressClick = false;
      clearHold();
      holdTimer = setTimeout(() => {
        holdTimer = null;
        pttActive = true;
        suppressClick = true;
        send({ type: "ptt", phase: "start", sessionId });
      }, HOLD_MS);
    });

    const endHold = () => {
      clearHold();
      if (pttActive) {
        pttActive = false;
        send({ type: "ptt", phase: "stop", sessionId });
      }
    };

    target.addEventListener("mouseup", endHold);
    target.addEventListener("mouseleave", endHold);

    target.addEventListener("click", (e) => {
      if (isNonGrantTarget(e.target, target)) return;
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      // Optimistic pending state + render come back through the store
      // subscription; duplicate clicks are deduped in the client.
      client.grant(sessionId);
    });
  });
}

function bindAvatars() {
  app.querySelectorAll<HTMLImageElement>(".avatar").forEach((img) => {
    img.onerror = () => {
      img.style.display = "none";
      const fallback = img.nextElementSibling as HTMLElement | null;
      if (fallback) fallback.style.display = "flex";
    };
  });
}

function bindDockHoverIntent() {
  const clearPendingHide = () => {
    if (!dockHoverHideTimer) return;
    clearTimeout(dockHoverHideTimer);
    dockHoverHideTimer = null;
  };

  app.querySelectorAll<HTMLElement>(".dock-agent").forEach((agentEl) => {
    const sessionId = agentEl.dataset.session;
    if (!sessionId) return;

    agentEl.addEventListener("mouseenter", () => {
      clearPendingHide();
      dockHoverSessionId = sessionId;
      app.querySelectorAll<HTMLElement>(".dock-agent.hover-intent").forEach((el) => {
        if (el !== agentEl) el.classList.remove("hover-intent");
      });
      agentEl.classList.add("hover-intent");
    });

    agentEl.addEventListener("mouseleave", () => {
      clearPendingHide();
      dockHoverHideTimer = setTimeout(() => {
        dockHoverHideTimer = null;
        if (dockHoverSessionId !== sessionId) return;
        dockHoverSessionId = null;
        agentEl.classList.remove("hover-intent");
      }, DOCK_HOVER_LEAVE_MS);
    });
  });
}

function bindRename() {
  app.querySelectorAll<HTMLElement>("[data-rename-name]").forEach((nameEl) => {
    const sessionEl = nameEl.closest<HTMLElement>("[data-session]");
    if (!sessionEl) return;
    nameEl.addEventListener("mousedown", (e) => e.stopPropagation());
    nameEl.addEventListener("click", (e) => e.stopPropagation());
    nameEl.addEventListener("dblclick", (e) => {
      e.preventDefault();
      e.stopPropagation();
      renamingSessionId = sessionEl.dataset.session!;
      render();
      const input = app.querySelector<HTMLInputElement>("[data-rename-input]");
      input?.focus();
      input?.select();
    });
  });

  const input = app.querySelector<HTMLInputElement>("[data-rename-input]");
  if (!input) return;
  const sessionEl = input.closest<HTMLElement>("[data-session]");
  if (!sessionEl) return;
  const sessionId = sessionEl.dataset.session!;

  input.addEventListener("mousedown", (e) => e.stopPropagation());
  input.addEventListener("click", (e) => e.stopPropagation());
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      const label = input.value.trim();
      send({ type: "set_nickname", sessionId, label });
      renamingSessionId = null;
      render();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      renamingSessionId = null;
      render();
    }
  });
  input.addEventListener("blur", () => {
    if (renamingSessionId === sessionId) {
      renamingSessionId = null;
      render();
    }
  });
}

const PICKER_ERROR_TEXT: Record<string, string> = {
  bad_dir: "Invalid project directory",
  bad_persona: "Unknown persona",
  bad_session: "Session no longer resumable",
};

function normalizeSettings(value: unknown): RoomSettings {
  if (!value || typeof value !== "object") return {};
  const input = value as Record<string, unknown>;
  const next: RoomSettings = {};
  if (typeof input.default_voice_id === "string" || input.default_voice_id == null) {
    next.default_voice_id = input.default_voice_id as string | null | undefined;
  }
  if (typeof input.playback_mode === "string" || input.playback_mode == null) {
    next.playback_mode = input.playback_mode as string | null | undefined;
  }
  if (typeof input.mood === "string" || input.mood == null) {
    next.mood = input.mood as string | null | undefined;
  }
  if (typeof input.speed === "number" || input.speed == null) {
    next.speed = input.speed as number | null | undefined;
  }
  if (typeof input.notifications === "boolean" || input.notifications == null) {
    next.notifications = input.notifications as boolean | null | undefined;
  }
  if (typeof input.listening === "boolean" || input.listening == null) {
    next.listening = input.listening as boolean | null | undefined;
  }
  if (typeof input.dynamic_acks === "string" || input.dynamic_acks == null) {
    next.dynamic_acks = input.dynamic_acks as string | null | undefined;
  }
  return next;
}

function normalizeVoices(value: unknown): VoiceOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((voice) => {
    if (!voice || typeof voice !== "object") return [];
    const input = voice as Record<string, unknown>;
    const id = typeof input.id === "string"
      ? input.id
      : typeof input.voice_id === "string"
        ? input.voice_id
        : "";
    if (!id) return [];
    const name = typeof input.name === "string"
      ? input.name
      : typeof input.label === "string"
        ? input.label
        : id;
    const character = typeof input.character === "string" || input.character == null
      ? input.character as string | null | undefined
      : undefined;
    return [{ id, name, character }];
  });
}

/**
 * Non-snapshot server events, already schema-validated by the transport.
 * Snapshot application lives in applySnapshot (store subscription below);
 * unknown event kinds never reach here (parseServerEvent drops them).
 */
function handleServerEvent(ev: ServerEvent) {
  switch (ev.type) {
    case "snap": {
      const c = ev.corner;
      if (c === "bl" || c === "br" || c === "bc" || c === "tr") {
        void snapToCorner(c);
      }
      return;
    }

    case "known_dirs":
      knownDirsList = ev.dirs;
      if (pickerOpen) render();
      return;

    case "resumable":
      resumableList = ev.sessions;
      if (pickerOpen) render();
      return;

    case "buttons":
      buttonDeviceHint = ev.device_hint;
      // Wire buttons carry color as a plain string; currentButtonColor()
      // re-validates against BUTTON_COLORS on every read.
      buttonMappings = ev.buttons as Record<string, ButtonConfig>;
      buttonActions = ev.actions;
      buttonCharacters = ev.characters;
      buttonsLoaded = true;
      buttonsWritable = true;
      if (settingsOpen && settingsTab === "buttons") render();
      return;

    case "settings":
      settings = normalizeSettings(ev.values);
      settingsLoaded = true;
      settingsWritable = true;
      if (settingsOpen && settingsTab === "general") render();
      return;

    case "list_voices":
      settingsVoices = normalizeVoices(ev.voices);
      voicesLoaded = true;
      if (settingsOpen && settingsTab === "general") render();
      return;

    case "captured":
      handleCapturedButton(String(ev.idx));
      return;

    case "shortcuts":
      shortcutsSections = ev.sections;
      shortcutsLoaded = true;
      shortcutsAvailable = true;
      if (settingsOpen && settingsTab === "help") render();
      return;

    // Typed notices (spawn failures, dedup rejections, stale tmux) — the
    // server broadcasts these when a fire-and-forget action fails after the
    // optimistic "launching…" toast.
    case "notice":
      showErrorToast(ev.message);
      return;

    case "error": {
      const code = ev.code;
      if (code === "stale_session" && ev.sessionId) {
        staleSessions.add(ev.sessionId);
        render();
      } else if (code in PICKER_ERROR_TEXT) {
        showErrorToast(PICKER_ERROR_TEXT[code]);
      } else if (code === "no_device") {
        cancelLearnCapture();
        showErrorToast("No button device detected");
      } else if (["unknown_command", "unsupported", "not_implemented"].includes(code)) {
        if (settingsOpen && settingsTab === "general") {
          settingsWritable = false;
          settingsLoaded = true;
          voicesLoaded = true;
          render();
        } else if (settingsOpen && settingsTab === "buttons") {
          buttonsWritable = false;
          buttonsLoaded = true;
          cancelLearnCapture();
          render();
        } else if (settingsOpen && settingsTab === "help") {
          shortcutsAvailable = false;
          shortcutsLoaded = true;
          render();
        }
      }
      return;
    }

    // Correlated acks are consumed inside room-client (grant optimism,
    // request promises); the legacy renderer has no use for them.
    case "command_result":
      return;
  }
}

/** Mirror a freshly applied store snapshot into the module vars the
 *  renderers read. Rev/epoch staleness gating already happened client-side. */
function applySnapshot(snap: PanelSnapshot) {
  agents = snap.agents;
  roomHeld = snap.roomHeld === true;
  const nowPaused = snap.paused === true;
  if (nowPaused !== playbackPaused) {
    if (nowPaused) {
      pausedAtWall = performance.now();
    } else if (lipsyncAnchor && pausedAtWall) {
      // SIGSTOP froze the audio but not the wall clock — push the anchor
      // forward by the paused span so the mouth stays in sync on resume.
      lipsyncAnchor.t0 += performance.now() - pausedAtWall;
    }
    playbackPaused = nowPaused;
    pausedAtWall = nowPaused ? pausedAtWall : 0;
  }
  triageFocus =
    typeof snap.triageFocus === "string" && snap.triageFocus.trim()
      ? snap.triageFocus
      : null;
  nowPlaying = snap.nowPlaying ?? null;
  if (nowPlaying && nowPlaying.kind !== "ack" && !isPhoneRoutedFrame(nowPlaying)) moodSegments(nowPlaying);
  if (renamingSessionId && !agents.some((a) => a.sessionId === renamingSessionId)) {
    renamingSessionId = null;
  }
  staleSessions.clear();
  // Kill-arm timers + the swap popover moved to the island ui-state store.
  pruneUiState(new Set(agents.map((a) => a.sessionId)));
}

let lastAppliedSnapshot: PanelSnapshot | null = null;

// One render path for every store change (connection edge, new snapshot,
// grant optimism set/cleared) — replaces the old ws.onopen/onclose/
// onmessage plumbing and its fixed 2s reconnect timer.
client.subscribe(() => {
  const st = client.getState();
  if (st.connected !== connected) {
    connected = st.connected;
    if (!connected) stopLipsyncLoop();
  }
  if (st.snapshot && st.snapshot !== lastAppliedSnapshot) {
    lastAppliedSnapshot = st.snapshot;
    applySnapshot(st.snapshot);
  }
  render();
  if (dockMode) void enterDockMode();
});
client.onEvent(handleServerEvent);

initIslands(
  client,
  PERSONAS.map((p) => ({ name: p.name, label: p.label, avatarSrc: personaAvatarSrc(p) })),
);
render();
preloadAvatarFrames();
client.start();
