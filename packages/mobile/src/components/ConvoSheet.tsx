/**
 * ConvoSheet — the full-screen conversation sheet for injectable sessions
 * (spec §B1/§B2). Ties the CALL and CHAT surfaces together and owns the small
 * amount of orchestration that isn't audio:
 *
 *   - /thread history via useThread (refetched on convo-state's threadRev);
 *   - the call/chat slide (two absolutely-stacked panels; the controller's one
 *     <audio> is untouched, so audio never breaks across the slide);
 *   - go-live / end-live / reply-send through the RoomClient;
 *   - a 1s tick that advances the live timer + expires the ack beat.
 *
 * Opened from an AgentCard "Chat" action (App owns convo.open + prime-on-tap).
 */
import { useEffect, useRef, useState } from "react";
import type { AgentView, Command, CommandResult, NowPlaying } from "@room/protocol";
import { Sheet, SheetContent, SheetTitle } from "@room/ui";
import { client } from "../client.js";
import { audioController } from "../audio/controller.js";
import { convo, useConvo } from "../convo-state.js";
import { useThread } from "../thread.js";
import { clearDraft } from "../drafts.js";
import { getLiveMutePref, setLiveMutePref } from "../prefs.js";
import { isChatEligible, isReplyComposerEligible, readLiveMuted } from "../agent-ext.js";
import type { ReplayEntry } from "../api.js";
import { CallView } from "./CallView.js";
import { ChatView } from "./ChatView.js";

/**
 * Bounded settlement for reply / set_live (bug 6): the room-client transport
 * already times out at 10s, but we race an 11s upper bound so the composer /
 * live-transition UI is GUARANTEED to settle even if the transport somehow
 * doesn't reject (e.g. a wedged daemon that accepts the socket but never
 * responds). The transport's own 10s TransportError normally wins first.
 */
const REQUEST_TIMEOUT_MS = 11_000;

const REPLY_FAILURE_ANNOUNCE: Record<string, string> = {
  not_in_team: "Not in team — respawn from +",
  pane_not_ready: "Agent isn't running — respawn from +",
  not_provisioned: "T3 reply not set up — run t3-provision-bearer.sh",
  auth_expired: "T3 login expired — re-provision",
  t3_unreachable: "T3 app not reachable",
  thread_missing: "Could not find the T3 thread",
  dispatch_rejected: "T3 rejected the reply",
  t3_timeout: "T3 reply timed out",
};
function requestWithTimeout(cmd: Command): Promise<CommandResult> {
  return Promise.race([
    client.request(cmd),
    new Promise<CommandResult>((_, reject) =>
      setTimeout(() => reject(new Error("request-timeout")), REQUEST_TIMEOUT_MS),
    ),
  ]);
}

/** 1s wall clock, only while the sheet is open (drives timer + ack expiry). */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

function fmtElapsed(startedAt: number | null, now: number): string {
  if (!startedAt) return "0:00";
  const sec = Math.max(0, Math.floor((now - startedAt) / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

/** The visible viewport (bug 5): tracks the software keyboard so the sheet —
 *  and the composer at its bottom — shrink to the area ABOVE the keyboard. */
interface Viewport {
  top: number;
  height: number;
}
function readViewport(): Viewport {
  const vv = typeof window !== "undefined" ? window.visualViewport : null;
  if (vv) return { top: vv.offsetTop, height: vv.height };
  return { top: 0, height: typeof window !== "undefined" ? window.innerHeight : 0 };
}
function useViewport(active: boolean): Viewport {
  const [vp, setVp] = useState<Viewport>(() => readViewport());
  useEffect(() => {
    if (!active || typeof window === "undefined") return;
    const vv = window.visualViewport;
    const update = () => setVp(readViewport());
    update();
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [active]);
  return vp;
}

interface ConvoSheetProps {
  agents: AgentView[];
  nowPlaying: NowPlaying | null;
  replayAll: ReplayEntry[];
}

export function ConvoSheet({ agents, nowPlaying, replayAll }: ConvoSheetProps) {
  const state = useConvo();
  const sessionId = state.sessionId;
  const agent = sessionId ? agents.find((a) => a.sessionId === sessionId) : undefined;
  const { items } = useThread(sessionId, state.threadRev);
  // The 1s clock (timer + ack-beat expiry) only runs while live / going live —
  // so a plain non-live chat never re-renders its thread on a ticker.
  const now = useNow(!!sessionId && (!!agent?.live?.on || state.callView));
  const vp = useViewport(!!sessionId);
  // Focus target on open — see onOpenAutoFocus below.
  const contentRef = useRef<HTMLDivElement | null>(null);
  // We open without a Radix Trigger (controlled `open`), so Radix has no
  // element to return focus to on close — capture the opener ourselves.
  // Captured inside onOpenAutoFocus: a mount effect is too late (child
  // effects run first, so Radix has already moved focus into the sheet).
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  if (!sessionId || !agent) return null;

  const name = agent.label || agent.name;
  const liveOn = !!agent.live?.on;
  // convo-state owns callView: go-live sets it, send-a-text/end-live/live-off
  // clear it. Honor it directly — during the sub-second go-live optimism window
  // (callView true, liveOn not yet) the CALL surface is already shown.
  const callView = state.callView;
  const elapsed = fmtElapsed(state.liveStartedAt, now);
  const ackFlash = state.ackFlashUntil != null && now < state.ackFlashUntil;
  const liveBusy = state.liveTransition !== "idle";
  const muteBusy = state.muteTransition !== "idle";
  const chatEligible = isChatEligible(agent);
  const liveMuted =
    state.muteTransition === "muting"
      ? true
      : state.muteTransition === "unmuting"
        ? false
        : readLiveMuted(agent);

  const handleGoLive = async () => {
    // One live transition at a time: the guard returns null if a Go/End is
    // already in flight (the control is also disabled). Optimistic UI only
    // commits after we hold the transition.
    const token = convo.beginLiveTransition(sessionId, "starting");
    if (token === null) return;
    audioController.prime();
    audioController.primeAck();
    convo.beginLive(sessionId);
    convo.setCallView(true);
    const initialMuted = getLiveMutePref(sessionId);
    try {
      const r = await requestWithTimeout({
        type: "set_live",
        sessionId,
        on: true,
        muted: initialMuted,
      } as Command);
      if (!convo.isLiveTransitionCurrent(sessionId, token)) return; // superseded
      if (!r.ok) {
        convo.endLive(sessionId);
        audioController.announce("Couldn't go live");
      }
    } catch {
      if (convo.isLiveTransitionCurrent(sessionId, token)) {
        convo.endLive(sessionId);
        audioController.announce("Couldn't go live");
      }
    } finally {
      convo.endLiveTransition(sessionId, token);
    }
  };

  const handleEndLive = async () => {
    const token = convo.beginLiveTransition(sessionId, "ending");
    if (token === null) return;
    // Stop phone audio first, clear live state (slides to chat), then tell the
    // daemon — order per §B2.
    audioController.stop();
    convo.endLive(sessionId);
    try {
      const r = await requestWithTimeout({ type: "set_live", sessionId, on: false } as Command);
      if (!convo.isLiveTransitionCurrent(sessionId, token)) return;
      if (!r.ok) audioController.announce("Couldn't end live");
    } catch {
      if (convo.isLiveTransitionCurrent(sessionId, token)) {
        audioController.announce("Couldn't end live");
      }
    } finally {
      convo.endLiveTransition(sessionId, token);
    }
  };

  const handleToggleMute = async () => {
    const targetMuted = !liveMuted;
    const token = convo.beginMuteTransition(sessionId, targetMuted);
    if (token === null) return;
    setLiveMutePref(sessionId, targetMuted);
    try {
      const r = await requestWithTimeout({
        type: "set_live_mute",
        sessionId,
        muted: targetMuted,
      } as unknown as Command);
      if (!convo.isMuteTransitionCurrent(sessionId, token)) return;
      if (!r.ok) {
        audioController.announce(targetMuted ? "Couldn't mute live" : "Couldn't unmute live");
      }
    } catch {
      if (convo.isMuteTransitionCurrent(sessionId, token)) {
        audioController.announce(targetMuted ? "Couldn't mute live" : "Couldn't unmute live");
      }
    } finally {
      convo.endMuteTransition(sessionId, token);
    }
  };

  const handlePlay = (entry: ReplayEntry) => {
    audioController.prime();
    void audioController.play(entry, { gated: false });
  };

  const handleSend = async (text: string): Promise<boolean> => {
    if (text.length > 4000) {
      audioController.announce("Reply too long");
      return false;
    }
    audioController.primeAck(); // unlock the ack element inside this tap
    try {
      const r = await requestWithTimeout({ type: "reply", sessionId, text } as Command);
      if (r.ok) {
        convo.resetLiveClips(sessionId);
        convo.bumpThread(); // /thread is the source of truth — refetch now
        clearDraft(sessionId);
        audioController.announce(`Reply sent to ${name}`);
        return true;
      }
      // Draft is preserved (Composer only clears on `true`) so the user can retry.
      audioController.announce(REPLY_FAILURE_ANNOUNCE[r.code ?? ""] ?? "Couldn't send");
      return false;
    } catch {
      // Timed out / transport down (e.g. wedged daemon) — settle visibly.
      audioController.announce("Couldn't send — check connection");
      return false;
    }
  };

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) convo.close();
      }}
    >
      {/*
        Radix owns the modal mechanics now (audit U-7): focus trap, Escape,
        focus return to the card that opened us, body scroll lock, and
        aria-hidden on the rest of the app. `side="full"` + the inline
        visualViewport top/height keeps the sheet pinned above the software
        keyboard exactly as the hand-rolled version did.
      */}
      <SheetContent
        ref={contentRef}
        side="full"
        showClose={false}
        overlayClassName="bg-transparent"
        aria-describedby={undefined}
        className="left-0 right-0 z-50 block gap-0 bg-bg p-0 shadow-none"
        style={{ top: vp.top, height: vp.height }}
        // The composer would otherwise take focus on open and throw up the
        // software keyboard over the conversation. Park focus on the sheet
        // itself; the trap and Escape work from there.
        onOpenAutoFocus={(e) => {
          restoreFocusRef.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
          e.preventDefault();
          contentRef.current?.focus();
        }}
        // Full-screen: the only "outside" is the strip the keyboard leaves
        // behind, and dismissing on a stray tap there would be a surprise.
        onPointerDownOutside={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          restoreFocusRef.current?.focus();
        }}
      >
        <SheetTitle className="sr-only">{`Conversation with ${name}`}</SheetTitle>
        <div className="relative mx-auto h-full max-w-xl overflow-hidden">
          {/* CALL surface — the "forward" screen: off-right until callView. */}
          {chatEligible ? (
            <div
              className={`cv-slide absolute inset-0 ${callView ? "translate-x-0" : "translate-x-full"}`}
              aria-hidden={!callView}
            >
              <CallView
                agent={agent}
                nowPlaying={nowPlaying}
                items={items}
                liveClips={state.liveClips}
                ackFlash={ackFlash}
                elapsed={elapsed}
                liveStartedAt={state.liveStartedAt}
                liveBusy={liveBusy}
                liveMuted={liveMuted}
                muteBusy={muteBusy}
                replyable={isReplyComposerEligible(agent)}
                onEndLive={handleEndLive}
                onToggleMute={handleToggleMute}
                onSendText={() => convo.setCallView(false)}
              />
            </div>
          ) : null}

          {/* CHAT surface — base; slides off-left under the call view. */}
          <div
            className={`cv-slide absolute inset-0 ${callView ? "-translate-x-full" : "translate-x-0"}`}
            aria-hidden={callView}
          >
            <ChatView
              agent={agent}
              items={items}
              replayAll={replayAll}
              liveOn={liveOn}
              callView={callView}
              elapsed={elapsed}
              ackAts={state.ackAts}
              liveBusy={liveBusy}
              liveTransition={state.liveTransition}
              liveMuted={liveMuted}
              muteBusy={muteBusy}
              chatEligible={chatEligible}
              onGoLive={handleGoLive}
              onEndLive={handleEndLive}
              onToggleMute={handleToggleMute}
              onBackToCall={() => convo.setCallView(true)}
              onCollapse={() => convo.close()}
              onPlay={handlePlay}
              onSend={handleSend}
            />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
