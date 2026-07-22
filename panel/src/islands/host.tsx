/**
 * React island host for the legacy string-template renderer.
 *
 * One persistent React root lives in #islands (never innerHTML'd). The
 * legacy render() emits `[data-island]` placeholder elements, then calls
 * syncIslands(), which re-scans them and flushSync-commits portals into
 * the new nodes in the SAME task — the DOM never paints with empty
 * placeholders. Portal containers replaced by innerHTML are cleaned up
 * while detached (their subtree stays intact, so React's removeChild is
 * safe); remounts are expected, which is why all interactive island state
 * lives in external stores (RoomClient + ui-state.ts), never in
 * component state.
 *
 * The host subscribes ONCE to each store and passes plain props down —
 * leaf islands carry no subscriptions of their own, so portal remounts
 * don't churn listeners.
 *
 * HARD RULE (spec): every action is owned by the legacy handler OR an
 * island, never both. Islands own: transport footer, per-agent action
 * clusters (incl. kill-arm + swap popover), badges, chips, queued
 * preview, summary text. Legacy keeps: grant/PTT card gestures, window
 * chrome, picker, settings, rename, dock geometry. Islands never touch
 * `[data-avatar-session]` imgs — lipsync/blink stay direct-DOM.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal, flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import type { RoomClient, RoomState } from "@room/room-client";
import { isPhoneFrame } from "@room/room-client";
import {
  AgentChips,
  QueuedPreview,
  StateBadge,
  SummaryText,
  TransportBar,
  stripMarkdown,
} from "@room/ui";
import {
  ActionCluster,
  type ClusterAction,
  type ClusterMode,
  type PersonaOption,
} from "./ActionCluster.js";
import {
  armKill,
  disarmKill,
  getUiState,
  isKillArmed,
  setSwapOpen,
  subscribeUiState,
  type IslandUiState,
} from "./ui-state.js";

interface IslandTarget {
  el: HTMLElement;
  kind: string;
  key: string;
  sessionId: string | null;
  mode: ClusterMode | null;
  variant: string | null;
  expanded: boolean;
}

let targets: IslandTarget[] = [];
let targetsVersion = 0;
const targetListeners = new Set<() => void>();

function subscribeTargets(cb: () => void): () => void {
  targetListeners.add(cb);
  return () => targetListeners.delete(cb);
}

const getTargetsVersion = () => targetsVersion;

let root: Root | null = null;
let clientRef: RoomClient | null = null;
let personasRef: PersonaOption[] = [];

/** Mount the persistent island root. Call once at startup, before render(). */
export function initIslands(client: RoomClient, personas: PersonaOption[]): void {
  clientRef = client;
  personasRef = personas;
  const container = document.getElementById("islands");
  if (!container) throw new Error("#islands root missing from index.html");
  root = createRoot(container);
  root.render(<IslandsHost />);
}

/**
 * Re-scan placeholders after a legacy innerHTML render and synchronously
 * commit the portals. Safe to call redundantly.
 */
export function syncIslands(container: HTMLElement): void {
  const els = [...container.querySelectorAll<HTMLElement>("[data-island]")];
  targets = els.map((el) => {
    const kind = el.dataset.island ?? "";
    const sessionId = el.dataset.session ?? null;
    const variant = el.dataset.variant ?? null;
    const mode = (el.dataset.mode as ClusterMode | undefined) ?? null;
    return {
      el,
      kind,
      key: `${kind}:${variant ?? "-"}:${sessionId ?? "-"}`,
      sessionId,
      mode,
      variant,
      expanded: el.dataset.expanded === "1",
    };
  });
  targetsVersion += 1;
  flushSync(() => {
    for (const cb of targetListeners) cb();
  });
}

function IslandsHost() {
  useSyncExternalStore(subscribeTargets, getTargetsVersion);
  const client = clientRef!;
  const room = useSyncExternalStore(client.subscribe, client.getState);
  const ui = useSyncExternalStore(subscribeUiState, getUiState);
  // One shared clock for the phone-chip staleness belt (was a module-level
  // 15s interval in main.ts) — one timer total, not one per card.
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setClock(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  return (
    <>
      {targets.map((t) => createPortal(renderIsland(t, room, ui, clock), t.el, t.key))}
    </>
  );
}

function clusterActionHandler(sessionId: string): (action: ClusterAction) => void {
  return (action) => {
    const client = clientRef!;
    switch (action) {
      case "focus":
        client.send({ type: "focus_terminal", sessionId });
        return;
      case "status":
        client.send({ type: "status_say", sessionId });
        return;
      case "pause":
        client.send({ type: "pause" });
        return;
      case "stop":
        client.send({ type: "stop" });
        return;
      case "restart":
        client.send({ type: "restart" });
        return;
      case "replay":
        client.send({ type: "replay" });
        return;
      case "replay_slower":
        client.send({ type: "replay_slower" });
        return;
      case "replay_session":
        client.send({ type: "replay_session", sessionId });
        return;
      case "kill":
        // Two-click confirm, same semantics as the legacy killArmed map.
        if (isKillArmed(sessionId)) {
          disarmKill(sessionId);
          client.send({ type: "kill_team", sessionId });
        } else {
          armKill(sessionId);
        }
        return;
    }
  };
}

function renderIsland(
  t: IslandTarget,
  room: RoomState,
  ui: IslandUiState,
  clock: number,
) {
  const client = clientRef!;
  const snap = room.snapshot;
  const agent = t.sessionId
    ? snap?.agents.find((a) => a.sessionId === t.sessionId)
    : undefined;

  switch (t.kind) {
    case "state-badge":
      return agent ? <StateBadge state={agent.state} /> : null;

    case "chips": {
      if (!agent) return null;
      const np = snap?.nowPlaying ?? null;
      const onPhone = isPhoneFrame(np, clock) && np?.sessionId === agent.sessionId;
      return (
        <AgentChips
          raised={agent.state === "hand_raised"}
          raisedCount={agent.raisedCount}
          supersededCount={agent.supersededCount}
          onPhone={onPhone}
        />
      );
    }

    case "queued-preview":
      return agent && agent.state === "hand_raised" && agent.queuedPreview ? (
        <QueuedPreview text={agent.queuedPreview} />
      ) : null;

    case "action-cluster":
      return agent ? (
        <ActionCluster
          mode={t.mode ?? "idle"}
          isTeam={agent.isTeam}
          paused={snap?.paused === true}
          killArmed={ui.killArmed.has(agent.sessionId)}
          swapOpen={ui.swapOpen === agent.sessionId}
          personas={personasRef}
          onAction={clusterActionHandler(agent.sessionId)}
          onSwapOpenChange={(open) => setSwapOpen(open ? agent.sessionId : null)}
          onSwapCharacter={(character) => {
            client.send({ type: "set_voice", sessionId: agent.sessionId, character });
            setSwapOpen(null);
          }}
        />
      ) : null;

    case "transport":
      return (
        <TransportBar
          paused={snap?.paused === true}
          held={snap?.roomHeld === true}
          onPause={() => client.send({ type: "pause" })}
          onStop={() => client.send({ type: "stop" })}
          onReplay={() => client.send({ type: "replay" })}
          onHold={() => client.send({ type: "hold_room" })}
        />
      );

    case "summary-body": {
      const np = snap?.nowPlaying;
      return np ? <SummaryText text={np.text} rawText={np.rawText} /> : null;
    }

    case "dock-caption-text": {
      const np = snap?.nowPlaying;
      if (!np) return null;
      const raw = (np.rawText?.trim() || np.text).trim();
      return t.expanded ? <SummaryText text={raw} /> : <>{stripMarkdown(raw)}</>;
    }

    default:
      return null;
  }
}
