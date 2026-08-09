import { Led } from "@room/ui/rig";
import {
  ArrowUp,
  ChevronDown,
  Gauge,
  MessageSquare,
  Mic,
  PenLine,
  Radar,
  ToggleRight,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef } from "react";
import { injectReply, setComposer } from "../mock/scenario";
import { useRoom } from "../mock/store";
import type { ComposerTarget } from "../mock/types";

export type FieldScreen = "glance" | "coms" | "orders" | "gauges";
export type FieldDockMode = "nav" | "reply";

export interface FieldBadge {
  tone: "red" | "amber";
  pulse?: boolean;
  label: string;
}

const TABS = [
  { id: "glance", label: "GLANCE", Icon: Radar },
  { id: "coms", label: "COMS", Icon: MessageSquare },
  { id: "orders", label: "ORDERS", Icon: ToggleRight },
  { id: "gauges", label: "GAUGES", Icon: Gauge },
] satisfies { id: FieldScreen; label: string; Icon: typeof Radar }[];

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

function publishDockHeight(dock: HTMLDivElement | null) {
  const root = dock?.closest<HTMLElement>(".field-root");
  if (!dock || !root) return;
  const height = Math.ceil(dock.getBoundingClientRect().height);
  if (height > 0) root.style.setProperty("--field-dock-h", `${height}px`);
}

export function FieldDock({
  mode,
  screen,
  badges,
  target,
  focused,
  focusSignal,
  anySheetOpen,
  scrollOnFocus,
  onModeChange,
  onScreenChange,
  onRestoreDraft,
  onBadgePress,
  onFocusChange,
  onTargetConsumed,
  onTargetDismissed,
  onOpenVoice,
}: {
  mode: FieldDockMode;
  screen: FieldScreen;
  badges: Partial<Record<FieldScreen, FieldBadge>>;
  target: ComposerTarget;
  focused: boolean;
  focusSignal: number;
  anySheetOpen: boolean;
  scrollOnFocus: boolean;
  onModeChange: (mode: FieldDockMode) => void;
  onScreenChange: (screen: FieldScreen) => void;
  onRestoreDraft: () => void;
  onBadgePress?: (screen: FieldScreen, badge: FieldBadge) => void;
  onFocusChange: (focused: boolean) => void;
  onTargetConsumed: () => void;
  onTargetDismissed: () => void;
  onOpenVoice: () => void;
}) {
  const room = useRoom();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const seenFocusSignal = useRef(0);

  useLayoutEffect(() => {
    if (focusSignal === seenFocusSignal.current || mode !== "reply") return;
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
  }, [focusSignal, mode, scrollOnFocus]);

  useLayoutEffect(() => {
    if (mode === "reply") sizeTextarea(textareaRef.current);
    publishDockHeight(dockRef.current);
  }, [mode, room.composerText]);

  useLayoutEffect(() => {
    const dock = dockRef.current;
    if (!dock || !("ResizeObserver" in window)) return;
    const observer = new ResizeObserver(() => publishDockHeight(dock));
    observer.observe(dock);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (mode !== "reply" || focused || anySheetOpen) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onModeChange("nav");
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [anySheetOpen, focused, mode, onModeChange]);

  const submit = () => {
    const text = room.composerText.trim();
    if (!text) return;
    injectReply(text, target);
    onTargetConsumed();
  };

  const targeted = target.kind === "craft";
  const hasDraft = room.composerText.trim().length > 0;

  return (
    <div ref={dockRef} className="fdock">
      <nav className="fdock-nav" aria-label="Field screens" hidden={mode !== "nav"}>
        {TABS.map(({ id, label, Icon }) => {
          const badge = badges[id];
          return (
            <button
              type="button"
              key={id}
              className={screen === id ? "is-active" : undefined}
              aria-current={screen === id ? "page" : undefined}
              onClick={() => {
                onScreenChange(id);
                if (badge) onBadgePress?.(id, badge);
              }}
            >
              <Icon size={20} aria-hidden />
              <span>{label}</span>
              {badge ? <Led tone={badge.tone} pulse={badge.pulse} className="fdock-dot" /> : null}
              {id === "coms" && room.micHot ? (
                <Led tone="red" className="fdock-mic-hot-dot" />
              ) : null}
              {badge ? <span className="sr-only">{badge.label}</span> : null}
              {id === "coms" && room.micHot ? <span className="sr-only">Mac mic hot</span> : null}
            </button>
          );
        })}
        {hasDraft ? (
          <button
            type="button"
            className="fdock-draft"
            aria-label="DRAFT — restore saved reply"
            onClick={onRestoreDraft}
          >
            <span className="fdock-draft-icon">
              <PenLine size={18} aria-hidden />
              <span className="fdock-draft-dot" aria-hidden />
            </span>
            <span>DRAFT</span>
          </button>
        ) : null}
      </nav>
      <form
        className="screenbed fdock-reply"
        hidden={mode !== "reply"}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
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
            } else if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <div className="fdock-actions">
          <button
            type="button"
            className="fcomp-key fdock-close"
            aria-label="Close composer, keep draft"
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => {
              textareaRef.current?.blur();
              onFocusChange(false);
              onModeChange("nav");
            }}
          >
            <ChevronDown size={18} aria-hidden />
          </button>
          <span className="fdock-action-spacer" />
          {targeted ? (
            <div className="fdock-target">
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
          <button
            type="button"
            className={`fcomp-key fdock-mic${room.micHot ? " is-hot" : ""}`}
            aria-label={room.micHot ? "Mic hot on the Mac" : "Open voice reply"}
            disabled={room.micHot}
            onPointerDown={(event) => event.preventDefault()}
            onClick={onOpenVoice}
          >
            <Mic size={18} aria-hidden />
            {room.micHot ? <span>MIC HOT</span> : null}
          </button>
          <button
            type="submit"
            className="fcomp-key sendkey"
            aria-label="Send message"
            disabled={!room.composerText.trim()}
            onPointerDown={(event) => event.preventDefault()}
          >
            <ArrowUp size={18} strokeWidth={2.5} aria-hidden />
          </button>
        </div>
      </form>
    </div>
  );
}
