/**
 * The floating room: header strip, cards grid, optional summary pane.
 *
 * The global transport footer (pause/stop/replay/hold) was removed — the
 * owner never used it and mobile has no equivalent. Those actions remain
 * reachable elsewhere: pause/stop on the per-card stage cluster (a speaking
 * card), replay-last on the dock spotlight summary cluster, and hold-room in
 * Settings ("Hold the Room").
 */
import type { PanelSnapshot } from "@room/protocol";
import { SummaryText } from "@room/ui";
import { nowPlayingKey } from "@room/room-client";
import { platform } from "../platform/tauri.js";
import { AgentCard } from "./AgentCard.js";
import { IconCc, IconClose, IconDock, IconGear, IconPlus } from "./icons.js";
import type { IslandUiState } from "./ui-state.js";
import {
  dismissSummary,
  openPicker,
  openSettings,
  toggleSummaryPane,
  type ViewState,
} from "./view-state.js";

interface RoomViewProps {
  snapshot: PanelSnapshot | null;
  connected: boolean;
  staleSessions: ReadonlySet<string>;
  view: ViewState;
  ui: IslandUiState;
  clock: number;
}

/** Header/window buttons stop all gesture-adjacent propagation (legacy
 *  bindWindowActions contract). */
function windowBtnProps(onActivate: () => void) {
  return {
    onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
    onMouseDown: (e: React.MouseEvent) => e.stopPropagation(),
    onClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      onActivate();
    },
  };
}

export function RoomView({ snapshot, connected, staleSessions, view, ui, clock }: RoomViewProps) {
  const agents = snapshot?.agents ?? [];
  const nowPlaying = snapshot?.nowPlaying ?? null;
  const paused = snapshot?.paused === true;
  const triageFocus =
    typeof snapshot?.triageFocus === "string" && snapshot.triageFocus.trim()
      ? snapshot.triageFocus
      : null;

  // The main window has native macOS decorations in the two-window model
  // (owner decision #1): the titlebar owns title/drag/close, so the in-app
  // header drops those and keeps only the action buttons (Sol #5).
  return (
    <div className="shell">
      <header className="strip">
        <span className="title" />
        <div className="header-actions no-drag">
          <span
            className={`conn-dot ${connected ? "up" : "down"}`}
            title={connected ? "Connected" : "Disconnected"}
          />
          <button type="button" className="icon-btn window-btn" title="New session" {...windowBtnProps(openPicker)}>
            <IconPlus />
          </button>
          <button type="button" className="icon-btn window-btn" title="Settings" {...windowBtnProps(openSettings)}>
            <IconGear />
          </button>
          <button
            type="button"
            className={`icon-btn window-btn${view.roomSummaryPane ? " active" : ""}`}
            title={view.roomSummaryPane ? "Hide summary pane" : "Show summary pane"}
            aria-pressed={view.roomSummaryPane}
            {...windowBtnProps(toggleSummaryPane)}
          >
            <IconCc />
          </button>
          <button
            type="button"
            className="icon-btn window-btn"
            title="Dock room"
            {...windowBtnProps(() => void platform.setRoomMode("dock"))}
          >
            <IconDock />
          </button>
        </div>
      </header>
      <div className="room-body">
        <main className={`cards${connected ? "" : " disconnected"}`} id="cards">
          {agents.length ? (
            agents.map((agent) => (
              <AgentCard
                key={agent.sessionId}
                agent={agent}
                connected={connected}
                stale={staleSessions.has(agent.sessionId)}
                triageFocus={triageFocus === agent.sessionId}
                renaming={view.renamingSessionId === agent.sessionId}
                paused={paused}
                nowPlaying={nowPlaying}
                clock={clock}
                ui={ui}
              />
            ))
          ) : (
            <p className="empty">No agents</p>
          )}
        </main>
        {view.roomSummaryPane ? (
          <SummaryPane snapshot={snapshot} dismissedKey={view.dockSummaryDismissedKey} />
        ) : null}
      </div>
    </div>
  );
}

function SummaryPane({
  snapshot,
  dismissedKey,
}: {
  snapshot: PanelSnapshot | null;
  dismissedKey: string | null;
}) {
  const np = snapshot?.nowPlaying ?? null;
  const dismissed = np && dismissedKey === nowPlayingKey(np);
  const hasText = np && !!np.text && !dismissed;
  if (!hasText || !np) {
    return (
      <aside className="room-summary-pane" aria-label="Spoken summary">
        <p className="room-summary-empty">Nothing spoken yet</p>
      </aside>
    );
  }
  const agent = snapshot?.agents.find((a) => a.sessionId === np.sessionId);
  const name = agent?.label ?? agent?.name ?? "Room";
  return (
    <aside className={`room-summary-pane${np.endedAt ? " ended" : ""}`} aria-label="Spoken summary">
      <div className="room-summary-header">
        <span className="room-summary-name">{name}</span>
        <button
          type="button"
          className="icon-btn room-summary-dismiss"
          title="Dismiss"
          {...windowBtnProps(() => dismissSummary(nowPlayingKey(np)))}
        >
          <IconClose />
        </button>
      </div>
      <div className="room-summary-body">
        <SummaryText text={np.text} rawText={np.rawText} />
      </div>
    </aside>
  );
}
