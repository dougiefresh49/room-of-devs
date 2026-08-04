import { Button } from "@room/ui";
import { ArrowUp, ChevronDown, ChevronUp, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { injectReply, setComposer } from "../mock/scenario";
import { useRoom } from "../mock/store";
import type { Craft } from "../mock/types";
import { FieldTransport } from "./FieldTransport";
import { PttPill } from "./PttPill";

const MAX_TEXTAREA_HEIGHT = 132;

function sizeTextarea(textarea: HTMLTextAreaElement | null) {
  if (!textarea) return;
  textarea.style.height = "auto";
  textarea.style.height = `${Math.min(textarea.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  textarea.style.overflowY = textarea.scrollHeight > MAX_TEXTAREA_HEIGHT ? "auto" : "hidden";
}

interface FieldComposerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFocusChange: (focused: boolean) => void;
  onFocusComposer?: () => void;
  targetCraft?: Craft | null;
}

export function FieldComposer({
  open,
  onOpenChange,
  onFocusChange,
  onFocusComposer,
  targetCraft,
}: FieldComposerProps) {
  const room = useRoom();
  const expandKeyRef = useRef<HTMLButtonElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [portalTarget, setPortalTarget] = useState<HTMLDivElement | null>(null);
  const audioLive = room.speakingPersona != null || room.liveClip != null;

  useEffect(() => sizeTextarea(textareaRef.current), [room.composerText]);

  useEffect(() => {
    setPortalTarget(
      targetCraft
        ? document.querySelector<HTMLDivElement>(".nodesheet-composer-mount")
        : null,
    );
  }, [targetCraft]);

  useEffect(() => {
    const focusComposer = () => {
      onOpenChange(true);
      onFocusComposer?.();
    };
    window.addEventListener("field:focus-composer", focusComposer);
    return () => window.removeEventListener("field:focus-composer", focusComposer);
  }, [onFocusComposer, onOpenChange]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => textareaRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  const collapse = () => {
    onOpenChange(false);
    onFocusChange(false);
    window.requestAnimationFrame(() => expandKeyRef.current?.focus());
  };

  const submit = () => {
    const text = room.composerText.trim();
    if (!text) return;
    injectReply(text, targetCraft?.id);
    onOpenChange(false);
    onFocusChange(false);
    window.requestAnimationFrame(() => expandKeyRef.current?.focus());
  };

  const targetLine = targetCraft ? targetCraft.ticket : undefined;
  const placeholder = targetCraft
    ? `reply to ${targetCraft.callsign} — lands as a tmux inject`
    : "tell Mikey — he routes it to the room";

  const composer = (
    <>
      {open ? (
        <button
          type="button"
          className="fcomp-scrim"
          aria-label="Collapse composer"
          onClick={collapse}
        />
      ) : null}
      <form
        className={`fcomposer${open ? " is-open" : ""}${audioLive ? " has-audio" : ""}`}
        data-part="F-06"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        {open ? (
          <div className="screenbed fcomposer-panel">
            <div className="fcomposer-field screenbed">
              <textarea
                ref={textareaRef}
                id="field-message"
                name="field-message"
                rows={1}
                value={room.composerText}
                placeholder={placeholder}
                aria-label="Type a room message"
                onFocus={() => {
                  onFocusChange(true);
                  onFocusComposer?.();
                }}
                onBlur={() => onFocusChange(false)}
                onChange={(event) => {
                  setComposer(event.currentTarget.value);
                  sizeTextarea(event.currentTarget);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    submit();
                  }
                }}
              />
            </div>
            <div className="fcomposer-actions">
              <Button type="button" variant="ghost" size="icon" className="fcomp-key" aria-label="Attach">
                <Plus size={15} />
              </Button>
              <PttPill segment subLabel={targetLine} />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="fcomp-key"
                aria-label="Collapse composer"
                onClick={collapse}
              >
                <ChevronDown size={17} />
              </Button>
              <Button
                type="submit"
                variant="default"
                size="icon"
                className="fcomp-key sendkey"
                aria-label="Send message"
                disabled={!room.composerText.trim()}
              >
                <ArrowUp size={16} strokeWidth={2.5} />
              </Button>
            </div>
          </div>
        ) : (
          <div className="fcomposer-collapsed">
            {audioLive ? <FieldTransport /> : null}
            <div className="fcombo">
              <PttPill segment short={audioLive} subLabel={targetLine} />
              <button
                ref={expandKeyRef}
                type="button"
                className="fcombo-expand"
                aria-label="Open text composer"
                onClick={() => onOpenChange(true)}
              >
                <ChevronUp size={17} />
              </button>
            </div>
          </div>
        )}
      </form>
    </>
  );

  if (targetCraft) {
    return portalTarget ? createPortal(composer, portalTarget) : null;
  }
  return composer;
}
