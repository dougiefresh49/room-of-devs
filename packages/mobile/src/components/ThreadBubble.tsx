/**
 * One chat message bubble (spec §B1): agent-left, user-right. Agent text is
 * sanitized markdown (SummaryText → @room/ui Markdown, mobile "inert" link
 * policy); user text stays plain. Agent FINAL bubbles carry a play affordance
 * (owner 2026-08-15): "replay" replays the saved clip for free (play icon);
 * "update" grants the queued unheard update; "generate" re-synthesizes an
 * older final with no clip. The sparkle icon marks the billable pair
 * (update/generate both synthesize) vs the free replay. The parent resolves
 * which action applies and handles the dispatch.
 */
import { IconPlay, IconSparkle, SummaryText } from "@room/ui";
import type { ReplayEntry, ThreadItem } from "../api.js";

export type BubblePlayAction =
  | { kind: "replay"; entry: ReplayEntry }
  | { kind: "update" }
  | { kind: "generate"; text: string };

interface ThreadBubbleProps {
  item: ThreadItem;
  play: BubblePlayAction | null;
  onPlayReplay: (entry: ReplayEntry) => void;
  onGrant: () => void;
  onSpeakText: (text: string) => void;
}

const CHIP_CLASS =
  "mt-2 inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-surface py-1 pl-2 pr-2.5 text-[12px] font-semibold text-fg transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent [&_svg]:size-3.5";

export function ThreadBubble({ item, play, onPlayReplay, onGrant, onSpeakText }: ThreadBubbleProps) {
  if (item.role === "user") {
    return (
      <div className="max-w-[86%] self-end whitespace-pre-wrap break-words rounded-2xl rounded-br-md border border-transparent bg-accent/15 px-3 py-2 text-[14px] leading-relaxed text-fg">
        {item.text}
      </div>
    );
  }

  const dim = !item.final;
  return (
    <div
      className={`max-w-[86%] self-start break-words rounded-2xl rounded-bl-md border border-line bg-surface px-3 py-2 ${
        dim ? "opacity-70" : ""
      }`}
    >
      <SummaryText
        text={item.text}
        linkPolicy="inert"
        className={`cv-md text-[14px] leading-relaxed ${dim ? "text-fg-muted" : "text-fg"}`}
      />
      {play?.kind === "replay" ? (
        <button type="button" onClick={() => onPlayReplay(play.entry)} className={CHIP_CLASS}>
          <IconPlay /> Play
        </button>
      ) : play?.kind === "update" ? (
        <button type="button" onClick={onGrant} className={CHIP_CLASS}>
          <IconSparkle /> Play update
        </button>
      ) : play?.kind === "generate" ? (
        <button type="button" onClick={() => onSpeakText(play.text)} className={CHIP_CLASS}>
          <IconSparkle /> Play
        </button>
      ) : null}
    </div>
  );
}
