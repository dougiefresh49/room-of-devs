import { Led } from "@room/ui/rig";
import { ArrowUp, Gauge, LayoutGrid, MessageSquare, Mic, Radar, ToggleRight } from "lucide-react";
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
  textarea.style.height = `${Math.min(84, Math.max(40, textarea.scrollHeight))}px`;
  textarea.style.overflowY = textarea.scrollHeight > 84 ? "auto" : "hidden";
}

export function FieldDock({
  mode,
  screen,
  badges,
  target,
  focused,
  focusSignal,
  onModeChange,
  onScreenChange,
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
  onModeChange: (mode: FieldDockMode) => void;
  onScreenChange: (screen: FieldScreen) => void;
  onBadgePress?: (screen: FieldScreen, badge: FieldBadge) => void;
  onFocusChange: (focused: boolean) => void;
  onTargetConsumed: () => void;
  onTargetDismissed: () => void;
  onOpenVoice: () => void;
}) {
  const room = useRoom();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dockRef = useRef<HTMLElement>(null);
  const seenFocusSignal = useRef(0);
  const blurredByEscape = useRef(false);

  useLayoutEffect(() => {
    if (focusSignal === seenFocusSignal.current || mode !== "reply") return;
    seenFocusSignal.current = focusSignal;
    textareaRef.current?.focus();
    sizeTextarea(textareaRef.current);
  }, [focusSignal, mode]);

  useEffect(() => {
    if (mode !== "reply") blurredByEscape.current = false;
  }, [mode]);

  useEffect(() => {
    const dock = dockRef.current;
    const root = dock?.closest<HTMLElement>(".field-root");
    if (!dock || !root) return;
    const publishHeight = () => {
      const height = Math.ceil(dock.getBoundingClientRect().height);
      if (height > 0) root.style.setProperty("--field-dock-h", `${height}px`);
    };
    publishHeight();
    const observer = "ResizeObserver" in window ? new ResizeObserver(publishHeight) : null;
    observer?.observe(dock);
    return () => observer?.disconnect();
  }, [mode]);

  useEffect(() => {
    if (mode !== "reply" || focused || !blurredByEscape.current) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      blurredByEscape.current = false;
      onModeChange("nav");
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [focused, mode, onModeChange]);

  const submit = () => {
    const text = room.composerText.trim();
    if (!text) return;
    injectReply(text, target);
    onTargetConsumed();
    textareaRef.current?.blur();
  };

  if (mode === "nav") {
    return (
      <nav ref={dockRef} className="fdock fdock-nav" aria-label="Field screens">
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
              {id === "coms" && room.micHot ? <Led tone="red" className="fdock-mic-hot-dot" /> : null}
              {badge ? <span className="sr-only">{badge.label}</span> : null}
              {id === "coms" && room.micHot ? <span className="sr-only">Mac mic hot</span> : null}
            </button>
          );
        })}
      </nav>
    );
  }

  const targeted = target.kind !== "mikey";
  return (
    <form
      ref={(node) => { dockRef.current = node; }}
      className={`fdock fdock-reply${focused ? " is-focused" : ""}`}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <button type="button" className="fcomp-key fdock-tabs" aria-label="Show screen tabs" onClick={() => {
        blurredByEscape.current = false;
        onFocusChange(false);
        onModeChange("nav");
      }}>
        <LayoutGrid size={18} aria-hidden />
      </button>
      <div className="fdock-field">
        {focused && targeted ? (
          <div className="fdock-target">
            <span>▸ ANSWERING {target.craft.callsign} · {target.craft.ticket}</span>
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
        <textarea
          ref={textareaRef}
          rows={1}
          value={room.composerText}
          placeholder={placeholder(target)}
          aria-label="Type a room message"
          onChange={(event) => {
            setComposer(event.currentTarget.value);
            if (event.currentTarget === document.activeElement) sizeTextarea(event.currentTarget);
          }}
          onFocus={(event) => {
            blurredByEscape.current = false;
            onFocusChange(true);
            sizeTextarea(event.currentTarget);
          }}
          onBlur={() => {
            onFocusChange(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              blurredByEscape.current = true;
              event.currentTarget.blur();
            } else if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
        />
      </div>
      <button
        type="button"
        className={`fcomp-key fdock-mic${room.micHot ? " is-hot" : ""}`}
        aria-label={room.micHot ? "Mic hot on the Mac" : "Open voice reply"}
        disabled={room.micHot}
        onClick={onOpenVoice}
      >
        <Mic size={18} aria-hidden />
        {room.micHot ? <span>MIC HOT</span> : null}
      </button>
      <button type="submit" className="fcomp-key sendkey" aria-label="Send message" disabled={!room.composerText.trim()}>
        <ArrowUp size={18} strokeWidth={2.5} aria-hidden />
      </button>
    </form>
  );
}
