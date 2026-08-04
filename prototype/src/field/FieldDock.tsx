import { Button } from "@room/ui";
import { ArrowUp, Plus, RotateCcw, Square } from "lucide-react";
import { useEffect, useRef } from "react";
import { injectReply, replayLastMikey, setComposer, stopPlayback } from "../mock/scenario";
import { useRoom } from "../mock/store";
import { PttPill } from "./PttPill";

const MAX_TEXTAREA_HEIGHT = 132;

function sizeTextarea(textarea: HTMLTextAreaElement | null) {
  if (!textarea) return;
  textarea.style.height = "auto";
  textarea.style.height = `${Math.min(textarea.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  textarea.style.overflowY = textarea.scrollHeight > MAX_TEXTAREA_HEIGHT ? "auto" : "hidden";
}

function TransportKeys() {
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="dockkey stopkey"
        aria-label="Stop playback"
        title="STOP"
        onClick={() => stopPlayback()}
      >
        <Square size={15} fill="var(--red)" strokeWidth={0} />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="dockkey replaykey"
        aria-label="Replay last clip (free)"
        title="REPLAY LAST · FREE"
        onClick={() => replayLastMikey()}
      >
        <RotateCcw size={16} />
      </Button>
    </>
  );
}

export function FieldDock({ listen = false }: { listen?: boolean }) {
  const room = useRoom();
  const panelRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    sizeTextarea(textareaRef.current);
  }, [room.composerText]);

  useEffect(() => {
    const focusComposer = () => {
      textareaRef.current?.focus();
      textareaRef.current?.scrollIntoView({ block: "nearest" });
    };
    window.addEventListener("field:focus-composer", focusComposer);
    return () => window.removeEventListener("field:focus-composer", focusComposer);
  }, []);

  const submit = () => {
    const text = room.composerText.trim();
    if (!text) return;
    injectReply(text);
  };

  return (
    <form
      ref={panelRef}
      className="fdock"
      data-part="F-06"
      tabIndex={-1}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="fdock-field screenbed">
        <textarea
          ref={textareaRef}
          id="field-message"
          name="field-message"
          rows={1}
          value={room.composerText}
          placeholder="type it — lands as a tmux inject"
          aria-label="Type a reply"
          onChange={(event) => {
            setComposer(event.currentTarget.value);
            sizeTextarea(event.currentTarget);
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

      <div className="fdock-actions">
        {listen ? <TransportKeys /> : null}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="dockkey attachkey"
          aria-label="Attach"
          title="ATTACH"
        >
          <Plus size={15} />
        </Button>
        <PttPill compact={!listen} icon={listen} />
        <Button
          type="submit"
          variant="default"
          size="icon"
          className="sendkey"
          aria-label="Send message"
          title={"SEND \u23ce"}
          disabled={!room.composerText.trim()}
        >
          <ArrowUp size={16} strokeWidth={2.5} />
        </Button>
      </div>
    </form>
  );
}
