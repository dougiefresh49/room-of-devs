import { useLayoutEffect, useMemo, useRef } from "react";

export interface CommsRow {
  who: string;
  text: string;
  you?: boolean;
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
  who: string;
  you: boolean;
  rows: CommsRow[];
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
  const groups = useMemo(
    () =>
      rows.reduce<CommsGroup[]>((all, row) => {
        const you = row.you === true || row.who === "YOU";
        const previous = all[all.length - 1];
        if (previous?.who === row.who && previous.you === you) {
          previous.rows.push(row);
        } else {
          all.push({ who: row.who, you, rows: [row] });
        }
        return all;
      }, []),
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
      {groups.map((group, groupIndex) => (
        <div
          className={`comms-group${group.you ? " is-you" : ""}`}
          key={`${group.who}-${group.you ? "you" : "other"}-${groupIndex}`}
        >
          {!group.you ? <div className="comms-who">{group.who.slice(0, 3)}</div> : null}
          {group.rows.map((row, rowIndex) => (
            <div
              className={`comms-say${group.you ? " you" : ""}`}
              key={`${row.who}-${row.you === true ? "you" : "other"}-${groupIndex}-${rowIndex}`}
            >
              {row.text}
              {typing && groupIndex === groups.length - 1 && rowIndex === group.rows.length - 1 ? (
                <span className="cursor" role="status" aria-label="Reply pending" />
              ) : null}
            </div>
          ))}
        </div>
      ))}

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
