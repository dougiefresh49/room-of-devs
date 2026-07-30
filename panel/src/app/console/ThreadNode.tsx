/**
 * Thread node — board `.tnode` (~L1043). Replaces AgentCard.
 * usePttGrant on the root; ActionCluster + .card-actions firewall preserved.
 */
import { useEffect, useRef, useState } from "react";
import type { AgentView, NowPlaying } from "@room/protocol";
import { CrtFace, CutFrame, GrantButton, Tag } from "@room/ui";
import { isPhoneFrame } from "@room/room-client";
import { client } from "../../client.js";
import { platform } from "../../platform/tauri.js";
import type { ThreadItem } from "../../platform/types.js";
import { isSpotlightWorthy } from "../../stage/engine.js";
import { ActionCluster } from "../ActionCluster.js";
import { AvatarImg } from "../AvatarImg.js";
import { clusterMode, handleClusterAction } from "../cluster-actions.js";
import { dispatchCommand } from "../commands.js";
import { grantPendingFor } from "../grant-guard.js";
import { PERSONAS, personaAvatarSrc } from "../personas.js";
import { setSwapOpen, type IslandUiState } from "../ui-state.js";
import { endRename, startRename, toggleOpenNode } from "../view-state.js";
import { usePttGrant } from "../usePttGrant.js";

const PERSONA_OPTIONS = PERSONAS.map((p) => ({
  name: p.name,
  label: p.label,
  avatarSrc: personaAvatarSrc(p),
}));

interface ThreadNodeProps {
  agent: AgentView;
  connected: boolean;
  stale: boolean;
  triageFocus: boolean;
  renaming: boolean;
  open: boolean;
  paused: boolean;
  nowPlaying: NowPlaying | null;
  clock: number;
  ui: IslandUiState;
}

function shortId(sessionId: string): string {
  return `S-${sessionId.slice(-4).toUpperCase()}`;
}

function formatHeld(raisedAt: string | null, clock: number): string | null {
  if (!raisedAt) return null;
  const t = Date.parse(raisedAt);
  if (!Number.isFinite(t)) return null;
  const sec = Math.max(0, Math.floor((clock - t) / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `HOLDING ${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatAgo(iso: string | null | undefined, clock: number): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const sec = Math.max(0, Math.floor((clock - t) / 1000));
  if (sec < 60) return `LAST EVENT ${String(sec).padStart(2, "0")}S AGO`;
  const m = Math.floor(sec / 60);
  return `LAST EVENT ${m}M AGO`;
}

function stateTag(agent: AgentView): { tone: "amber" | "red" | "hot" | "dim" | "green"; label: string } {
  switch (agent.state) {
    case "hand_raised":
      return { tone: "red", label: "NEEDS YOU" };
    case "speaking":
      return { tone: "hot", label: "SPEAKING" };
    case "working":
      return { tone: "amber", label: "WORKING" };
    default:
      return { tone: "dim", label: "IDLE" };
  }
}

function taskLine(agent: AgentView): string {
  if (agent.queuedPreview?.trim()) return agent.queuedPreview.trim();
  if (agent.live?.lastActivity?.label) return agent.live.lastActivity.label;
  if (agent.state === "hand_raised") return "WAITING ON YOU";
  if (agent.state === "speaking") return "ON THE FLOOR";
  if (agent.state === "working") return "IN FLIGHT";
  return "STANDING BY";
}

export function ThreadNode({
  agent,
  connected,
  stale,
  triageFocus,
  renaming,
  open,
  paused,
  nowPlaying,
  clock,
  ui,
}: ThreadNodeProps) {
  const ptt = usePttGrant(agent.sessionId, connected);
  const greyed = !connected || stale;
  const raised = agent.state === "hand_raised";
  const pending = grantPendingFor(client, agent.sessionId);
  const grow = isSpotlightWorthy(agent.sessionId) || pending;
  const mode = clusterMode(agent.sessionId);
  const onPhone = isPhoneFrame(nowPlaying, clock) && nowPlaying?.sessionId === agent.sessionId;
  const tag = stateTag(agent);
  const held = raised ? formatHeld(agent.raisedAt, clock) : null;
  const stamp =
    held ??
    formatAgo(agent.live?.lastActivity?.at, clock) ??
    (agent.state === "idle" ? "WAITING FOR LULL" : null);

  const nodeRef = useRef<HTMLDivElement | null>(null);
  const speaking = agent.state === "speaking";
  useEffect(() => {
    if (speaking) nodeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [speaking]);

  // Thread history — refetch on open + when a FINAL nowPlaying for this session lands.
  const [history, setHistory] = useState<ThreadItem[]>([]);
  const [histLoading, setHistLoading] = useState(false);
  const finalKey =
    nowPlaying?.sessionId === agent.sessionId && nowPlaying.endedAt
      ? `${nowPlaying.sessionId}:${nowPlaying.endedAt}`
      : "";

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setHistLoading(true);
    void platform.threadHistory(agent.sessionId).then((items) => {
      if (cancelled) return;
      setHistory(items);
      setHistLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open, agent.sessionId, finalKey]);

  const classes = [
    "console-tnode",
    `state-${agent.state}`,
    raised ? "needsyou" : "",
    agent.state === "idle" ? "settled" : "",
    greyed ? "disconnected" : "",
    stale ? "stale" : "",
    triageFocus ? "triage-focus" : "",
    grow ? "speaking-grow" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={`console-tnode-wrap${raised ? " needy" : ""}`}>
      <CutFrame
        scale="m"
        glow={raised ? "0 0 12px rgba(255,150,30,.35)" : undefined}
      >
        <div
          ref={nodeRef}
          className={classes}
          data-session={agent.sessionId}
          role="group"
          aria-label={agent.label ?? agent.name}
          {...ptt.gesture}
        >
          <div
            className="console-tnode-summary no-drag"
            onClick={(e) => {
              // Don't toggle open when interacting with rename/input targets.
              if ((e.target as HTMLElement).closest("input,button,a,[data-no-grant]")) return;
              toggleOpenNode(agent.sessionId);
            }}
          >
            <CrtFace size={58} className="console-tnode-face" scanlines>
              <AvatarImg
                agent={agent}
                imgClassName="avatar"
                fallbackClassName="avatar-fallback"
              />
            </CrtFace>
            <div className="console-tnode-mid">
              <div className="console-tnode-row1">
                <Callsign agent={agent} renaming={renaming} />
                <span className="console-tid">
                  {shortId(agent.sessionId)} ·{" "}
                  {agent.injectable ? "TMUX ✓" : "NO TMUX"}
                  {agent.isTeam ? " · TEAM" : ""}
                </span>
              </div>
              <div className="console-ttask" title={taskLine(agent)}>
                {taskLine(agent)}
              </div>
              <div className="console-tnode-chips">
                {agent.supersededCount > 0 ? (
                  <Tag tone="dim">×{agent.supersededCount}</Tag>
                ) : null}
                {agent.live?.on ? <Tag tone="amber">LIVE</Tag> : null}
                {agent.muted ? <Tag tone="dim">MUTED</Tag> : null}
                {onPhone ? <Tag tone="green">PHONE</Tag> : null}
              </div>
            </div>
            <div className="console-tstat">
              <Tag tone={tag.tone}>{tag.label}</Tag>
              {stamp ? <span className="console-laststamp">{stamp}</span> : null}
            </div>
          </div>

          <div
            className="console-expand no-drag"
            onClick={(e) => {
              e.stopPropagation();
              toggleOpenNode(agent.sessionId);
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {open ? "▾ CLOSE NODE" : "▸ OPEN NODE"}
          </div>

          {open ? (
            <div className="console-innards no-drag" data-no-grant>
              <ScreenTerm
                agent={agent}
                history={history}
                loading={histLoading}
                clock={clock}
              />
            </div>
          ) : null}

          {raised ? (
            <GrantButton
              className="card-grant-btn console-tnode-grant no-drag"
              pending={pending}
              disabled={!connected}
              pendingLabel="Working…"
              onGrant={ptt.grant}
              onHoldStart={ptt.holdStart}
              onHoldEnd={ptt.holdEnd}
              onMouseDown={(e) => e.stopPropagation()}
            />
          ) : null}

          <div
            className={`card-actions actions-${mode === "stage" ? 3 : 5}`}
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
              onSwapOpenChange={(openSwap) => setSwapOpen(openSwap ? agent.sessionId : null)}
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
      </CutFrame>
    </div>
  );
}

function Callsign({ agent, renaming }: { agent: AgentView; renaming: boolean }) {
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
        className="console-name-input no-drag"
        defaultValue={displayName}
        aria-label="Nickname"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            const label = e.currentTarget.value.trim();
            dispatchCommand(
              { type: "set_nickname", sessionId: agent.sessionId, label },
              "Couldn't rename",
            );
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
    <span
      className={`console-callsign${agent.muted ? " muted" : ""}`}
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
    </span>
  );
}

function ScreenTerm({
  agent,
  history,
  loading,
  clock,
}: {
  agent: AgentView;
  history: ThreadItem[];
  loading: boolean;
  clock: number;
}) {
  const liveOn = agent.live?.on === true;
  const liveLabel = agent.live?.lastActivity?.label;
  const liveAgo = formatAgo(agent.live?.lastActivity?.at, clock);

  return (
    <div className="console-term" style={{ background: "var(--rig-screen)", borderRadius: 6 }}>
      <div className="console-term-cap">
        <span>
          {liveOn ? "LIVE TAIL" : "THREAD"} // {shortId(agent.sessionId)}
        </span>
        <span>{liveOn ? "NARRATED" : loading ? "LOADING…" : "HISTORY"}</span>
      </div>
      {history.length === 0 && !loading ? (
        <div className="console-term-ln" style={{ color: "var(--rig-steel-dim)" }}>
          · no turns yet
        </div>
      ) : (
        history.map((item, i) => (
          <div
            key={`${item.at ?? i}-${item.role}`}
            className={`console-term-ln${item.role === "user" ? " user" : ""}`}
          >
            <span className="role">{item.role === "user" ? "YOU" : "AGT"}</span>
            {item.text.slice(0, 280)}
            {item.text.length > 280 ? "…" : ""}
          </div>
        ))
      )}
      {liveOn && liveLabel ? (
        <div className="console-term-live typing">
          » {liveLabel}
          {liveAgo ? ` · ${liveAgo}` : ""}
        </div>
      ) : null}
    </div>
  );
}
