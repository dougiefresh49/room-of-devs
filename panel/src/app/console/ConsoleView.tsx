/**
 * RIG console — replaces RoomView. Board section 01 anatomy over the
 * existing PanelSnapshot (no daemon changes).
 */
import type { PanelSnapshot } from "@room/protocol";
import { FailedCountBadge, Tag } from "@room/ui";
import { platform } from "../../platform/tauri.js";
import { IconCc, IconDock, IconGear, IconPlus } from "../icons.js";
import type { IslandUiState } from "../ui-state.js";
import {
  openPicker,
  openSettings,
  showErrorToast,
  toggleSummaryPane,
  type ViewState,
} from "../view-state.js";
import { CrewManifest } from "./CrewManifest.js";
import { DialChips } from "./DialChips.js";
import { Faceplate } from "./Faceplate.js";
import { ReplyDeck } from "./ReplyDeck.js";
import { ThreadNode } from "./ThreadNode.js";
import { WatchChips } from "./WatchChips.js";

interface ConsoleViewProps {
  snapshot: PanelSnapshot | null;
  connected: boolean;
  staleSessions: ReadonlySet<string>;
  view: ViewState;
  ui: IslandUiState;
  clock: number;
}

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

export function ConsoleView({
  snapshot,
  connected,
  staleSessions,
  view,
  ui,
  clock,
}: ConsoleViewProps) {
  const agents = snapshot?.agents ?? [];
  const nowPlaying = snapshot?.nowPlaying ?? null;
  const paused = snapshot?.paused === true;
  const failedCount = snapshot?.failedCount ?? 0;
  const triageFocus =
    typeof snapshot?.triageFocus === "string" && snapshot.triageFocus.trim()
      ? snapshot.triageFocus
      : null;

  const openAgent = agents.find((a) => a.sessionId === view.openNodeId) ?? null;
  const injectable = agents.filter((a) => a.injectable);
  const replyTarget = openAgent?.injectable
    ? openAgent
    : !openAgent && injectable.length === 1
      ? injectable[0]
      : null;

  return (
    <div className="console rig">
      <header className="console-strip">
        <span className="console-strip-title">
          THE RIG // <span>ROOM OF DEVS</span>
        </span>
        <div className="header-actions no-drag">
          <FailedCountBadge count={failedCount} />
          <span
            className={`conn-dot ${connected ? "up" : "down"}`}
            title={connected ? "Connected" : "Disconnected"}
            aria-hidden="true"
          />
          <button
            type="button"
            className="icon-btn window-btn"
            title="New session"
            {...windowBtnProps(openPicker)}
          >
            <IconPlus />
          </button>
          <button
            type="button"
            className="icon-btn window-btn"
            title="Settings"
            {...windowBtnProps(openSettings)}
          >
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
            {...windowBtnProps(() => {
              void platform.setRoomMode("dock").then((ok) => {
                if (!ok) showErrorToast("Couldn't dock the room");
              });
            })}
          >
            <IconDock />
          </button>
        </div>
      </header>

      {connected ? null : (
        <div className="console-offline" role="status">
          <Tag tone="red">OFFLINE</Tag>
          Room is offline — start the daemon to control agents
        </div>
      )}

      <div className="console-grid">
        <div className="console-col console-col-scroll">
          <Faceplate
            agents={agents}
            nowPlaying={nowPlaying}
            showTranscript={view.roomSummaryPane}
            dismissedKey={view.dockSummaryDismissedKey}
          />
        </div>

        <div className="console-col">
          <div className={`console-threads${connected ? "" : " disconnected"}`} id="cards">
            {agents.length ? (
              agents.map((agent) => (
                <ThreadNode
                  key={agent.sessionId}
                  agent={agent}
                  connected={connected}
                  stale={staleSessions.has(agent.sessionId)}
                  triageFocus={triageFocus === agent.sessionId}
                  renaming={view.renamingSessionId === agent.sessionId}
                  open={view.openNodeId === agent.sessionId}
                  paused={paused}
                  nowPlaying={nowPlaying}
                  clock={clock}
                  ui={ui}
                />
              ))
            ) : (
              <p className="console-empty">No agents</p>
            )}
          </div>
          <ReplyDeck target={replyTarget} connected={connected} />
        </div>

        <div className="console-col console-col-scroll">
          <CrewManifest agents={agents} />
          <WatchChips agents={agents} connected={connected} />
          <DialChips />
        </div>
      </div>
    </div>
  );
}
