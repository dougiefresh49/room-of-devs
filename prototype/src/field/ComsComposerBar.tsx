import { ArrowUp, Mic } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { injectReply, setComposer } from "../mock/scenario";
import { useRoom } from "../mock/store";
import type { ComposerTarget } from "../mock/types";

function placeholder(target: ComposerTarget): string {
  if (target.kind === "craft") return `reply to ${target.craft.callsign} — lands as a tmux inject`;
  if (target.kind === "mikey-about") return `tell Mikey about ${target.craft.ticket}…`;
  return "reply to Mikey…";
}

function sizeTextarea(textarea: HTMLTextAreaElement | null) {
  if (!textarea) return;
  textarea.style.height = "auto";
  const computedMaxHeight = Number.parseFloat(window.getComputedStyle(textarea).maxHeight);
  const maxHeight = Number.isFinite(computedMaxHeight) ? computedMaxHeight : 150;
  textarea.style.height = `${Math.min(maxHeight, Math.max(45, textarea.scrollHeight))}px`;
  textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
}

function publishComposerHeight(bar: HTMLFormElement | null) {
  const root = bar?.closest<HTMLElement>(".field-root");
  if (!bar || !root) return;
  const height = Math.ceil(bar.getBoundingClientRect().height);
  if (height > 0) root.style.setProperty("--field-composer-h", `${height}px`);
}

/**
 * Persistent slim composer bar — the only bottom chrome, COMS-only.
 * One always-mounted textarea (never swapped) + MIC + SEND keys.
 */
export function ComsComposerBar({
  target,
  focusSignal,
  scrollOnFocus,
  onFocusChange,
  onTargetConsumed,
  onTargetDismissed,
  onOpenVoice,
}: {
  target: ComposerTarget;
  focusSignal: number;
  scrollOnFocus: boolean;
  onFocusChange: (focused: boolean) => void;
  onTargetConsumed: () => void;
  onTargetDismissed: () => void;
  onOpenVoice: () => void;
}) {
  const room = useRoom();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const barRef = useRef<HTMLFormElement>(null);
  const seenFocusSignal = useRef(0);

  useLayoutEffect(() => {
    if (focusSignal === seenFocusSignal.current) return;
    seenFocusSignal.current = focusSignal;
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    sizeTextarea(textarea);
    if (scrollOnFocus) {
      window.requestAnimationFrame(() =>
        textarea.scrollIntoView({ block: "nearest", inline: "nearest" }),
      );
    }
  }, [focusSignal, scrollOnFocus]);

  const targeted = target.kind === "craft";

  useLayoutEffect(() => {
    sizeTextarea(textareaRef.current);
    publishComposerHeight(barRef.current);
  }, [room.composerText, targeted]);

  useLayoutEffect(() => {
    const bar = barRef.current;
    const root = bar?.closest<HTMLElement>(".field-root");
    publishComposerHeight(bar);
    const observer =
      bar && "ResizeObserver" in window
        ? new ResizeObserver(() => publishComposerHeight(bar))
        : null;
    if (bar) observer?.observe(bar);
    return () => {
      observer?.disconnect();
      root?.style.setProperty("--field-composer-h", "0px");
    };
  }, []);

  const submit = () => {
    const text = room.composerText.trim();
    if (!text) return;
    injectReply(text, target);
    onTargetConsumed();
  };

  return (
    <form
      ref={barRef}
      className="screenbed fcomposer"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {targeted ? (
        <div className="fcomposer-target">
          <span>
            ▸ {target.craft.callsign} · {target.craft.ticket}
          </span>
          <button
            type="button"
            aria-label={`Stop answering ${target.craft.callsign}`}
            onPointerDown={(event) => event.preventDefault()}
            onClick={onTargetDismissed}
          >
            ×
          </button>
        </div>
      ) : null}
      <div className="fcomposer-row">
        <textarea
          ref={textareaRef}
          rows={1}
          value={room.composerText}
          placeholder={placeholder(target)}
          aria-label="Type a room message"
          onChange={(event) => {
            setComposer(event.currentTarget.value);
            sizeTextarea(event.currentTarget);
          }}
          onFocus={(event) => {
            const textarea = event.currentTarget;
            onFocusChange(true);
            sizeTextarea(textarea);
            if (scrollOnFocus) {
              window.requestAnimationFrame(() =>
                textarea.scrollIntoView({ block: "nearest", inline: "nearest" }),
              );
            }
          }}
          onBlur={() => {
            onFocusChange(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              event.currentTarget.blur();
              return;
            }
            if (event.key !== "Enter" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
            if (event.nativeEvent.isComposing) return;
            // Phone-class input keeps Enter as a newline. Evaluate at the
            // keystroke because pointer capability can change at runtime.
            if (
              window.matchMedia("(pointer: coarse)").matches ||
              navigator.maxTouchPoints > 0
            ) return;
            event.preventDefault();
            submit();
          }}
        />
        <button
          type="button"
          className={`fckey fcomposer-mic${room.micHot ? " is-hot" : ""}`}
          aria-label={room.micHot ? "Mic hot on the Mac" : "Open voice reply"}
          disabled={room.micHot}
          onPointerDown={(event) => event.preventDefault()}
          onClick={onOpenVoice}
        >
          <span className="fckey-face">
            <Mic size={16} aria-hidden />
            {room.micHot ? <b>MIC HOT</b> : null}
          </span>
        </button>
        <button
          type="submit"
          className="fckey is-send"
          aria-label="Send message"
          disabled={!room.composerText.trim()}
          onPointerDown={(event) => event.preventDefault()}
        >
          <span className="fckey-face">
            <ArrowUp size={16} strokeWidth={2.5} aria-hidden />
          </span>
        </button>
      </div>
    </form>
  );
}
