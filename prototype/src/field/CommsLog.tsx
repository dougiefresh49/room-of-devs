import { useLayoutEffect, useMemo, useRef } from "react";

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
  onReadBack?: () => void;
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
  onReadBack,
}: CommsLogProps) {
  const logRef = useRef<HTMLDivElement>(null);
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

  useLayoutEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  });

  return (
    <div
      ref={logRef}
      className={`vt comms-log ${className}`.trim()}
      onWheel={onReadBack}
      onTouchMove={onReadBack}
    >
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
            {!block.you ? <div className="comms-who">{block.who.slice(0, 3)}</div> : null}
            {block.rows.map((row, rowIndex) => (
              <div
                className={`comms-say${block.you ? " you" : ""}`}
                key={`${row.who}-${row.at}-${rowIndex}`}
              >
                {row.text}
                {typing && blockIndex === blocks.length - 1 && rowIndex === block.rows.length - 1 ? (
                  <span className="cursor" role="status" aria-label="Reply pending" />
                ) : null}
              </div>
            ))}
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
