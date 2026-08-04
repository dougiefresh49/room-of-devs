import { Button } from "@room/ui";
import { ArrowUp, ChevronDown, ChevronUp, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { injectReply, setComposer } from "../mock/scenario";
import { useRoom } from "../mock/store";
import type { ComposerTarget } from "../mock/types";
import { PttPill } from "./PttPill";

const MAX_TEXTAREA_HEIGHT = 132;

function sizeTextarea(textarea: HTMLTextAreaElement | null) {
  if (!textarea) return;
  textarea.style.height = "auto";
  textarea.style.height = `${Math.min(textarea.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  textarea.style.overflowY = textarea.scrollHeight > MAX_TEXTAREA_HEIGHT ? "auto" : "hidden";
}

function collapsedLabel(target: ComposerTarget): string {
  if (target.kind === "mikey-about") return `TALK TO MIKEY · ${target.craft.ticket}`;
  if (target.kind === "craft") return `TALK TO ${target.craft.callsign} · ${target.craft.ticket}`;
  return "TALK TO MIKEY";
}

function CompactTargetLabel({ target }: { target: ComposerTarget }) {
  const label = collapsedLabel(target);
  const ticketAt = label.lastIndexOf(" · T-");
  return (
    <span className="fcomposer-compact-label" aria-hidden>
      <span className="fcomposer-compact-main">
        {ticketAt < 0 ? label : label.slice(0, ticketAt)}
      </span>
      {ticketAt < 0 ? null : (
        <span className="fcomposer-compact-ticket">{label.slice(ticketAt)}</span>
      )}
    </span>
  );
}

function targetLine(target: ComposerTarget): string {
  if (target.kind === "craft") {
    return `▸ ANSWERING ${target.craft.callsign} · ${target.craft.ticket}`;
  }
  if (target.kind === "mikey-about") {
    return `▸ TELLING MIKEY ABOUT ${target.craft.ticket} · he routes it`;
  }
  return "▸ TALKING TO MIKEY · he routes it";
}

function placeholder(target: ComposerTarget): string {
  if (target.kind === "craft") {
    return `reply to ${target.craft.callsign} — lands as a tmux inject`;
  }
  if (target.kind === "mikey-about") {
    return `tell Mikey about ${target.craft.ticket} — he routes it`;
  }
  return "tell Mikey — he routes it to the room";
}

interface FieldComposerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFocusChange: (focused: boolean) => void;
  onFocusComposer?: () => void;
  target: ComposerTarget;
}

export function FieldComposer({
  open,
  onOpenChange,
  onFocusChange,
  onFocusComposer,
  target,
}: FieldComposerProps) {
  const room = useRoom();
  const expandKeyRef = useRef<HTMLButtonElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [portalTarget, setPortalTarget] = useState<HTMLDivElement | null>(null);
  const mountedInSheet = target.kind !== "mikey";

  useEffect(() => sizeTextarea(textareaRef.current), [room.composerText]);

  useEffect(() => {
    if (!mountedInSheet) {
      setPortalTarget(null);
      return;
    }
    const resolveTarget = () => {
      setPortalTarget(document.querySelector<HTMLDivElement>(".nodesheet-composer-mount"));
    };
    resolveTarget();
    // Radix mounts SheetContent through its own portal. One frame lets that
    // stable mount appear without making the effect depend on the craft object.
    const frame = window.requestAnimationFrame(resolveTarget);
    return () => window.cancelAnimationFrame(frame);
  }, [mountedInSheet]);

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
    injectReply(text, target);
    onOpenChange(false);
    onFocusChange(false);
    window.requestAnimationFrame(() => expandKeyRef.current?.focus());
  };

  const composer = (
    <form
      className={`fcomposer${open ? " is-open" : ""}`}
      data-part="F-06"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {open ? (
        <div className="screenbed fcomposer-panel">
          <div className="fcomposer-target">
            <span>{targetLine(target)}</span>
            <button
              type="button"
              className="fcomposer-collapse"
              aria-label="Collapse composer"
              onClick={collapse}
            >
              <ChevronDown size={17} />
            </button>
          </div>
          <div className="fcomposer-field screenbed">
            <textarea
              ref={textareaRef}
              id="field-message"
              name="field-message"
              rows={1}
              value={room.composerText}
              placeholder={placeholder(target)}
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
              <Plus size={18} />
            </Button>
            <PttPill big />
            <Button
              type="submit"
              variant="default"
              size="icon"
              className="fcomp-key sendkey"
              aria-label="Send message"
              disabled={!room.composerText.trim()}
            >
              <ArrowUp size={18} strokeWidth={2.5} />
            </Button>
          </div>
        </div>
      ) : mountedInSheet ? (
        <div className="fcomposer-collapsed">
          <div className="fcombo fcombo-targeted">
            <PttPill icon />
            <div className={`fcomposer-compact-field${room.composerText ? " has-value" : ""}`}>
              <CompactTargetLabel target={target} />
              <input
                id="field-message-compact"
                name="field-message-compact"
                className="fcomposer-compact-input"
                value={room.composerText}
                aria-label={`${collapsedLabel(target)}; focus to expand composer`}
                onFocus={() => {
                  onOpenChange(true);
                  onFocusChange(true);
                  onFocusComposer?.();
                }}
                onChange={(event) => setComposer(event.currentTarget.value)}
              />
            </div>
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
      ) : (
        <div className="fcomposer-collapsed">
          <div className="fcombo">
            <PttPill segment label={collapsedLabel(target)} />
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
  );

  if (mountedInSheet) {
    return portalTarget ? createPortal(composer, portalTarget) : null;
  }
  return composer;
}
