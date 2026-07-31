import { useEffect, useState } from "react";
import { useRoom } from "../mock/store";

/**
 * The one hold-to-talk pill. There is no phone mic in this concept — pressing
 * it flashes the handoff state ("type it instead") and nothing else.
 * `compact` = the smaller inline variant used next to the chat key.
 */
export function PttPill({
  compact = false,
  style,
}: {
  compact?: boolean;
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
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      className={cls}
      style={style}
      onPointerDown={() => {
        if (hot) return;
        setHandoff(true);
      }}
    >
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
