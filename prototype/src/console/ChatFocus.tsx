import { CrtFace, Waveform } from "@room/ui/rig";
import { Minimize2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { AvatarFace } from "../avatars/AvatarFace";
import { PartNo } from "../map/PartNo";
import { useRoom } from "../mock/store";
import { ConsoleDock } from "./ConsoleDock";
import { TurnChip } from "./TurnChip";
import { WatchChips } from "./WatchChips";
import { transcriptRowKey } from "./transcriptKeys";

interface ChatFocusProps {
  draft: string;
  onDraftChange: (draft: string) => void;
  onRestore: () => void;
}

export function ChatFocus({ draft, onDraftChange, onRestore }: ChatFocusProps) {
  const room = useRoom();
  const panelRef = useRef<HTMLElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const mikeySpeaking = room.speakingPersona === "mikey";
  const mode = room.mood === "the-lull" ? "stoked" : mikeySpeaking ? "speaking" : "idle";
  const hasWatchStatus = room.crafts.some((craft) => craft.watched) || Boolean(room.liveClip);

  useEffect(() => {
    panelRef.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
  }, []);

  useEffect(() => {
    const log = logRef.current;
    if (room.transcript.length > 0 && log) log.scrollTop = log.scrollHeight;
  }, [room.transcript]);

  return (
    <section ref={panelRef} id="chatfocus" className="chatfocus">
      <header className={`chatfocus-head${hasWatchStatus ? " has-part-no" : ""}`}>
        <CrtFace size={52} scanlines>
          <AvatarFace persona="mikey" mode={mode} size={52} />
        </CrtFace>
        <div className="chatfocus-voice">
          <b>MIKEY</b>
          <span>
            <i className={`chatfocus-lamp${mikeySpeaking ? " is-speaking" : ""}`} />
            {mikeySpeaking ? "SPEAKING" : room.mood === "the-lull" ? "STOKED" : "IDLE"}
          </span>
        </div>
        <Waveform active={mikeySpeaking} />
        <span className="chatfocus-title">COMMS LOG</span>
        <button
          type="button"
          className="vt-latch"
          aria-expanded="true"
          aria-controls="chatfocus"
          onClick={onRestore}
        >
          <Minimize2 size={12} />
          RESTORE
        </button>
        {hasWatchStatus ? <PartNo partNo="S-09" bindHousing={false} /> : null}
      </header>
      <div ref={logRef} className="chatfocus-log screenbed">
        <div className="chatfocus-thread">
          {room.transcript.map((row, index) => (
            <div className="row" key={transcriptRowKey(row)}>
              <span className="who">{row.who}</span>
              <span className={`say${row.you ? " you" : ""}`}>
                {row.text}
                {index === room.transcript.length - 1 && mikeySpeaking ? (
                  <span className="cursor" />
                ) : null}
              </span>
            </div>
          ))}
          <WatchChips />
          <TurnChip />
        </div>
      </div>
      <ConsoleDock draft={draft} onDraftChange={onDraftChange} />
    </section>
  );
}
