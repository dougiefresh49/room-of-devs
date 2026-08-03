import { Maximize2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { RigMasthead } from "../chrome/RigMasthead";
import { PartNo } from "../map/PartNo";
import { useFleet, useRoom } from "../mock/store";
import { ChatFocus } from "./ChatFocus";
import { ConsoleDock } from "./ConsoleDock";
import { CrewManifest } from "./CrewManifest";
import { DockMiniBar } from "./DockMiniBar";
import { DonnieBay, Faceplate } from "./Faceplate";
import { InstrumentBay } from "./InstrumentBay";
import { ReplyDeck } from "./ReplyDeck";
import { SpineRail } from "./SpineRail";
import { ThreadNode } from "./ThreadNode";
import { TurnChip } from "./TurnChip";
import { VerbRack } from "./VerbRack";
import { WatchChips } from "./WatchChips";
import { transcriptRowKey } from "./transcriptKeys";

export function ConsoleView() {
  const room = useRoom();
  const fleet = useFleet();
  const [instrOpen, setInstrOpen] = useState(true);
  const [chatFocused, setChatFocused] = useState(false);
  const [draft, setDraft] = useState("");
  const focusLatchRef = useRef<HTMLButtonElement>(null);
  const restingLogRef = useRef<HTMLDivElement>(null);

  const restoreChat = useCallback(() => {
    setChatFocused(false);
    window.requestAnimationFrame(() => focusLatchRef.current?.focus());
  }, []);

  useEffect(() => {
    if (fleet.activeRoomId) setChatFocused(false);
  }, [fleet.activeRoomId]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1180px)");
    const forceOpen = () => {
      if (media.matches) setInstrOpen(true);
    };
    forceOpen();
    media.addEventListener("change", forceOpen);
    return () => media.removeEventListener("change", forceOpen);
  }, []);

  useEffect(() => {
    if (!chatFocused) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const target = event.target as Element | null;
      if (target?.closest('[role="dialog"], [cmdk-root]')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      restoreChat();
    };
    window.addEventListener("keydown", onEscape, true);
    return () => window.removeEventListener("keydown", onEscape, true);
  }, [chatFocused, restoreChat]);

  useEffect(() => {
    const log = restingLogRef.current;
    if (room.transcript.length > 0 && log) log.scrollTop = log.scrollHeight;
  }, [room.transcript]);

  if (room.view === "node") {
    const craft =
      room.crafts.find((c) => c.id === room.focusCraftId) ??
      room.crafts.find((c) => c.state !== "empty");
    return (
      <div className="chassis mainwin">
        <RigMasthead mode="room" stamp={`ZOOM 3 · ${craft?.ticket ?? "—"}`} />
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          {craft ? <ThreadNode craft={{ ...craft, open: true }} /> : null}
        </div>
      </div>
    );
  }

  const recentTranscript = room.transcript.slice(-4);
  const hasWatchStatus = room.crafts.some((craft) => craft.watched) || Boolean(room.liveClip);

  return (
    <>
      <div className="chassis mainwin">
        <RigMasthead mode="room" />
        <span className="screw tl" />
        <span className="screw tr" />
        <span className="screw bl" />
        <span className="screw br" />
        <div
          className={`cols${instrOpen ? "" : " cols--instr-collapsed"}${chatFocused ? " cols--chat-focused" : ""}`}
        >
          <div inert={chatFocused || undefined} aria-hidden={chatFocused || undefined}>
            <Faceplate />
            <div className="screenbed vt">
              <div className={`cap vt-cap${hasWatchStatus ? " has-part-no" : ""}`}>
                <span>COMMS LOG</span>
                <button
                  ref={focusLatchRef}
                  type="button"
                  className="vt-latch"
                  aria-expanded={chatFocused}
                  aria-controls={chatFocused ? "chatfocus" : undefined}
                  onClick={() => setChatFocused(true)}
                >
                  <Maximize2 size={12} />
                  FOCUS
                </button>
                {hasWatchStatus ? <PartNo partNo="S-09" bindHousing={false} /> : null}
              </div>
              <div ref={restingLogRef} className="vt-log">
                {recentTranscript.map((row, index) => (
                  <div className="row" key={transcriptRowKey(row)}>
                    <span className="who">{row.who}</span>
                    <span className={`say${row.you ? " you" : ""}`}>
                      {row.text}
                      {index === recentTranscript.length - 1 && room.speakingPersona === "mikey" ? (
                        <span className="cursor" />
                      ) : null}
                    </span>
                  </div>
                ))}
                <WatchChips />
                <TurnChip />
              </div>
            </div>
            {!chatFocused ? <ConsoleDock draft={draft} onDraftChange={setDraft} /> : null}
            <DonnieBay />
          </div>

          <div inert={chatFocused || undefined} aria-hidden={chatFocused || undefined}>
            <SpineRail />
          </div>

          <InstrumentBay
            open={instrOpen}
            clearPct={room.salience.clearPct}
            onToggle={() => setInstrOpen((open) => !open)}
          />

          {chatFocused ? (
            <ChatFocus draft={draft} onDraftChange={setDraft} onRestore={restoreChat} />
          ) : null}
        </div>
      </div>

      <h2>
        <span className="idx">03</span> Reply deck · verb rack
      </h2>
      <ReplyDeck />
      <div className="startgrid" style={{ marginTop: 14 }}>
        <VerbRack />
      </div>

      <h2>
        <span className="idx">04</span> Crew manifest
      </h2>
      <CrewManifest />

      <DockMiniBar />
    </>
  );
}
