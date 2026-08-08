import { Waveform } from "@room/ui/rig";
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { NowPlaying } from "../mock/types";
import { formatElapsed } from "../rig-ext/NowPlaying";

export interface CommsRow {
  who: string;
  text: string;
  you?: boolean;
  at: number;
}

export interface CommsTailLine {
  kind: "cmd" | "out";
  text: string;
}

interface CommsLogProps {
  rows: CommsRow[];
  tail?: CommsTailLine[];
  footNote?: string;
  className?: string;
  typing?: boolean;
  nowPlaying?: NowPlaying | null;
  onOpenFloor?: () => void;
  onAirAliases?: string[];
  stickyHeader?: ReactNode;
}

interface CommsGroup {
  kind: "group";
  who: string;
  you: boolean;
  rows: CommsRow[];
}

interface CommsDivider {
  kind: "divider";
  at: number;
  firstForDay: boolean;
}

type CommsBlock = CommsGroup | CommsDivider;

const DIVIDER_GAP_MS = 30 * 60_000;

function dayKey(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatDivider(at: number, firstForDay: boolean): string {
  const date = new Date(at);
  const time = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
  if (!firstForDay) return time;
  const today = new Date();
  const day = sameDay(date, today)
    ? "TODAY"
    : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" })
        .format(date)
        .toUpperCase();
  return `${day} · ${time}`;
}

export function CommsLog({
  rows,
  tail = [],
  footNote,
  className = "field-thread",
  typing = false,
  nowPlaying = null,
  onOpenFloor,
  onAirAliases = [],
  stickyHeader,
}: CommsLogProps) {
  const logRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [now, setNow] = useState(() => Date.now());
  const blocks = useMemo(
    () => {
      const seenDays = new Set<string>();
      return rows.reduce<CommsBlock[]>((all, row, index) => {
        const previousRow = rows[index - 1];
        const key = dayKey(row.at);
        if (
          !previousRow ||
          dayKey(previousRow.at) !== key ||
          row.at - previousRow.at > DIVIDER_GAP_MS
        ) {
          const firstForDay = !seenDays.has(key);
          all.push({ kind: "divider", at: row.at, firstForDay });
          seenDays.add(key);
        }
        const you = row.you === true || row.who === "YOU";
        const previous = all[all.length - 1];
        if (previous?.kind === "group" && previous.who === row.who && previous.you === you) {
          previous.rows.push(row);
        } else {
          all.push({ kind: "group", who: row.who, you, rows: [row] });
        }
        return all;
      }, []);
    },
    [rows],
  );
  const onAirKey = nowPlaying
    ? [...rows]
        .reverse()
        .find((row) => onAirAliases.includes(row.who.toLowerCase()))
    : null;
  const lastRow = rows.at(-1);
  const rowAppendKey = `${rows.length}:${lastRow?.who ?? ""}:${lastRow?.text ?? ""}`;

  useLayoutEffect(() => {
    if (!nowPlaying) return;
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [nowPlaying]);

  useLayoutEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [rowAppendKey]);

  return (
    <div
      ref={logRef}
      className={`vt comms-log ${className}`.trim()}
    >
      {stickyHeader}
      {blocks.map((block, blockIndex) =>
        block.kind === "divider" ? (
          <div className="comms-divider" key={`divider-${block.at}-${blockIndex}`}>
            <span aria-hidden />
            <time dateTime={new Date(block.at).toISOString()}>
              {formatDivider(block.at, block.firstForDay)}
            </time>
            <span aria-hidden />
          </div>
        ) : (
          <div
            className={`comms-group${block.you ? " is-you" : ""}`}
            key={`${block.who}-${block.you ? "you" : "other"}-${blockIndex}`}
          >
            {!block.you ? (
              <div className="comms-who">
                {block.who.slice(0, 3)}
                {nowPlaying && onAirKey && block.rows.includes(onAirKey) ? (
                  <button type="button" onClick={onOpenFloor} aria-label="Open audio floor">
                    <Waveform active bars={4} />
                    <span className="sseg">{formatElapsed(nowPlaying.startedAt, now)}</span>
                  </button>
                ) : null}
              </div>
            ) : null}
            {block.rows.map((row, rowIndex) => {
              const key = `${row.who}-${row.at}`;
              const long = row.text.length > 420;
              const isExpanded = expanded.has(key);
              const onAir = row === onAirKey;
              return (
              <div
                className={`comms-say${block.you ? " you" : ""}${onAir ? " is-onair" : ""}`}
                key={`${key}-${rowIndex}`}
              >
                <span className={`comms-text${long && !isExpanded ? " is-clamped" : ""}`}>{row.text}</span>
                {typing && blockIndex === blocks.length - 1 && rowIndex === block.rows.length - 1 ? (
                  <span className="cursor" role="status" aria-label="Reply pending" />
                ) : null}
                {long ? (
                  <button
                    type="button"
                    className="comms-read-full"
                    onClick={() => {
                      setExpanded((current) => {
                        const next = new Set(current);
                        if (next.has(key)) next.delete(key);
                        else next.add(key);
                        return next;
                      });
                    }}
                  >
                    {isExpanded ? "COLLAPSE ▴" : "READ FULL ▸"}
                  </button>
                ) : null}
              </div>
              );
            })}
          </div>
        ),
      )}

      {tail.length > 0 ? (
        <div className="comms-group comms-tail">
          {tail.map((line, index) => (
            <div className="comms-say" key={`${line.kind}-${line.text}-${index}`}>
              <span aria-hidden>{line.kind === "cmd" ? "▸" : "·"}</span>
              {line.text}
            </div>
          ))}
        </div>
      ) : null}

      {footNote ? (
        <div className="comms-group comms-footnote">
          <div className="comms-say">{footNote}</div>
        </div>
      ) : null}
    </div>
  );
}
