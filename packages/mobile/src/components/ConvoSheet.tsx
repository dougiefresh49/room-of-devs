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
import { useEffect, useState } from "react";
import type { AgentView, Command, NowPlaying } from "@room/protocol";
import { client } from "../client.js";
import { audioController } from "../audio/controller.js";
import { convo, useConvo } from "../convo-state.js";
import { useThread } from "../thread.js";
import { clearDraft } from "../drafts.js";
import type { ReplayEntry } from "../api.js";
import { CallView } from "./CallView.js";
import { ChatView } from "./ChatView.js";

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

  // Body scroll-lock while the sheet is open.
  useEffect(() => {
    if (!sessionId) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [sessionId]);

  if (!sessionId || !agent) return null;

  const name = agent.label || agent.name;
  const liveOn = !!agent.live?.on;
  // convo-state owns callView: go-live sets it, send-a-text/end-live/live-off
  // clear it. Honor it directly — during the sub-second go-live optimism window
  // (callView true, liveOn not yet) the CALL surface is already shown.
  const callView = state.callView;
  const elapsed = fmtElapsed(state.liveStartedAt, now);
  const ackFlash = state.ackFlashUntil != null && now < state.ackFlashUntil;

  const handleGoLive = async () => {
    audioController.prime();
    audioController.primeAck();
    convo.beginLive(sessionId);
    convo.setCallView(true);
    try {
      const r = await client.request({ type: "set_live", sessionId, on: true } as Command);
      if (!r.ok) {
        convo.endLive(sessionId);
        audioController.announce("Couldn't go live");
      }
    } catch {
      convo.endLive(sessionId);
      audioController.announce("Couldn't go live");
    }
  };

  const handleEndLive = () => {
    // Stop phone audio first, clear live state (slides to chat), then tell the
    // daemon — order per §B2.
    audioController.stop();
    convo.endLive(sessionId);
    void client
      .request({ type: "set_live", sessionId, on: false } as Command)
      .then((r) => {
        if (!r.ok) audioController.announce("Couldn't end live");
      })
      .catch(() => audioController.announce("Couldn't end live"));
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
      const r = await client.request({ type: "reply", sessionId, text } as Command);
      if (r.ok) {
        convo.resetLiveClips(sessionId);
        convo.bumpThread(); // /thread is the source of truth — refetch now
        clearDraft(sessionId);
        audioController.announce(`Reply sent to ${name}`);
        return true;
      }
      audioController.announce(
        r.code === "not_in_team" ? "Not in team — respawn from +" : "Reply failed",
      );
      return false;
    } catch {
      audioController.announce("Reply failed");
      return false;
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-bg" role="dialog" aria-modal="true" aria-label={`Conversation with ${name}`}>
      <div className="relative mx-auto h-full max-w-xl overflow-hidden">
        {/* CALL surface — the "forward" screen: off-right until callView. */}
        {agent.injectable ? (
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
              onEndLive={handleEndLive}
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
            onGoLive={handleGoLive}
            onEndLive={handleEndLive}
            onBackToCall={() => convo.setCallView(true)}
            onCollapse={() => convo.close()}
            onPlay={handlePlay}
            onSend={handleSend}
          />
        </div>
      </div>
    </div>
  );
}
