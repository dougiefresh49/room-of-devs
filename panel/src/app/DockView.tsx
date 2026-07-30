/**
 * Dock mode: speaker spotlight row + bottom avatar pill. DOM mirrors the
 * legacy renderDock()/renderDockSpotlight()/renderDockAgent().
 *
 * Mounted in the dock NSPanel window (its own realm); Rust owns window
 * visibility and initial placement, this view owns pill geometry.
 */
import { useLayoutEffect } from "react";
import type { AgentView, NowPlaying, PanelSnapshot } from "@room/protocol";
import {
  CrtFace,
  FailedCountBadge,
  Led,
  LiveBadge,
  SalienceBar,
  stripMarkdown,
  SummaryText,
} from "@room/ui";
import { isPhoneRoutedFrame, nowPlayingKey } from "@room/room-client";
import { client } from "../client.js";
import { platform } from "../platform/tauri.js";
import { dragRegionMouseDown } from "./drag.js";
import { ActionCluster, type ClusterMode } from "./ActionCluster.js";
import { AvatarImg } from "./AvatarImg.js";
import { clusterMode, handleClusterAction } from "./cluster-actions.js";
import { dispatchCommand } from "./commands.js";
import { latestCrossRealmPending } from "./grant-guard.js";
import { IconCc, IconExpand } from "./icons.js";
import { PERSONAS, personaAvatarSrc } from "./personas.js";
import { setSwapOpen, type IslandUiState } from "./ui-state.js";
import {
  dismissSummary,
  dockHoverEnter,
  dockHoverLeave,
  showErrorToast,
  toggleCaptions,
  toggleDockSummaryExpanded,
  type ViewState,
} from "./view-state.js";
import { usePttGrant } from "./usePttGrant.js";

const PERSONA_OPTIONS = PERSONAS.map((p) => ({
  name: p.name,
  label: p.label,
  avatarSrc: personaAvatarSrc(p),
}));

const DOCK_AVATAR_STEP = 58;
const DOCK_PADDING = 54;
const DOCK_EXPAND_WIDTH = 30;
// Fixed-width salience bar + ticker + lamps row inside the pill; the NSPanel
// is sized from these constants, so the row must be budgeted here too.
const DOCK_SCR_WIDTH = 250;
const DOCK_EXPANDED_WIDTH = 520;
const DOCK_COMPACT_HEIGHT = 144;
// Speaker spotlight row (big avatar + always-on actions + bubble) above the pill.
const DOCK_SPOTLIGHT_HEIGHT = 236;
const DOCK_SPOTLIGHT_EXPANDED = 300;

/** Local salience threshold notch (segment index ≈ 35% of 16). */
const DOCK_SALIENCE_SEGMENTS = 16;
const DOCK_SALIENCE_THRESHOLD_PCT = 35;

const stateLabels: Record<AgentView["state"], string> = {
  working: "working",
  hand_raised: "hand raised",
  speaking: "speaking",
  idle: "idle",
};

/** Per-state "clear" contribution — lower = closer to needing you. */
const CLEAR_BY_STATE: Record<AgentView["state"], number> = {
  hand_raised: 20,
  speaking: 55,
  working: 70,
  idle: 100,
};

// P3: replace with snapshot.salience
function dockSalienceClear(agents: AgentView[]): number {
  if (!agents.length) return 100;
  let min = 100;
  for (const a of agents) {
    const v = CLEAR_BY_STATE[a.state] ?? 100;
    if (v < min) min = v;
  }
  return min;
}

function dockTickerText(agents: AgentView[]): string {
  if (!agents.length) return "ROOM · NO AGENTS";
  return agents
    .map((a) => {
      const name = (a.label ?? a.name).toUpperCase();
      const state = stateLabels[a.state].toUpperCase();
      const preview = a.queuedPreview?.trim();
      return preview
        ? `${name} · ${state} · ${preview}`
        : `${name} · ${state}`;
    })
    .join("  ◆  ");
}

interface Spotlight {
  agent?: AgentView;
  onStage: boolean;
  bubble: boolean;
  loading: boolean;
}

interface DockViewProps {
  snapshot: PanelSnapshot | null;
  connected: boolean;
  staleSessions: ReadonlySet<string>;
  view: ViewState;
  ui: IslandUiState;
}

/** Most recent pending grant — the one the dock spotlight stages. Checks
 *  this realm's optimism first, then the cross-realm marker belt (a grant
 *  fired from the other window just before a mode switch — Sol review). */
function latestPendingGrantSessionId(): string | null {
  let latest: string | null = null;
  for (const sessionId of client.getState().pendingGrants.keys()) latest = sessionId;
  return latest ?? latestCrossRealmPending();
}

// The speaker spotlight replaces both the centered caption bubble and the
// in-pill scale-pop: while someone speaks (or their last summary lingers),
// a dedicated row above the pill holds a big flapping avatar, an always-on
// action row, and the bubble to its right. Pending grants stage immediately.
function dockSpotlight(
  agents: AgentView[],
  nowPlaying: NowPlaying | null,
  connected: boolean,
  view: ViewState,
): Spotlight | null {
  const pendingSessionId = latestPendingGrantSessionId();
  if (pendingSessionId) {
    const agent = agents.find((a) => a.sessionId === pendingSessionId);
    if (agent) return { agent, onStage: false, bubble: false, loading: true };
  }

  const np = nowPlaying;
  if (!np || np.kind === "ack" || isPhoneRoutedFrame(np)) return null;
  const agent = agents.find((a) => a.sessionId === np.sessionId);
  const onStage = !np.endedAt && !!agent && connected;
  const bubble =
    view.dockCaptions && !!np.text && view.dockSummaryDismissedKey !== nowPlayingKey(np);
  if (!onStage && !bubble) return null;
  return { agent, onStage, bubble, loading: false };
}

export function DockView({ snapshot, connected, staleSessions, view, ui }: DockViewProps) {
  const agents = snapshot?.agents ?? [];
  const nowPlaying = snapshot?.nowPlaying ?? null;
  const spot = dockSpotlight(agents, nowPlaying, connected, view);

  // Live speaker pops out of the pill — one avatar on stage, not two.
  const pillAgents =
    spot?.onStage && spot.agent
      ? agents.filter((a) => a.sessionId !== spot.agent!.sessionId)
      : agents;

  const pillCount = Math.max(pillAgents.length, 1);
  const compactWidth =
    pillCount * DOCK_AVATAR_STEP + DOCK_SCR_WIDTH + DOCK_PADDING + DOCK_EXPAND_WIDTH;
  const width = spot ? Math.max(compactWidth, DOCK_EXPANDED_WIDTH) : compactWidth;
  const height = !spot
    ? DOCK_COMPACT_HEIGHT
    : view.dockSummaryExpanded
      ? DOCK_SPOTLIGHT_EXPANDED
      : DOCK_SPOTLIGHT_HEIGHT;

  // Geometry re-asserts only when the SIZE changes (Sol 4b: unbounded
  // per-commit async geometry calls can interleave); Rust already places
  // the window bottom-center on every dock entry, so a dragged dock now
  // stays put until its size changes — deliberate delta from the legacy
  // recenter-on-every-snapshot behavior. Layout effect: resize must start
  // before paint.
  useLayoutEffect(() => {
    void platform.enterDockLayout(width, height);
  }, [width, height]);

  const clearPct = dockSalienceClear(agents);
  const litSegs = Math.round(DOCK_SALIENCE_SEGMENTS * clearPct / 100);
  const thSeg = Math.round(DOCK_SALIENCE_SEGMENTS * DOCK_SALIENCE_THRESHOLD_PCT / 100);
  const ticker = dockTickerText(agents);
  const anyRaised = agents.some((a) => a.state === "hand_raised");
  const anyWorking = agents.some((a) => a.state === "working");
  const allSettled =
    agents.length > 0 && agents.every((a) => a.state === "idle");

  return (
    <main
      className={`dock-shell drag-region${connected ? "" : " disconnected"}`}
      data-tauri-drag-region
      onMouseDown={dragRegionMouseDown}
    >
      {(snapshot?.failedCount ?? 0) > 0 ? (
        <div className="dock-failed-badge no-drag">
          <FailedCountBadge count={snapshot?.failedCount ?? 0} />
        </div>
      ) : null}
      {spot ? (
        <DockSpotlight
          spot={spot}
          nowPlaying={nowPlaying}
          view={view}
          ui={ui}
          connected={connected}
          paused={snapshot?.paused === true}
        />
      ) : null}
      <div className="dock-pill" data-tauri-drag-region>
        <button
          type="button"
          className={`icon-btn dock-caption-toggle no-drag${view.dockCaptions ? " active" : ""}`}
          title={view.dockCaptions ? "Hide captions" : "Show captions"}
          aria-pressed={view.dockCaptions}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            toggleCaptions();
          }}
        >
          <IconCc />
        </button>
        <div className="dock-avatars">
          {pillAgents.length ? (
            pillAgents.map((agent) => (
              <DockAgent
                key={agent.sessionId}
                agent={agent}
                connected={connected}
                stale={staleSessions.has(agent.sessionId)}
                triageFocus={snapshot?.triageFocus === agent.sessionId}
                hovered={view.dockHoverSessionId === agent.sessionId}
                paused={snapshot?.paused === true}
                ui={ui}
              />
            ))
          ) : (
            <span className="dock-empty">No agents</span>
          )}
        </div>
        <div className="dock-scr no-drag">
          {/* P3: replace with snapshot.salience */}
          <SalienceBar
            segments={DOCK_SALIENCE_SEGMENTS}
            lit={litSegs}
            threshold={thSeg}
          />
          <div className="dock-tick" title={ticker}>
            <span className="dock-tick-marquee">{ticker}</span>
            <span className="dock-tick-static">{ticker}</span>
          </div>
          <div className="dock-dled" aria-label="Room status lamps">
            <Led
              tone={anyRaised ? "red" : "dim"}
              pulse={anyRaised}
              title={anyRaised ? "hand raised" : "no raised hands"}
            />
            <Led
              tone={anyWorking ? "amber" : "dim"}
              pulse={anyWorking}
              title={anyWorking ? "working" : "none working"}
            />
            <Led
              tone={allSettled ? "green" : "dim"}
              title={allSettled ? "all idle" : "not all idle"}
            />
          </div>
        </div>
        <button
          type="button"
          className="icon-btn dock-expand no-drag"
          title="Expand room"
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            void platform.setRoomMode("floating").then((ok) => {
              if (!ok) showErrorToast("Couldn't expand the room");
            });
          }}
        >
          <IconExpand />
        </button>
      </div>
    </main>
  );
}

function DockAgent({
  agent,
  connected,
  stale,
  triageFocus,
  hovered,
  paused,
  ui,
}: {
  agent: AgentView;
  connected: boolean;
  stale: boolean;
  triageFocus: boolean;
  hovered: boolean;
  paused: boolean;
  ui: IslandUiState;
}) {
  const ptt = usePttGrant(agent.sessionId, connected);
  const greyed = !connected || stale;
  const mode = clusterMode(agent.sessionId);
  const displayName = agent.label ?? agent.name;

  return (
    <div
      className={`dock-agent state-${agent.state}${greyed ? " disconnected" : ""}${stale ? " stale" : ""}${triageFocus ? " triage-focus" : ""}${hovered ? " hover-intent" : ""}`}
      data-session={agent.sessionId}
      onMouseEnter={() => dockHoverEnter(agent.sessionId)}
      onMouseLeave={() => dockHoverLeave(agent.sessionId)}
    >
      <button
        type="button"
        className="dock-avatar-btn"
        title={
          connected
            ? `${displayName} - ${stateLabels[agent.state]}`
            : `${displayName} - room is offline`
        }
        aria-label={`${displayName}, ${stateLabels[agent.state]}${connected ? "" : ", room offline"}`}
        aria-disabled={!connected}
        {...ptt.gesture}
      >
        <span className="dock-ring">
          <CrtFace size={52} scanlines>
            <AvatarImg
              agent={agent}
              imgClassName="avatar dock-avatar"
              fallbackClassName="avatar-fallback dock-fallback"
            />
          </CrtFace>
        </span>
        {agent.raisedCount > 0 ? (
          <span
            className="dock-badge"
            title={`${agent.raisedCount} update${agent.raisedCount > 1 ? "s" : ""} waiting`}
          >
            {agent.raisedCount}
          </span>
        ) : null}
      </button>
      <div
        className={`dock-actions actions-${mode === "stage" ? 3 : 5}`}
        aria-label="Agent actions"
      >
        <ActionCluster
          mode={mode}
          isTeam={agent.isTeam}
          connected={connected}
          paused={paused}
          killArmed={ui.killArmed.has(agent.sessionId)}
          swapOpen={ui.swapOpen === agent.sessionId}
          personas={PERSONA_OPTIONS}
          onAction={(action) => handleClusterAction(agent.sessionId, action)}
          onSwapOpenChange={(open) => setSwapOpen(open ? agent.sessionId : null)}
          onSwapCharacter={(character) => {
            dispatchCommand(
              { type: "set_voice", sessionId: agent.sessionId, character },
              "Couldn't swap character",
            );
            setSwapOpen(null);
          }}
        />
      </div>
    </div>
  );
}

function DockSpotlight({
  spot,
  nowPlaying,
  view,
  ui,
  connected,
  paused,
}: {
  spot: Spotlight;
  nowPlaying: NowPlaying | null;
  view: ViewState;
  ui: IslandUiState;
  connected: boolean;
  paused: boolean;
}) {
  const { agent, onStage, bubble, loading } = spot;

  let column: React.ReactNode = null;
  if (agent) {
    // Keyed by staged message: remount replays the 280ms slide-in CSS
    // animation exactly when the legacy time-window logic showed it —
    // without mutating refs or reading clocks during render.
    const enterKey = loading
      ? `pending:${agent.sessionId}`
      : nowPlaying
        ? `${nowPlaying.sessionId}:${nowPlaying.startedAt}`
        : agent.sessionId;
    const mode: ClusterMode | null = loading ? null : onStage ? "stage" : "summary";
    column = (
      <div
        key={enterKey}
        className="spotlight-col no-drag spotlight-enter"
        data-session={agent.sessionId}
      >
        {mode ? (
          <div className="spotlight-actions" aria-label="Speaker actions">
            <ActionCluster
              mode={mode}
              isTeam={agent.isTeam}
              connected={connected}
              paused={paused}
              killArmed={ui.killArmed.has(agent.sessionId)}
              swapOpen={ui.swapOpen === agent.sessionId}
              personas={PERSONA_OPTIONS}
              onAction={(action) => handleClusterAction(agent.sessionId, action)}
              onSwapOpenChange={(open) => setSwapOpen(open ? agent.sessionId : null)}
              onSwapCharacter={(character) => {
                dispatchCommand(
                  { type: "set_voice", sessionId: agent.sessionId, character },
                  "Couldn't swap character",
                );
                setSwapOpen(null);
              }}
            />
          </div>
        ) : null}
        <span
          className={`spotlight-ring${onStage ? " on-stage" : ""}${loading ? " loading" : ""}`}
          data-character={(agent.character ?? "default").toLowerCase()}
        >
          <CrtFace size={58} halo={onStage} scanlines>
            <AvatarImg
              agent={agent}
              imgClassName="avatar spotlight-avatar"
              fallbackClassName="avatar-fallback spotlight-fallback"
            />
          </CrtFace>
        </span>
        <LiveBadge live={agent.live} />
      </div>
    );
  }

  let bubbleNode: React.ReactNode = null;
  if (bubble && nowPlaying) {
    const name = agent?.label ?? agent?.name ?? "Room";
    const raw = (nowPlaying.rawText?.trim() || nowPlaying.text).trim();
    bubbleNode = (
      <button
        type="button"
        className={`dock-caption no-drag${view.dockSummaryExpanded ? " expanded" : ""}${nowPlaying.endedAt ? " ended" : ""}`}
        aria-expanded={view.dockSummaryExpanded}
        title={view.dockSummaryExpanded ? "Collapse summary" : "Expand summary"}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          toggleDockSummaryExpanded();
        }}
      >
        <span className="dock-caption-name">{name}</span>
        <span
          className="dock-caption-close"
          title="Dismiss"
          aria-hidden="true"
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            dismissSummary(nowPlayingKey(nowPlaying));
          }}
        >
          <IconCloseInline />
        </span>
        <span className="dock-caption-summary">
          {view.dockSummaryExpanded ? <SummaryText text={raw} /> : stripMarkdown(raw)}
        </span>
      </button>
    );
  }

  return (
    <div className="dock-spotlight">
      {column}
      {bubbleNode}
    </div>
  );
}

// The caption ✕ is a span INSIDE the caption button (a button can't nest a
// button); same shape as the legacy template.
function IconCloseInline() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}
