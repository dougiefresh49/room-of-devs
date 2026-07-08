import "./style.css";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

type AgentState = "working" | "hand_raised" | "speaking" | "idle";

interface AgentView {
  sessionId: string;
  character: string;
  name: string;
  state: AgentState;
  raisedCount: number;
  supersededCount: number;
  muted: boolean;
}

interface WsConfig {
  token: string;
  port: number;
}

const HOLD_MS = 300;
const RECONNECT_MS = 2000;

const app = document.querySelector<HTMLDivElement>("#app")!;
let ws: WebSocket | null = null;
let connected = false;
let agents: AgentView[] = [];
const staleSessions = new Set<string>();
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

const stateLabels: Record<AgentState, string> = {
  working: "working",
  hand_raised: "hand raised",
  speaking: "speaking",
  idle: "idle",
};

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
    <button
      class="card state-${agent.state}${greyed ? " disconnected" : ""}${staleSessions.has(agent.sessionId) ? " stale" : ""}"
      data-session="${agent.sessionId}"
      type="button"
    >
      <div class="avatar-wrap">
        <img class="avatar" src="${avatarSrc(agent)}" alt="" />
        <span class="avatar-fallback">${initials(agent.name)}</span>
      </div>
      <div class="card-body">
        <div class="name${mutedClass}">${escapeHtml(agent.name)}</div>
        <div class="badge state-${agent.state}">
          <span class="dot"></span>
          <span class="label">${stateLabels[agent.state]}</span>
        </div>
        <div class="chips">${raisedChip}${queueChip}${supersededChip}</div>
      </div>
    </button>
  `;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function render() {
  const connClass = connected ? "up" : "down";
  app.innerHTML = `
    <header class="strip drag-region" data-tauri-drag-region>
      <span class="title" data-tauri-drag-region>Room</span>
      <span class="conn-dot ${connClass}" title="${connected ? "Connected" : "Disconnected"}"></span>
    </header>
    <main class="cards${connected ? "" : " disconnected"}" id="cards">
      ${agents.length ? agents.map(renderCard).join("") : '<p class="empty">No agents</p>'}
    </main>
    <footer class="controls no-drag">
      <button type="button" data-action="pause" title="Pause / resume playback">⏸</button>
      <button type="button" data-action="stop" title="Stop playback">⏹</button>
      <button type="button" data-action="replay" title="Replay last message (free)">🔁</button>
    </footer>
  `;

  bindCards();
  bindControls();
  bindAvatars();
  bindDrag();
}

// data-tauri-drag-region needs the start-dragging permission and only covers
// the exact element — a mousedown fallback makes the whole header reliable.
function bindDrag() {
  const header = app.querySelector<HTMLElement>("header.strip");
  header?.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button, .conn-dot")) return;
    void getCurrentWindow().startDragging();
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
    btn.addEventListener("click", () => {
      const action = btn.dataset.action;
      if (action === "pause") send({ type: "pause" });
      else if (action === "stop") send({ type: "stop" });
      else if (action === "replay") send({ type: "replay" });
    });
  });
}

function bindCards() {
  app.querySelectorAll<HTMLButtonElement>(".card").forEach((card) => {
    const sessionId = card.dataset.session!;
    let holdTimer: ReturnType<typeof setTimeout> | null = null;
    let pttActive = false;
    let suppressClick = false;

    const clearHold = () => {
      if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
    };

    card.addEventListener("mousedown", (e) => {
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

    card.addEventListener("mouseup", endHold);
    card.addEventListener("mouseleave", endHold);

    card.addEventListener("click", () => {
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      send({ type: "grant", sessionId });
    });
  });
}

function handleMessage(raw: string) {
  let msg: { type: string; agents?: AgentView[]; code?: string; sessionId?: string };
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }

  if (msg.type === "snapshot" && Array.isArray(msg.agents)) {
    agents = msg.agents;
    staleSessions.clear();
    render();
    return;
  }

  if (msg.type === "error" && msg.code === "stale_session" && msg.sessionId) {
    staleSessions.add(msg.sessionId);
    render();
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
