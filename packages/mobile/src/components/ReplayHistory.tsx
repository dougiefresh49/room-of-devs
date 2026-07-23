/**
 * Replay history (chunk D) — the legacy "Messages" list below the room grid.
 * Newest-first replay clips: avatar, agent/character label, preview text, time
 * ago, an unheard dot, and a "playing" highlight. Tapping a row plays it
 * through the AudioController. A header shows the unheard count (tap → play the
 * newest unheard) and a Clear action. Cleared/hidden filtering happens in App.
 *
 * Presentational: entries + resolvers in, callbacks out. Only the "playing"
 * highlight comes live from the controller (usePlayingFile — a primitive that
 * doesn't churn on the karaoke tick).
 */
import type { AgentView } from "@room/protocol";
import type { ReplayEntry } from "../api.js";
import { usePlayingFile } from "../audio/react.js";
import { Avatar } from "./Avatar.js";

interface ReplayHistoryProps {
  entries: ReplayEntry[];
  agents: AgentView[];
  listened: ReadonlySet<string>;
  unheardCount: number;
  onPlay: (entry: ReplayEntry) => void;
  onClear: () => void;
  onPlayNewestUnheard: () => void;
}

export function ReplayHistory({
  entries,
  agents,
  listened,
  unheardCount,
  onPlay,
  onClear,
  onPlayNewestUnheard,
}: ReplayHistoryProps) {
  const playingFile = usePlayingFile();

  return (
    <section className="mt-6">
      <div className="mb-2 flex items-center gap-2 px-1">
        <h2 className="mr-auto text-sm font-semibold text-fg-muted">Messages</h2>
        {unheardCount > 0 ? (
          <button
            type="button"
            onClick={onPlayNewestUnheard}
            className="rounded-full bg-accent/15 px-2.5 py-1 text-xs font-semibold text-accent transition-colors hover:bg-accent/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {unheardCount} new
          </button>
        ) : null}
        {entries.length > 0 ? (
          <button
            type="button"
            onClick={onClear}
            className="rounded-lg border border-line-strong px-2.5 py-1 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Clear
          </button>
        ) : null}
      </div>

      {entries.length === 0 ? (
        <p className="px-1 py-6 text-center text-sm text-fg-muted">No messages yet</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {entries.map((entry) => {
            const heard = listened.has(entry.file) || entry.kind === "ack";
            const playing = entry.file === playingFile;
            const agent = entry.sessionId
              ? agents.find((a) => a.sessionId === entry.sessionId)
              : undefined;
            const name = entryName(entry, agent);
            const avatarAgent = agent ?? { character: entry.character ?? null, name };
            return (
              <li key={entry.file}>
                <button
                  type="button"
                  onClick={() => onPlay(entry)}
                  className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    playing
                      ? "border-accent/60 bg-accent/10"
                      : "border-line bg-surface hover:bg-surface-hover"
                  }`}
                >
                  <Avatar
                    agent={avatarAgent}
                    frame="idle"
                    className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-lg bg-surface-strong text-xs font-semibold text-fg-muted"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="truncate text-[13px] font-semibold">{name}</span>
                      <span className="ml-auto shrink-0 text-[11px] text-fg-faint">
                        {timeAgo(entry.timestamp)}
                      </span>
                    </div>
                    <div className="truncate text-xs text-fg-muted">{preview(entry)}</div>
                  </div>
                  {!heard ? (
                    <span
                      className="size-2 shrink-0 rounded-full bg-accent"
                      aria-label="unheard"
                    />
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function entryName(entry: ReplayEntry, agent: AgentView | undefined): string {
  if (agent) return agent.label || agent.name;
  if (entry.sessionName) return entry.sessionName;
  if (entry.sessionId) return entry.sessionId.slice(0, 8);
  return entry.character || "Unknown";
}

function preview(entry: ReplayEntry): string {
  const t = entry.textPreview || entry.spokenText || "";
  return t.length > 90 ? `${t.slice(0, 90)}…` : t;
}

function timeAgo(ts: string | undefined): string {
  if (!ts) return "";
  const t = Date.parse(ts);
  if (!Number.isFinite(t)) return "";
  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}
