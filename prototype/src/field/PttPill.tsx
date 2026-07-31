import { useEffect, useState } from "react";
import { useRoom } from "../mock/store";

/**
 * The one hold-to-talk pill. There is no phone mic in this concept — pressing
 * it flashes the handoff state ("type it instead") and nothing else.
 * `compact` = the smaller inline variant used next to the chat key.
 * `icon` = the square mic key used on LISTEN, where the transport keys already
 * eat most of the row.
 */
export function PttPill({
  compact = false,
  icon = false,
  style,
}: {
  compact?: boolean;
  icon?: boolean;
  style?: React.CSSProperties;
}) {
  const room = useRoom();
  const [handoff, setHandoff] = useState(false);

  useEffect(() => {
    if (!handoff) return;
    const t = window.setTimeout(() => setHandoff(false), 2400);
    return () => window.clearTimeout(t);
  }, [handoff]);

  const hot = room.micHot;
  const cls = [
    "pttpill",
    hot ? "hot" : handoff ? "handoff" : "",
    compact ? "compact" : "",
    icon ? "iconpill" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const onDown = () => {
    if (hot) return;
    setHandoff(true);
  };

  if (icon) {
    return (
      <button
        type="button"
        className={cls}
        style={style}
        aria-label="Hold to talk"
        title={
          hot
            ? "MIC HOT"
            : handoff
              ? "NO MIC OUT HERE — TYPE IT INSTEAD"
              : "HOLD TO TALK"
        }
        onPointerDown={onDown}
      >
        <svg viewBox="0 0 20 20" width="19" height="19" aria-hidden>
          <rect
            x="7"
            y="2.5"
            width="6"
            height="9.5"
            rx="3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
          />
          <path
            d="M4.6 9.5a5.4 5.4 0 0 0 10.8 0M10 15v2.6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
        </svg>
      </button>
    );
  }

  return (
    <button type="button" className={cls} style={style} onPointerDown={onDown}>
      <span className="btn" />
      <span className="lbl">
        {hot ? (
          <b>MIC HOT</b>
        ) : handoff ? (
          <b>NO MIC OUT HERE — TYPE IT INSTEAD</b>
        ) : (
          <b>HOLD TO TALK</b>
        )}
      </span>
    </button>
  );
}
