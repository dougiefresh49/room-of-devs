import "./style.css";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  LogicalPosition,
  LogicalSize,
  PhysicalPosition,
  PhysicalSize,
  currentMonitor,
  getCurrentWindow,
} from "@tauri-apps/api/window";

type AgentState = "working" | "hand_raised" | "speaking" | "idle";

interface AgentView {
  sessionId: string;
  character: string;
  name: string;
  label?: string;
  state: AgentState;
  raisedCount: number;
  supersededCount: number;
  muted: boolean;
  isTeam: boolean;
}

interface NowPlaying {
  sessionId: string;
  text: string;
  // ISO string from the server; parsed to epoch ms for karaoke highlighting.
  startedAt: string | number;
  approxCharsPerSec: number;
  playbackRate?: number;
  // [word, startMs] tuples when the server streamed with ElevenLabs timestamps.
  alignment?: [string, number][];
}

interface WsConfig {
  token: string;
  port: number;
}

interface ResumableSession {
  sessionId: string;
  dir: string;
  project: string;
  mtimeMs: number;
  sizeBytes: number;
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
const RECONNECT_MS = 2000;
const KILL_ARM_MS = 2000;
const FULL_MIN_SIZE = new LogicalSize(300, 240);
const DOCK_MIN_SIZE = new LogicalSize(88, 56);
const DOCK_AVATAR_STEP = 44;
const DOCK_PADDING = 54;
const DOCK_EXPAND_WIDTH = 30;
const DOCK_HEIGHT = 126;
const DOCK_BOTTOM_GAP = 12;
const CAPTIONS_STORAGE_KEY = "roomDockCaptions";
const BUTTON_COLORS: ButtonColor[] = ["white", "blue", "red", "teal", "yellow", "green", "black"];
const LEARN_CAPTURE_MS = 15000;
const PLAYBACK_MODES = ["auto", "announce", "silent"] as const;
const MOODS = ["focus", "arcade", "quiet", "normal"] as const;
const DYNAMIC_ACKS = ["always", "cached", "off"] as const;

const app = document.querySelector<HTMLDivElement>("#app")!;
let ws: WebSocket | null = null;
let connected = false;
let agents: AgentView[] = [];
const staleSessions = new Set<string>();
const killArmed = new Map<string, ReturnType<typeof setTimeout>>();
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let dockMode = false;
let savedWindowFrame: { size: PhysicalSize; position: PhysicalPosition } | null = null;
let roomHeld = false;
let nowPlaying: NowPlaying | null = null;
let captionTimer: ReturnType<typeof setInterval> | null = null;
let dockCaptions = localStorage.getItem(CAPTIONS_STORAGE_KEY) === "1";
let swapOpenSessionId: string | null = null;
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

const icons = {
  pause: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14"/></svg>`,
  stop: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h10v10H7z"/></svg>`,
  replay: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h8a4 4 0 1 1-3.2 6.4"/><path d="M7 7v5H2"/></svg>`,
  hold: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 14c2.8.7 5.2.5 7-.6"/><path d="M14 5a6 6 0 1 0 5 9.3 5 5 0 0 1-5-9.3z"/><path d="M8 9v3"/><path d="M11 8v3"/><path d="M14 9v2.5"/></svg>`,
  swap: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5c2 1.5 6 1.5 8 0"/><path d="M5 7.5c1.7 6 12.3 6 14 0"/><path d="M7 8v4a5 5 0 0 0 10 0V8"/><path d="M9 13h.01M15 13h.01"/><path d="m8 19-3-3 3-3"/><path d="M5 16h6"/></svg>`,
  cc: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="3"/><path d="M10 10.5a2 2 0 1 0 0 3"/><path d="M16 10.5a2 2 0 1 0 0 3"/></svg>`,
  terminal: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 8 3 3-3 3"/><path d="M12 16h5"/><rect x="3" y="4" width="18" height="16" rx="2"/></svg>`,
  power: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v8"/><path d="M7.05 7.05a7 7 0 1 0 9.9 0"/></svg>`,
  info: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/></svg>`,
  dock: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="6" width="14" height="9" rx="4.5"/><path d="m8 18 4 3 4-3"/></svg>`,
  expand: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 14 5-5 5 5"/></svg>`,
  close: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>`,
  gear: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z"/><path d="M19.4 15a1.8 1.8 0 0 0 .36 2l.04.04a2.1 2.1 0 0 1-2.97 2.97l-.04-.04a1.8 1.8 0 0 0-2-.36 1.8 1.8 0 0 0-1.1 1.65V21a2.1 2.1 0 0 1-4.2 0v-.06a1.8 1.8 0 0 0-1.1-1.65 1.8 1.8 0 0 0-2 .36l-.04.04a2.1 2.1 0 1 1-2.97-2.97l.04-.04a1.8 1.8 0 0 0 .36-2 1.8 1.8 0 0 0-1.65-1.1H3a2.1 2.1 0 0 1 0-4.2h.06a1.8 1.8 0 0 0 1.65-1.1 1.8 1.8 0 0 0-.36-2l-.04-.04a2.1 2.1 0 1 1 2.97-2.97l.04.04a1.8 1.8 0 0 0 2 .36h.01a1.8 1.8 0 0 0 1.09-1.65V3a2.1 2.1 0 0 1 4.2 0v.06a1.8 1.8 0 0 0 1.1 1.65 1.8 1.8 0 0 0 2-.36l.04-.04a2.1 2.1 0 1 1 2.97 2.97l-.04.04a1.8 1.8 0 0 0-.36 2 1.8 1.8 0 0 0 1.65 1.1H21a2.1 2.1 0 0 1 0 4.2h-.06a1.8 1.8 0 0 0-1.54.38z"/></svg>`,
  back: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5"/><path d="m11 6-6 6 6 6"/></svg>`,
  folder: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h5l2 2h9a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z"/></svg>`,
} as const;

function send(msg: object) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function setConnected(up: boolean) {
  connected = up;
  render();
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, RECONNECT_MS);
}

function avatarSrc(agent: AgentView): string {
  const character = (agent.character ?? "default").toLowerCase();
  const variant = agent.state === "speaking" ? "speaking" : "idle";
  return `avatars/tmnt/${character}/${variant}.png`;
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
  const teamOnly = !agent.isTeam;
  const killIsArmed = killArmed.has(agent.sessionId);
  const displayName = escapeHtml(agent.label ?? agent.name);
  const safeName = escapeHtml(agent.name);
  const isRenaming = renamingSessionId === agent.sessionId;
  const nameHtml = isRenaming
    ? `<input class="name-input no-drag" data-rename-input value="${displayName}" aria-label="Nickname" />`
    : `<div class="name${mutedClass}" title="${safeName}" data-rename-name>${displayName}</div>`;
  const raisedChip =
    agent.state === "hand_raised"
      ? `<span class="chip raised" title="Hand raised">✋</span>`
      : "";
  const queueChip =
    agent.raisedCount > 0
      ? `<span class="chip queue" title="Queued">${agent.raisedCount}</span>`
      : "";
  const supersededChip =
    agent.supersededCount > 0
      ? `<span class="chip superseded" title="Superseded">${agent.supersededCount}</span>`
      : "";

  return `
    <div
      class="card state-${agent.state}${greyed ? " disconnected" : ""}${staleSessions.has(agent.sessionId) ? " stale" : ""}"
      data-session="${agent.sessionId}"
      role="button"
      tabindex="0"
    >
      <div class="card-main">
        <div class="avatar-wrap">
          <img class="avatar" src="${avatarSrc(agent)}" alt="" />
          <span class="avatar-fallback">${initials(agent.name)}</span>
        </div>
        <div class="card-body">
          ${nameHtml}
          <div class="badge state-${agent.state}">
            <span class="dot"></span>
            <span class="label">${stateLabels[agent.state]}</span>
          </div>
          <div class="chips">${raisedChip}${queueChip}${supersededChip}</div>
        </div>
      </div>
      <div class="card-actions" aria-label="Agent actions">
        <button
          type="button"
          class="icon-btn hover-btn${teamOnly ? " disabled" : ""}"
          data-hover-action="focus"
          title="${teamOnly ? "team sessions only" : "Jump to terminal"}"
          ${teamOnly ? "disabled" : ""}
        >${icons.terminal}</button>
        <button
          type="button"
          class="icon-btn hover-btn kill-btn${teamOnly ? " disabled" : ""}${killIsArmed ? " armed" : ""}"
          data-hover-action="kill"
          title="${teamOnly ? "team sessions only" : killIsArmed ? "click again to end session" : "End session"}"
          ${teamOnly ? "disabled" : ""}
        >${icons.power}</button>
        <button
          type="button"
          class="icon-btn hover-btn"
          data-hover-action="status"
          title="Speak status"
        >${icons.info}</button>
        <button
          type="button"
          class="icon-btn hover-btn"
          data-hover-action="swap"
          title="Swap character"
        >${icons.swap}</button>
      </div>
      ${swapOpenSessionId === agent.sessionId ? renderSwapPopover(agent.sessionId) : ""}
    </div>
  `;
}

function renderSwapPopover(sessionId: string): string {
  return `
    <div class="swap-popover no-drag" data-swap-popover data-session="${escapeHtml(sessionId)}">
      ${PERSONAS.map((p) => `
        <button type="button" class="swap-chip" data-swap-character="${p.name}" title="${p.label}">
          <span class="swap-chip-av">
            <img class="avatar swap-chip-img" src="${personaAvatarSrc(p)}" alt="" />
            <span class="avatar-fallback swap-chip-fallback">${p.label[0]}</span>
          </span>
          <span>${p.label}</span>
        </button>
      `).join("")}
    </div>`;
}

function renderDockAgent(agent: AgentView): string {
  const greyed = !connected || staleSessions.has(agent.sessionId);
  const teamOnly = !agent.isTeam;
  const killIsArmed = killArmed.has(agent.sessionId);
  const displayName = escapeHtml(agent.label ?? agent.name);
  const safeName = escapeHtml(agent.name);

  return `
    <div
      class="dock-agent state-${agent.state}${greyed ? " disconnected" : ""}${staleSessions.has(agent.sessionId) ? " stale" : ""}"
      data-session="${agent.sessionId}"
    >
      <button
        type="button"
        class="dock-avatar-btn"
        title="${safeName} - ${stateLabels[agent.state]}"
        aria-label="${displayName}, ${stateLabels[agent.state]}"
      >
        <span class="dock-ring">
          <img class="avatar dock-avatar" src="${avatarSrc(agent)}" alt="" />
          <span class="avatar-fallback dock-fallback">${initials(agent.name)}</span>
        </span>
        ${agent.raisedCount > 0 ? `<span class="dock-badge" title="${agent.raisedCount} update${agent.raisedCount > 1 ? "s" : ""} waiting">${agent.raisedCount}</span>` : ""}
      </button>
      <div class="dock-actions" aria-label="Agent actions">
        <button
          type="button"
          class="icon-btn hover-btn${teamOnly ? " disabled" : ""}"
          data-hover-action="focus"
          title="${teamOnly ? "team sessions only" : "Jump to terminal"}"
          ${teamOnly ? "disabled" : ""}
        >${icons.terminal}</button>
        <button
          type="button"
          class="icon-btn hover-btn kill-btn${teamOnly ? " disabled" : ""}${killIsArmed ? " armed" : ""}"
          data-hover-action="kill"
          title="${teamOnly ? "team sessions only" : killIsArmed ? "click again to end session" : "End session"}"
          ${teamOnly ? "disabled" : ""}
        >${icons.power}</button>
        <button
          type="button"
          class="icon-btn hover-btn"
          data-hover-action="status"
          title="Speak status"
        >${icons.info}</button>
      </div>
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

function dockWidth(): number {
  return Math.max(agents.length, 1) * DOCK_AVATAR_STEP + DOCK_PADDING + DOCK_EXPAND_WIDTH;
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
    await win.setMinSize(DOCK_MIN_SIZE);
    await win.setSize(new LogicalSize(width, DOCK_HEIGHT));

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
          Math.round(monitorY + monitorHeight - DOCK_HEIGHT - DOCK_BOTTOM_GAP),
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
  app.innerHTML = `
    <main class="dock-shell drag-region${connected ? "" : " disconnected"}" data-tauri-drag-region>
      ${renderDockCaption()}
      <div class="dock-pill" data-tauri-drag-region>
        <button
          type="button"
          class="icon-btn dock-caption-toggle no-drag${dockCaptions ? " active" : ""}"
          data-window-action="captions-toggle"
          title="${dockCaptions ? "Hide captions" : "Show captions"}"
          aria-pressed="${dockCaptions}"
        >${icons.cc}</button>
        <div class="dock-avatars">
          ${agents.length ? agents.map(renderDockAgent).join("") : '<span class="dock-empty">No agents</span>'}
        </div>
        <button type="button" class="icon-btn dock-expand no-drag" data-window-action="dock-off" title="Expand room">
          ${icons.expand}
        </button>
      </div>
    </main>
  `;

  bindHoverActions();
  bindWindowActions();
  bindGrantTargets();
  bindAvatars();
  bindDrag();
  startCaptionSync();
}

function renderDockCaption(): string {
  if (!dockCaptions || !nowPlaying?.text) return "";
  const agent = agents.find((a) => a.sessionId === nowPlaying?.sessionId);
  const name = escapeHtml(agent?.label ?? agent?.name ?? "Room");
  const align = nowPlaying.alignment;

  // Karaoke mode: render each word as a span the sync loop can highlight.
  if (align && align.length) {
    const words = align
      .map(
        ([word], i) =>
          `<span class="dock-caption-word" data-caption-word="${i}">${escapeHtml(word)}</span>`
      )
      .join(" ");
    return `
      <div class="dock-caption dock-caption-karaoke no-drag">
        <span class="dock-caption-name">${name}</span>
        <span class="dock-caption-track" data-caption-track>
          <span class="dock-caption-words" data-caption-words>${words}</span>
        </span>
      </div>`;
  }

  // Fallback: time-paced marquee when no alignment is available.
  const text = escapeHtml(nowPlaying.text);
  const cps = Number.isFinite(nowPlaying.approxCharsPerSec) && nowPlaying.approxCharsPerSec > 0
    ? nowPlaying.approxCharsPerSec
    : 14;
  const duration = Math.max(1.2, nowPlaying.text.length / cps);
  const key = `${nowPlaying.sessionId}-${nowPlaying.startedAt}-${nowPlaying.text.length}`;
  return `
    <div class="dock-caption no-drag" data-caption-key="${escapeHtml(key)}">
      <span class="dock-caption-name">${name}</span>
      <span class="dock-caption-track">
        <span class="dock-caption-text" style="--caption-duration: ${duration.toFixed(2)}s">${text}</span>
      </span>
    </div>`;
}

function startedAtMs(np: NowPlaying): number {
  if (typeof np.startedAt === "number") return np.startedAt;
  const parsed = Date.parse(np.startedAt);
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

function stopCaptionSync() {
  if (captionTimer) {
    clearInterval(captionTimer);
    captionTimer = null;
  }
}

// Drive word-by-word highlighting from wall-clock elapsed vs. each word's
// startMs, and keep the active word scrolled to center. No-op unless the dock
// caption is showing an aligned track.
function startCaptionSync() {
  stopCaptionSync();
  const np = nowPlaying;
  if (!dockMode || !dockCaptions || !np?.alignment?.length) return;
  const wordsEl = app.querySelector<HTMLElement>("[data-caption-words]");
  const trackEl = app.querySelector<HTMLElement>("[data-caption-track]");
  if (!wordsEl || !trackEl) return;

  const align = np.alignment;
  const started = startedAtMs(np);
  const spans = Array.from(
    wordsEl.querySelectorAll<HTMLElement>(".dock-caption-word")
  );
  let lastActive = -2;

  const tick = () => {
    const rate = Number.isFinite(np.playbackRate) && (np.playbackRate ?? 0) > 0 ? np.playbackRate ?? 1 : 1;
    const elapsed = (Date.now() - started) * rate;
    let active = -1;
    for (let i = 0; i < align.length; i++) {
      if (elapsed >= align[i][1]) active = i;
      else break;
    }
    if (active === lastActive) return;
    lastActive = active;
    spans.forEach((s, i) => s.classList.toggle("active", i === active));
    const el = spans[active];
    if (el) {
      const offset = Math.max(
        0,
        el.offsetTop + el.offsetHeight / 2 - trackEl.clientHeight / 2
      );
      trackEl.scrollTo({ top: offset, behavior: "smooth" });
    }
  };

  tick();
  captionTimer = setInterval(tick, 100);
}

function render() {
  // The caption sync is restarted by renderDock() when applicable; clear it on
  // every render so it never runs against stale DOM after a re-render.
  stopCaptionSync();

  if (dockMode) {
    renderDock();
    return;
  }

  if (pickerOpen) {
    renderPicker();
    return;
  }

  if (settingsOpen) {
    renderSettings();
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
        <button type="button" class="icon-btn window-btn" data-window-action="dock-on" title="Dock room">${icons.dock}</button>
        <button type="button" class="icon-btn window-btn" data-window-action="close" title="Close room">${icons.close}</button>
      </div>
    </header>
    <main class="cards${connected ? "" : " disconnected"}" id="cards">
      ${agents.length ? agents.map(renderCard).join("") : '<p class="empty">No agents</p>'}
    </main>
    <footer class="controls no-drag">
      <button type="button" class="icon-btn" data-action="pause" title="Pause / resume playback">${icons.pause}</button>
      <button type="button" class="icon-btn" data-action="stop" title="Stop playback">${icons.stop}</button>
      <button type="button" class="icon-btn" data-action="replay" title="Replay last message (free)">${icons.replay}</button>
      <button type="button" class="icon-btn hold-control${roomHeld ? " active" : ""}" data-action="hold" title="${roomHeld ? "Release the room" : "Hold the room"}" aria-pressed="${roomHeld}">${icons.hold}</button>
    </footer>
    ${toastHtml()}
  `);

  bindCards();
  bindHoverActions();
  bindRename();
  bindControls();
  bindWindowActions();
  bindAvatars();
  bindDrag();
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
      ${body}
    </main>
    ${toastHtml()}
  `);

  bindWindowActions();
  bindPickerTabs();
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
      if (sessionId) {
        send({ type: "resume_session", sessionId, dir, persona });
      } else {
        send({ type: "spawn_session", dir, persona });
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

function commitButtonPatch(idx: string, patch: Partial<ButtonConfig>) {
  if (!buttonsWritable) return;
  buttonMappings[idx] = { ...(buttonMappings[idx] ?? { name: `Button ${idx}` }), ...patch };
  send({ type: "set_button", idx: Number(idx), patch });
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
    send({ type: "set_button", idx: Number(idx), patch });
    render();
    return;
  }

  const oldIdx = capture.oldIdx;
  if (!oldIdx) return;
  const existing = buttonMappings[oldIdx] ?? { name: `Button ${oldIdx}` };
  buttonMappings[idx] = { ...existing };
  send({ type: "set_button", idx: Number(idx), patch: existing });
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
        localStorage.setItem(CAPTIONS_STORAGE_KEY, dockCaptions ? "1" : "0");
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

    target.addEventListener("click", () => {
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      send({ type: "grant", sessionId });
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

function bindControls() {
  app.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      if (action === "pause") send({ type: "pause" });
      else if (action === "stop") send({ type: "stop" });
      else if (action === "replay") send({ type: "replay" });
      else if (action === "hold") send({ type: "hold_room" });
    });
  });
}

function armKill(sessionId: string) {
  const existing = killArmed.get(sessionId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    killArmed.delete(sessionId);
    render();
  }, KILL_ARM_MS);
  killArmed.set(sessionId, timer);
}

function bindHoverActions() {
  app.querySelectorAll<HTMLButtonElement>("[data-hover-action]").forEach((btn) => {
    const sessionEl = btn.closest<HTMLElement>("[data-session]");
    if (!sessionEl) return;
    const sessionId = sessionEl.dataset.session!;

    btn.addEventListener("mousedown", (e) => e.stopPropagation());
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (btn.disabled) return;

      const action = btn.dataset.hoverAction;
      if (action === "focus") {
        send({ type: "focus_terminal", sessionId });
      } else if (action === "status") {
        send({ type: "status_say", sessionId });
      } else if (action === "kill") {
        if (killArmed.has(sessionId)) {
          const timer = killArmed.get(sessionId)!;
          clearTimeout(timer);
          killArmed.delete(sessionId);
          send({ type: "kill_team", sessionId });
        } else {
          armKill(sessionId);
          render();
        }
      } else if (action === "swap") {
        swapOpenSessionId = swapOpenSessionId === sessionId ? null : sessionId;
        render();
      }
    });
  });
}

function bindCards() {
  bindGrantTargets();
  app.querySelectorAll<HTMLElement>("[data-swap-popover]").forEach((popover) => {
    popover.addEventListener("mousedown", (e) => e.stopPropagation());
    popover.addEventListener("click", (e) => e.stopPropagation());
  });
  app.querySelectorAll<HTMLButtonElement>("[data-swap-character]").forEach((btn) => {
    const sessionEl = btn.closest<HTMLElement>("[data-session]");
    if (!sessionEl) return;
    const sessionId = sessionEl.dataset.session!;
    btn.addEventListener("mousedown", (e) => e.stopPropagation());
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const character = btn.dataset.swapCharacter;
      if (!character) return;
      send({ type: "set_voice", sessionId, character });
      swapOpenSessionId = null;
      render();
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
      swapOpenSessionId = null;
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

function handleMessage(raw: string) {
  let msg: {
    type: string;
    agents?: AgentView[];
    code?: string;
    sessionId?: string;
    dirs?: string[];
    sessions?: ResumableSession[];
    nowPlaying?: NowPlaying | null;
    roomHeld?: boolean;
    device_hint?: string;
    buttons?: Record<string, ButtonConfig>;
    actions?: string[];
    characters?: string[];
    idx?: number | string;
    sections?: ShortcutSection[];
    settings?: unknown;
    voices?: unknown;
  };
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }

  if (msg.type === "snapshot" && Array.isArray(msg.agents)) {
    agents = msg.agents;
    roomHeld = typeof msg.roomHeld === "boolean" ? msg.roomHeld : false;
    nowPlaying = msg.nowPlaying && typeof msg.nowPlaying.text === "string" ? msg.nowPlaying : null;
    if (swapOpenSessionId && !agents.some((a) => a.sessionId === swapOpenSessionId)) {
      swapOpenSessionId = null;
    }
    if (renamingSessionId && !agents.some((a) => a.sessionId === renamingSessionId)) {
      renamingSessionId = null;
    }
    staleSessions.clear();
    for (const sid of killArmed.keys()) {
      if (!agents.some((a) => a.sessionId === sid)) {
        const t = killArmed.get(sid);
        if (t) clearTimeout(t);
        killArmed.delete(sid);
      }
    }
    render();
    if (dockMode) void enterDockMode();
    return;
  }

  if (msg.type === "known_dirs" && Array.isArray(msg.dirs)) {
    knownDirsList = msg.dirs;
    if (pickerOpen) render();
    return;
  }

  if (msg.type === "resumable" && Array.isArray(msg.sessions)) {
    resumableList = msg.sessions;
    if (pickerOpen) render();
    return;
  }

  if (msg.type === "buttons") {
    buttonDeviceHint = typeof msg.device_hint === "string" ? msg.device_hint : "";
    buttonMappings = msg.buttons && typeof msg.buttons === "object" ? msg.buttons : {};
    buttonActions = Array.isArray(msg.actions) ? msg.actions.filter((v): v is string => typeof v === "string") : [];
    buttonCharacters = Array.isArray(msg.characters) ? msg.characters.filter((v): v is string => typeof v === "string") : [];
    buttonsLoaded = true;
    buttonsWritable = true;
    if (settingsOpen && settingsTab === "buttons") render();
    return;
  }

  if (msg.type === "settings" || msg.type === "get_settings") {
    settings = normalizeSettings(msg.values ?? msg.settings ?? msg);
    settingsLoaded = true;
    settingsWritable = true;
    if (settingsOpen && settingsTab === "general") render();
    return;
  }

  if (msg.type === "voices" || msg.type === "list_voices") {
    settingsVoices = normalizeVoices(msg.voices);
    voicesLoaded = true;
    if (settingsOpen && settingsTab === "general") render();
    return;
  }

  if (msg.type === "captured" && msg.idx != null) {
    handleCapturedButton(String(msg.idx));
    return;
  }

  if (msg.type === "shortcuts" && Array.isArray(msg.sections)) {
    shortcutsSections = msg.sections
      .filter((section) => section && typeof section.title === "string" && Array.isArray(section.rows))
      .map((section) => ({
        title: section.title,
        rows: section.rows.filter((row): row is [string, string] =>
          Array.isArray(row) && typeof row[0] === "string" && typeof row[1] === "string",
        ),
      }));
    shortcutsLoaded = true;
    shortcutsAvailable = true;
    if (settingsOpen && settingsTab === "help") render();
    return;
  }

  if (msg.type === "error" && msg.code === "stale_session" && msg.sessionId) {
    staleSessions.add(msg.sessionId);
    render();
    return;
  }

  if (msg.type === "error" && msg.code && msg.code in PICKER_ERROR_TEXT) {
    showErrorToast(PICKER_ERROR_TEXT[msg.code]);
    return;
  }

  if (msg.type === "error" && msg.code === "no_device") {
    cancelLearnCapture();
    showErrorToast("No button device detected");
    return;
  }

  if (msg.type === "error" && msg.code && ["unknown_command", "unsupported", "not_implemented"].includes(msg.code)) {
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
}

async function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  let config: WsConfig;
  try {
    config = await invoke<WsConfig>("ws_token");
  } catch (err) {
    console.error("ws_token failed:", err);
    setConnected(false);
    scheduleReconnect();
    return;
  }

  const url = `ws://127.0.0.1:${config.port}/?token=${encodeURIComponent(config.token)}`;
  ws = new WebSocket(url);

  ws.onopen = () => setConnected(true);
  ws.onclose = () => {
    setConnected(false);
    ws = null;
    scheduleReconnect();
  };
  ws.onerror = () => {
    setConnected(false);
  };
  ws.onmessage = (ev) => handleMessage(String(ev.data));
}

render();
connect();
