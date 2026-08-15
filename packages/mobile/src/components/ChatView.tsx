/**
 * Chat view (spec §B1) — the default conversation surface. Compact 56px header
 * (avatar · name + state dot · Go-live pill · collapse chevron, all controls
 * right), the /thread history as agent/user bubbles with play chips on finals,
 * a slim playback strip, and the auto-grow composer. While live but chatting
 * (callView off), a single-row "live pin" sits atop the thread (back-to-call ·
 * name · timer · End) — never a second identity header.
 *
 * Ownership rule (§B1): when live is ON and unmuted, the working UI lives ONLY
 * in the call card — this thread shows no working row. While live-muted, the
 * working row stays visible here (text-only watch mode).
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { AgentView } from "@room/protocol";
import type { LiveTransition } from "../convo-state.js";
import type { ReplayEntry, ThreadItem } from "../api.js";
import { findReplayForFinal } from "../thread.js";
import { IconArrowLeft, IconChevron, IconSpeaker, IconSpeakerOff } from "../icons.js";
import { Avatar } from "./Avatar.js";
import { ThreadBubble } from "./ThreadBubble.js";
import { PlaybackStrip } from "./PlaybackStrip.js";
import { Composer } from "./Composer.js";

interface ChatViewProps {
  agent: AgentView;
  items: ThreadItem[];
  replayAll: ReplayEntry[];
  liveOn: boolean;
  callView: boolean;
  elapsed: string;
  ackAts: readonly string[];
  /** A set_live transition is in flight — disable Go-live / End controls. */
  liveBusy: boolean;
  liveTransition: LiveTransition;
  liveMuted: boolean;
  muteBusy: boolean;
  chatEligible: boolean;
  onGoLive: () => void;
  onEndLive: () => void;
  onToggleMute: () => void;
  onBackToCall: () => void;
  onCollapse: () => void;
  onPlay: (entry: ReplayEntry) => void;
  onSend: (text: string) => Promise<boolean>;
}

type Row = { kind: "msg"; at: number; item: ThreadItem } | { kind: "ack"; at: number; key: string };

export function ChatView({
  agent,
  items,
  replayAll,
  liveOn,
  callView,
  elapsed,
  ackAts,
  liveBusy,
  liveTransition,
  liveMuted,
  muteBusy,
  chatEligible,
  onGoLive,
  onEndLive,
  onToggleMute,
  onBackToCall,
  onCollapse,
  onPlay,
  onSend,
}: ChatViewProps) {
  const name = agent.label || agent.name;
  const working = agent.state === "working";
  const activity = agent.live?.lastActivity?.label ?? "";
  const tools = agent.live?.toolCount ?? 0;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Whether the user is parked at the bottom. Seeded true so a freshly opened
  // thread lands on the NEWEST message; an onScroll handler keeps it current so
  // a refetch never yanks a user who scrolled up to read history. Reset to true
  // on a session change (defensive — ChatView normally remounts per session).
  const atBottomRef = useRef(true);
  const prevSessionRef = useRef(agent.sessionId);
  if (prevSessionRef.current !== agent.sessionId) {
    prevSessionRef.current = agent.sessionId;
    atBottomRef.current = true;
  }

  // Merge thread messages + page-local ack chips into one time-sorted list.
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = items.map((item) => ({
      kind: "msg" as const,
      at: item.at ? Date.parse(item.at) || 0 : 0,
      item,
    }));
    for (const at of ackAts) {
      out.push({ kind: "ack", at: Date.parse(at) || 0, key: at });
    }
    out.sort((a, b) => a.at - b.at);
    return out;
  }, [items, ackAts]);

  // Anchor to the bottom after any content change — but ONLY when the user was
  // already at/near the bottom (captured before this layout by onScroll). Runs
  // in a layout effect so the initial open paints at the bottom (no top flash).
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [agent.sessionId, rows.length, working, liveOn, liveMuted]);

  // Keyboard show/hide (visualViewport) or any resize re-anchors to the bottom
  // when parked there, so the newest messages stay in view above the composer.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const vv = window.visualViewport;
    const reanchor = () => {
      const el = scrollRef.current;
      if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
    };
    vv?.addEventListener("resize", reanchor);
    vv?.addEventListener("scroll", reanchor);
    window.addEventListener("resize", reanchor);
    return () => {
      vv?.removeEventListener("resize", reanchor);
      vv?.removeEventListener("scroll", reanchor);
      window.removeEventListener("resize", reanchor);
    };
  }, []);

  const onThreadScroll = () => {
    const el = scrollRef.current;
    if (el) atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  let dot = "bg-fg-faint";
  let statusText = agent.state === "hand_raised" ? "update ready" : "ready";
  if (liveOn) {
    dot = "bg-accent cv-breathe";
    statusText = "live · call continues";
  } else if (working) {
    dot = "bg-state-working";
    statusText = "working…";
  } else if (agent.state === "speaking") {
    dot = "bg-accent";
    statusText = "speaking";
  }

  return (
    <div className="flex h-full flex-col bg-bg">
      {/* compact header (§B1: all controls right) */}
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-3">
        <Avatar
          agent={agent}
          frame={agent.state === "speaking" ? "speaking" : "idle"}
          className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl bg-surface-strong text-xs font-semibold text-fg-muted"
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-bold text-fg">{name}</div>
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-fg-muted">
            <span className={`size-[7px] shrink-0 rounded-full ${dot}`} />
            <span className="truncate">{statusText}</span>
          </div>
        </div>

        {chatEligible ? (
          <>
            {liveOn ? (
              <button
                type="button"
                onClick={onToggleMute}
                disabled={muteBusy}
                aria-disabled={muteBusy}
                aria-label={liveMuted ? "Unmute live narration" : "Mute live narration"}
                className="grid size-9 shrink-0 place-items-center rounded-lg border border-line-strong text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60 [&_svg]:size-[18px]"
              >
                {liveMuted ? <IconSpeakerOff /> : <IconSpeaker />}
              </button>
            ) : null}
            <button
              type="button"
              onClick={liveOn ? onEndLive : onGoLive}
              disabled={liveBusy}
              aria-disabled={liveBusy}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-bold tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60 ${
                liveOn
                  ? "border-accent bg-accent/15 text-accent shadow-[0_0_14px_color-mix(in_srgb,var(--room-accent)_22%,transparent)]"
                  : "border-accent/40 bg-accent/5 text-accent/90 hover:bg-accent/10"
              }`}
            >
              <span
                className={`size-[7px] rounded-full ${liveOn ? "bg-accent cv-breathe" : "bg-accent/50"}`}
              />
              {liveTransition === "starting"
                ? "Going live…"
                : liveTransition === "ending"
                  ? "Ending…"
                  : liveOn
                    ? "Live"
                    : "Go live"}
            </button>
          </>
        ) : null}

        <button
          type="button"
          onClick={onCollapse}
          aria-label="Close conversation"
          className="grid size-9 shrink-0 place-items-center rounded-lg text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent [&_svg]:size-5"
        >
          <IconChevron />
        </button>
      </div>

      {/* live pin (chatting mid-live) — one row, not a second header */}
      {liveOn && !callView ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-accent/20 bg-accent/[0.06] px-3 py-1.5">
          <button
            type="button"
            onClick={onBackToCall}
            className="inline-flex items-center gap-1 rounded-full border border-accent/30 bg-surface px-2.5 py-1 text-[12px] font-semibold text-accent [&_svg]:size-3.5"
          >
            <IconArrowLeft /> Call
          </button>
          <span className="truncate text-[12px] font-semibold text-fg-muted">{name}</span>
          <span className="flex-1" />
          <span className="text-[12px] tabular-nums text-accent/80">{elapsed}</span>
          <button
            type="button"
            onClick={onEndLive}
            disabled={liveBusy}
            aria-disabled={liveBusy}
            className="rounded-full border border-danger/40 bg-danger/10 px-2.5 py-1 text-[12px] font-semibold text-danger disabled:opacity-60"
          >
            End
          </button>
        </div>
      ) : null}

      {/* thread */}
      <div
        ref={scrollRef}
        onScroll={onThreadScroll}
        className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 py-3"
      >
        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-fg-muted">No messages yet</p>
        ) : (
          rows.map((row) =>
            row.kind === "ack" ? (
              <div
                key={`ack-${row.key}`}
                className="self-center rounded-full bg-surface px-3 py-1 text-[11px] font-medium text-fg-muted"
              >
                🔊 acknowledged
              </div>
            ) : (
              <ThreadBubble
                key={`msg-${row.at}-${row.item.role}-${row.item.text.slice(0, 24)}`}
                item={row.item}
                replay={
                  !liveOn && row.item.role === "agent" && row.item.final
                    ? findReplayForFinal(replayAll, agent.sessionId, row.item.text)
                    : null
                }
                onPlay={onPlay}
              />
            ),
          )
        )}

        {/* working row — hidden only when live is ON and unmuted (§B1 + mute watch) */}
        {working && (!liveOn || liveMuted) ? (
          <div className="mt-1 self-center text-center">
            <div className="text-[13px] font-medium text-fg-muted">
              {name} is working
              <span className="cv-dots ml-0.5 text-accent" aria-hidden="true">
                <i>.</i>
                <i>.</i>
                <i>.</i>
              </span>
            </div>
            {/* §B1: surface the current activity + tool count when present. */}
            {activity || tools ? (
              <div className="mt-0.5 max-w-[85%] truncate text-[11px] text-fg-muted">
                {activity || "working"}
                {tools ? ` · ${tools} tool${tools === 1 ? "" : "s"}` : ""}
                {liveOn && liveMuted ? " · audio off" : ""}
              </div>
            ) : chatEligible ? (
              <div className="mt-0.5 text-[11px] text-fg-faint">
                {liveOn && liveMuted
                  ? "watching — text only"
                  : "tap Go live to listen in while they work"}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <PlaybackStrip sessionId={agent.sessionId} />
      {agent.injectable ? (
        <Composer
          key={agent.sessionId}
          sessionId={agent.sessionId}
          placeholder={`Reply to ${name}…`}
          onSend={onSend}
        />
      ) : chatEligible ? (
        <div className="shrink-0 border-t border-line bg-bg-elevated px-4 py-3 pb-[max(0.625rem,env(safe-area-inset-bottom))] text-center text-[13px] text-fg-muted">
          Replies for T3 sessions come with Phase B — use the T3 app.
        </div>
      ) : null}
    </div>
  );
}
