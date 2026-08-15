/**
 * Room-grid agent card (mobile). Renders the shared @room/ui leaves
 * (StateBadge, AgentChips, QueuedPreview, LiveBadge) plus the primary grant
 * affordance.
 *
 * Grant: for a hand-raised agent the "Read update" button calls
 * client.grant(sessionId, output). While a grant is optimistically pending
 * (selectGrantPending) it shows a disabled "Working…" state and ignores taps
 * — the single-dispatch guard lives in RoomClient.grant, this just reflects it.
 *
 * Idle agents get "Replay last" (chunk D) → plays that agent's newest cached
 * clip through the AudioController (App resolves the entry + primes audio).
 *
 * Injectable (team/tmux) and SDK (T3) sessions get "Chat" (chunk E) → opens the
 * conversation sheet (chat + live call). Other sessions keep the classic
 * grant/replay behavior with no chat/call surface (spec §B3).
 */
import type { AgentView, NowPlaying } from "@room/protocol";
import { AgentChips, GrantButton, LiveBadge, QueuedPreview, StateBadge } from "@room/ui";
import { isPhoneFrame } from "@room/room-client";
import type { OutputDevice } from "../prefs.js";
import { isChatEligible } from "../agent-ext.js";
import { Avatar } from "./Avatar.js";

interface AgentCardProps {
  agent: AgentView;
  nowPlaying: NowPlaying | null;
  /** Shared clock for the phone-chip staleness belt. */
  clock: number;
  output: OutputDevice;
  grantPending: boolean;
  onGrant: () => void;
  onReplayLast: () => void;
  onChat: () => void;
  onHide: () => void;
}

export function AgentCard({
  agent,
  nowPlaying,
  clock,
  output,
  grantPending,
  onGrant,
  onReplayLast,
  onChat,
  onHide,
}: AgentCardProps) {
  const displayName = agent.label || agent.name;
  const raised = agent.state === "hand_raised";
  const speaking = agent.state === "speaking";
  const chatEligible = isChatEligible(agent);
  const onPhone = isPhoneFrame(nowPlaying, clock) && nowPlaying?.sessionId === agent.sessionId;
  const grantSub = output === "phone" ? "on this phone" : "on Mac";

  const chatBtn = (
    <button
      type="button"
      onClick={onChat}
      className="rounded-xl border border-line-strong px-4 py-2 text-sm font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      Chat
    </button>
  );

  return (
    <article
      className={`rounded-2xl border border-line bg-surface p-4 state-${agent.state}`}
      data-session={agent.sessionId}
    >
      <div className="flex items-start gap-3">
        <div className="relative shrink-0">
          <Avatar
            agent={agent}
            frame={speaking ? "speaking" : "idle"}
            className="grid size-14 place-items-center overflow-hidden rounded-xl bg-surface-strong text-sm font-semibold text-fg-muted"
          />
          {raised ? (
            <span
              className="absolute -right-1.5 -top-1.5 text-lg leading-none drop-shadow"
              aria-hidden="true"
            >
              ✋
            </span>
          ) : null}
        </div>

        <div className="min-w-0 flex-1">
          <div
            className={`truncate text-[15px] font-semibold ${agent.muted ? "text-fg-muted line-through decoration-fg-faint/60" : ""}`}
            title={agent.name}
          >
            {displayName}
          </div>
          <StateBadge state={agent.state} />
          <div className="chips">
            {agent.muted ? (
              <span className="chip" title="Muted">
                muted
              </span>
            ) : null}
            <AgentChips
              raised={raised}
              raisedCount={agent.raisedCount}
              supersededCount={agent.supersededCount}
              onPhone={onPhone}
            />
            <LiveBadge live={agent.live} />
          </div>
          {raised && agent.queuedPreview ? <QueuedPreview text={agent.queuedPreview} /> : null}
        </div>

        <button
          type="button"
          className="shrink-0 rounded-lg border border-line-strong px-3 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          onClick={onHide}
        >
          Hide
        </button>
      </div>

      {raised ? (
        <div className="mt-3 flex flex-col gap-2">
          {/* Shared leaf (audit C-5) — the panel adopts the same affordance so
              the room's primary action is one labelled, keyboard-operable
              button on both surfaces. Mobile has no push-to-talk, so no hold
              handlers are passed and this stays a plain tap-to-grant. */}
          <GrantButton pending={grantPending} subLabel={grantSub} onGrant={onGrant} />
          {chatEligible ? <div className="grid grid-cols-1">{chatBtn}</div> : null}
        </div>
      ) : (
        // Idle/working/speaking: Replay last (unless speaking) + Chat (injectable/sdk).
        (() => {
          const showReplay = !speaking;
          if (!showReplay && !chatEligible) return null;
          return (
            <div
              className={`mt-3 grid gap-2 ${showReplay && chatEligible ? "grid-cols-2" : "grid-cols-1"}`}
            >
              {showReplay ? (
                <button
                  type="button"
                  onClick={onReplayLast}
                  className="rounded-xl border border-line-strong px-4 py-2 text-sm font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  Replay last
                </button>
              ) : null}
              {chatEligible ? chatBtn : null}
            </div>
          );
        })()
      )}
    </article>
  );
}
