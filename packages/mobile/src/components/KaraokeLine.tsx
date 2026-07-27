/**
 * One-line karaoke — the current word highlighted, the line scrolling it into
 * view. Shared by the docked MiniPlayer, the chat playback strip, and the call
 * card (extracted from MiniPlayer in chunk E so the three surfaces render
 * identical timing). Pure presentational: it takes the controller's text +
 * alignment + elapsedMs and never touches <audio>.
 *
 * `variant` tunes the base color: "line" for the slim strips (muted default),
 * "card" for the call card (fuller text, dims for a `kind:"live"` clip).
 */
import { useEffect, useRef } from "react";
import type { AlignmentTuples } from "@room/protocol";
import { karaokeWords } from "../audio/karaoke.js";

interface KaraokeLineProps {
  text: string;
  alignment: AlignmentTuples | null;
  elapsedMs: number;
  pendingTap?: boolean;
  variant?: "line" | "card";
  /** Dim the un-spoken text (a live/intermediate clip, per §B2 precedence). */
  dim?: boolean;
}

export function KaraokeLine({
  text,
  alignment,
  elapsedMs,
  pendingTap = false,
  variant = "line",
  dim = false,
}: KaraokeLineProps) {
  const scrollRef = useRef<HTMLSpanElement | null>(null);
  const words = pendingTap ? null : karaokeWords(alignment, elapsedMs);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    try {
      el.scrollIntoView({ inline: variant === "line" ? "center" : "nearest", block: "nearest" });
    } catch {
      /* older webview */
    }
  });

  if (pendingTap) {
    return <div className="truncate text-[13px] text-fg-muted">Ready — tap to play</div>;
  }

  if (!words) {
    // No alignment → plain text. The card wraps; the slim line clips to one row.
    return variant === "card" ? (
      <div className={`text-[15px] leading-relaxed ${dim ? "text-fg-muted" : "text-fg"}`}>
        {text}
      </div>
    ) : (
      <div className="truncate text-[13px] text-fg">{text}</div>
    );
  }

  // Spoken word = accent; already-spoken = readable; not-yet-spoken = faint.
  // A dim (live/intermediate) clip pulls the whole line back a notch.
  const pastCls = dim ? "text-fg-faint" : "text-fg-muted";
  const futureCls = "text-fg-faint";

  return (
    <div
      className={
        variant === "card"
          ? "flex flex-wrap gap-x-1 gap-y-0.5 text-[15px] leading-relaxed"
          : "flex gap-1 overflow-hidden whitespace-nowrap text-[13px] leading-snug"
      }
    >
      {words.map((w, i) => (
        <span
          key={i}
          ref={w.state === "on" ? scrollRef : undefined}
          className={
            w.state === "on"
              ? "font-semibold text-accent"
              : w.state === "past"
                ? pastCls
                : futureCls
          }
        >
          {w.word}
        </span>
      ))}
    </div>
  );
}
