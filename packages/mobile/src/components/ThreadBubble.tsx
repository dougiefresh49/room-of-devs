/**
 * One chat message bubble (spec §B1): agent-left, user-right. Agent text is
 * sanitized markdown (SummaryText → @room/ui Markdown, mobile "inert" link
 * policy); user text stays plain. A Play chip rides an agent FINAL bubble ONLY
 * when live is OFF and a replay match exists — the parent resolves the match
 * and passes the entry; tapping it plays through the AudioController.
 */
import { IconPlay, SummaryText } from "@room/ui";
import type { ReplayEntry, ThreadItem } from "../api.js";

interface ThreadBubbleProps {
  item: ThreadItem;
  replay: ReplayEntry | null;
  onPlay: (entry: ReplayEntry) => void;
}

export function ThreadBubble({ item, replay, onPlay }: ThreadBubbleProps) {
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
      {replay ? (
        <button
          type="button"
          onClick={() => onPlay(replay)}
          className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 py-1 pl-2 pr-2.5 text-[12px] font-semibold text-accent transition-colors hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent [&_svg]:size-3.5"
        >
          <IconPlay /> Play
        </button>
      ) : null}
    </div>
  );
}
