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
 * Injectable (team/tmux) sessions also get "Chat" (chunk E) → opens the
 * conversation sheet (chat + live call). Non-injectable sessions keep the
 * classic grant/replay behavior with no chat/call surface (spec §B3).
 */
import type { AgentView, NowPlaying } from "@room/protocol";
import { AgentChips, LiveBadge, QueuedPreview, StateBadge } from "@room/ui";
import { isPhoneFrame } from "@room/room-client";
import type { OutputDevice } from "../prefs.js";
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
  const injectable = agent.injectable;
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
          {/*
            Reviewed polish (live verification round): the old fully-saturated
            #3ecf8e fill dominated the room. Now a darker green SURFACE (accent
            mixed lightly over the card) with accent icon/text/ring/border.
          */}
          <button
            type="button"
            disabled={grantPending}
            onClick={onGrant}
            style={
              grantPending
                ? undefined
                : {
                    backgroundColor:
                      "color-mix(in srgb, var(--room-accent) 18%, var(--room-surface))",
                    borderColor: "color-mix(in srgb, var(--room-accent) 40%, transparent)",
                  }
            }
            className="flex w-full flex-col items-center rounded-xl border border-transparent px-4 py-2.5 font-semibold text-accent transition-colors hover:brightness-110 disabled:cursor-default disabled:border-transparent disabled:bg-surface-strong disabled:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            {grantPending ? (
              <span className="text-sm text-fg-muted">Working…</span>
            ) : (
              <>
                <span className="flex items-center gap-2 text-sm">
                  <span aria-hidden="true">▶</span> Read update
                </span>
                <span className="text-[11px] font-medium text-accent/70">{grantSub}</span>
              </>
            )}
          </button>
          {injectable ? <div className="grid grid-cols-1">{chatBtn}</div> : null}
        </div>
      ) : (
        // Idle/working/speaking: Replay last (unless speaking) + Chat (injectable).
        (() => {
          const showReplay = !speaking;
          if (!showReplay && !injectable) return null;
          return (
            <div
              className={`mt-3 grid gap-2 ${showReplay && injectable ? "grid-cols-2" : "grid-cols-1"}`}
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
              {injectable ? chatBtn : null}
            </div>
          );
        })()
      )}
    </article>
  );
}
