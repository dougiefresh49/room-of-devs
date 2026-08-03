import { Button } from "@room/ui";
import { ArrowUp, Mic, Plus } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { micClose, micOpen, sendVoiceChat } from "../mock/scenario";
import { useRoom } from "../mock/store";

const MAX_TEXTAREA_HEIGHT = 168;

function sizeTextarea(textarea: HTMLTextAreaElement | null) {
  if (!textarea) return;
  textarea.style.height = "auto";
  textarea.style.height = `${Math.min(textarea.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  textarea.style.overflowY = textarea.scrollHeight > MAX_TEXTAREA_HEIGHT ? "auto" : "hidden";
}

interface ConsoleDockProps {
  draft: string;
  onDraftChange: (draft: string) => void;
}

export function ConsoleDock({ draft, onDraftChange }: ConsoleDockProps) {
  const room = useRoom();
  const voice = room.crew.find((member) => member.id === room.voicePersona);
  const voiceCallsign = voice?.callsign ?? room.voicePersona.toUpperCase();
  const voiceName = voiceCallsign.charAt(0) + voiceCallsign.slice(1).toLocaleLowerCase();
  const panelRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    if (textareaRef.current?.value !== draft) return;
    sizeTextarea(textareaRef.current);
  }, [draft]);

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    sendVoiceChat(text);
    onDraftChange("");
  };

  return (
    <form
      ref={panelRef}
      className={`cdock${room.micHot ? " hot" : ""}`}
      tabIndex={-1}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="cdock-field screenbed">
        <textarea
          ref={textareaRef}
          id="voice-message"
          name="voice-message"
          rows={1}
          value={draft}
          placeholder={`message ${voiceName}…`}
          aria-label={`Message ${voiceName}`}
          onChange={(event) => {
            onDraftChange(event.currentTarget.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
              return;
            }
            if (event.key === "Escape") {
              event.preventDefault();
              event.currentTarget.blur();
              panelRef.current?.focus();
            }
          }}
        />
      </div>
      <div className="cdock-actions">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="dockkey"
          aria-label="Attach"
          title="ATTACH"
        >
          <Plus size={15} />
        </Button>
        <button
          type="button"
          className="cdock-ptt"
          onPointerDown={() => micOpen()}
          onPointerUp={() => micClose()}
          onPointerLeave={() => {
            if (room.micHot) micClose();
          }}
        >
          <span className="btn">
            <Mic size={13} />
          </span>
          <span className="lbl">
            <b>{room.micHot ? "CAPTURING — RELEASE TO SEND" : "HOLD TO TALK"}</b>
            <span>{room.micHot ? "RELEASE SPACE / HW KEY" : "SPACE / HW KEY"}</span>
          </span>
        </button>
        <Button
          type="submit"
          variant="default"
          size="icon"
          className="sendkey"
          aria-label="Send message"
          title={"SEND \u23ce"}
          disabled={!draft.trim()}
        >
          <ArrowUp size={16} strokeWidth={2.5} />
        </Button>
      </div>
    </form>
  );
}
