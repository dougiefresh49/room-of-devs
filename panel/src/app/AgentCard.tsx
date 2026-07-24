/**
 * Room-grid agent card. DOM mirrors the legacy renderCard() exactly (same
 * classes/structure) so style.css keeps working; the card element owns the
 * grant/PTT gesture (usePttGrant — single owner, event firewall inside).
 */
import { useEffect, useRef } from "react";
import type { AgentView, NowPlaying } from "@room/protocol";
import { AgentChips, LiveBadge, QueuedPreview, StateBadge } from "@room/ui";
import { isPhoneFrame } from "@room/room-client";
import { client } from "../client.js";
import { isSpotlightWorthy } from "../stage/engine.js";
import { ActionCluster } from "./ActionCluster.js";
import { AvatarImg } from "./AvatarImg.js";
import { clusterMode, handleClusterAction } from "./cluster-actions.js";
import { grantPendingFor } from "./grant-guard.js";
import { PERSONAS, personaAvatarSrc } from "./personas.js";
import { setSwapOpen, type IslandUiState } from "./ui-state.js";
import { endRename, startRename } from "./view-state.js";
import { usePttGrant } from "./usePttGrant.js";

const PERSONA_OPTIONS = PERSONAS.map((p) => ({
  name: p.name,
  label: p.label,
  avatarSrc: personaAvatarSrc(p),
}));

interface AgentCardProps {
  agent: AgentView;
  connected: boolean;
  stale: boolean;
  triageFocus: boolean;
  renaming: boolean;
  paused: boolean;
  nowPlaying: NowPlaying | null;
  /** Shared 15s clock for the phone-chip staleness belt. */
  clock: number;
  ui: IslandUiState;
}

export function AgentCard({
  agent,
  connected,
  stale,
  triageFocus,
  renaming,
  paused,
  nowPlaying,
  clock,
  ui,
}: AgentCardProps) {
  const gesture = usePttGrant(agent.sessionId);
  const greyed = !connected || stale;
  const pending = grantPendingFor(client, agent.sessionId);
  const grow = isSpotlightWorthy(agent.sessionId) || pending;
  const mode = clusterMode(agent.sessionId);
  const onPhone = isPhoneFrame(nowPlaying, clock) && nowPlaying?.sessionId === agent.sessionId;

  const cardRef = useRef<HTMLDivElement | null>(null);
  const speaking = agent.state === "speaking";
  useEffect(() => {
    // A card that starts speaking grows (bigger avatar + stage action row);
    // at the bottom of the scrollable card list that growth lands below the
    // fold, leaving the pause/stop/replay row invisible exactly when it's
    // needed. Nudge it into view.
    if (speaking) cardRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [speaking]);

  return (
    <div
      ref={cardRef}
      className={`card state-${agent.state}${greyed ? " disconnected" : ""}${stale ? " stale" : ""}${triageFocus ? " triage-focus" : ""}${grow ? " speaking-grow" : ""}`}
      data-session={agent.sessionId}
      role="button"
      tabIndex={0}
      {...gesture}
    >
      <div className="card-main">
        <div className={`avatar-wrap${pending ? " grant-loading" : ""}`}>
          <AvatarImg agent={agent} imgClassName="avatar" fallbackClassName="avatar-fallback" />
        </div>
        <div className="card-body">
          <CardName agent={agent} renaming={renaming} />
          <StateBadge state={agent.state} />
          <div className="chips">
            <AgentChips
              raised={agent.state === "hand_raised"}
              raisedCount={agent.raisedCount}
              supersededCount={agent.supersededCount}
              onPhone={onPhone}
            />
            <LiveBadge live={agent.live} />
          </div>
          {agent.state === "hand_raised" && agent.queuedPreview ? (
            <QueuedPreview text={agent.queuedPreview} />
          ) : null}
        </div>
      </div>
      <div
        className={`card-actions actions-${mode === "stage" ? 3 : 5}`}
        aria-label="Agent actions"
      >
        <ActionCluster
          mode={mode}
          isTeam={agent.isTeam}
          paused={paused}
          killArmed={ui.killArmed.has(agent.sessionId)}
          swapOpen={ui.swapOpen === agent.sessionId}
          personas={PERSONA_OPTIONS}
          onAction={(action) => handleClusterAction(agent.sessionId, action)}
          onSwapOpenChange={(open) => setSwapOpen(open ? agent.sessionId : null)}
          onSwapCharacter={(character) => {
            client.send({ type: "set_voice", sessionId: agent.sessionId, character });
            setSwapOpen(null);
          }}
        />
      </div>
    </div>
  );
}

/** Name with dblclick-to-rename; Enter commits, Escape/blur cancel. */
function CardName({ agent, renaming }: { agent: AgentView; renaming: boolean }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const displayName = agent.label ?? agent.name;

  useEffect(() => {
    if (renaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [renaming]);

  if (renaming) {
    return (
      <input
        ref={inputRef}
        className="name-input no-drag"
        defaultValue={displayName}
        aria-label="Nickname"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            const label = e.currentTarget.value.trim();
            client.send({ type: "set_nickname", sessionId: agent.sessionId, label });
            endRename();
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            endRename();
          }
        }}
        onBlur={endRename}
      />
    );
  }

  return (
    <div
      className={`name${agent.muted ? " muted" : ""}`}
      title={agent.name}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        startRename(agent.sessionId);
      }}
    >
      {displayName}
    </div>
  );
}
