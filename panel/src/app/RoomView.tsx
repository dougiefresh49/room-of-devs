/**
 * The floating room: header strip, cards grid, optional summary pane,
 * transport footer. DOM mirrors the legacy renderView() exactly.
 */
import type { PanelSnapshot } from "@room/protocol";
import { SummaryText, TransportBar } from "@room/ui";
import { nowPlayingKey } from "@room/room-client";
import { client } from "../client.js";
import { platform } from "../platform/tauri.js";
import { dragRegionMouseDown } from "./drag.js";
import { AgentCard } from "./AgentCard.js";
import { IconCc, IconClose, IconDock, IconGear, IconPlus } from "./icons.js";
import type { IslandUiState } from "./ui-state.js";
import {
  dismissSummary,
  openPicker,
  openSettings,
  setDockMode,
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
  const held = snapshot?.roomHeld === true;
  const triageFocus =
    typeof snapshot?.triageFocus === "string" && snapshot.triageFocus.trim()
      ? snapshot.triageFocus
      : null;

  return (
    <div className="shell">
      <header className="strip drag-region" data-tauri-drag-region onMouseDown={dragRegionMouseDown}>
        <span className="title" data-tauri-drag-region>
          Room
        </span>
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
          <button type="button" className="icon-btn window-btn" title="Dock room" {...windowBtnProps(() => setDockMode(true))}>
            <IconDock />
          </button>
          <button type="button" className="icon-btn window-btn" title="Close room" {...windowBtnProps(platform.closeWindow)}>
            <IconClose />
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
      <footer className="controls no-drag">
        <TransportBar
          paused={paused}
          held={held}
          onPause={() => client.send({ type: "pause" })}
          onStop={() => client.send({ type: "stop" })}
          onReplay={() => client.send({ type: "replay" })}
          onHold={() => client.send({ type: "hold_room" })}
        />
      </footer>
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
