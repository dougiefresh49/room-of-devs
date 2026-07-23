/**
 * Chat view (spec §B1) — the default conversation surface. Compact 56px header
 * (avatar · name + state dot · Go-live pill · collapse chevron, all controls
 * right), the /thread history as agent/user bubbles with play chips on finals,
 * a slim playback strip, and the auto-grow composer. While live but chatting
 * (callView off), a single-row "live pin" sits atop the thread (back-to-call ·
 * name · timer · End) — never a second identity header.
 *
 * Ownership rule (§B1): when live is ON, the working UI lives ONLY in the call
 * card — this thread shows no working row.
 */
import { useEffect, useMemo, useRef } from "react";
import type { AgentView } from "@room/protocol";
import type { LiveTransition } from "../convo-state.js";
import type { ReplayEntry, ThreadItem } from "../api.js";
import { findReplayForFinal } from "../thread.js";
import { IconArrowLeft, IconChevron } from "../icons.js";
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
  onGoLive: () => void;
  onEndLive: () => void;
  onBackToCall: () => void;
  onCollapse: () => void;
  onPlay: (entry: ReplayEntry) => void;
  onSend: (text: string) => Promise<boolean>;
}

type Row =
  | { kind: "msg"; at: number; item: ThreadItem }
  | { kind: "ack"; at: number; key: string };

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
  onGoLive,
  onEndLive,
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

  // Stick to the bottom when already near it (don't yank the user mid-scroll).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [rows.length, working, liveOn]);

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

        {agent.injectable ? (
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
            <span className={`size-[7px] rounded-full ${liveOn ? "bg-accent cv-breathe" : "bg-accent/50"}`} />
            {liveTransition === "starting"
              ? "Going live…"
              : liveTransition === "ending"
                ? "Ending…"
                : liveOn
                  ? "Live"
                  : "Go live"}
          </button>
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
      <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 py-3">
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

        {/* working row — chat-owned only when live is OFF (§B1 ownership rule) */}
        {working && !liveOn ? (
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
              </div>
            ) : agent.injectable ? (
              <div className="mt-0.5 text-[11px] text-fg-faint">
                tap Go live to listen in while they work
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <PlaybackStrip sessionId={agent.sessionId} />
      {/* key by session: remounting loads that session's draft + resets the
          uncontrolled field (Wispr-Flow-stable within a session). */}
      <Composer
        key={agent.sessionId}
        sessionId={agent.sessionId}
        placeholder={`Reply to ${name}…`}
        onSend={onSend}
      />
    </div>
  );
}
