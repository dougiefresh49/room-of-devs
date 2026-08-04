import { useEffect, useState } from "react";
import { Mic } from "lucide-react";
import { useRoom } from "../mock/store";

/**
 * The one hold-to-talk pill. There is no phone mic in this concept — pressing
 * it flashes the handoff state ("type it instead") and nothing else.
 * `compact` = the smaller inline variant used next to the chat key.
 * `icon` = the square mic key used where transport keys already eat most of
 * the row.
 */
export function PttPill({
  compact = false,
  icon = false,
  segment = false,
  short = false,
  subLabel,
  style,
}: {
  compact?: boolean;
  icon?: boolean;
  segment?: boolean;
  short?: boolean;
  subLabel?: string;
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
    segment ? "segment" : "",
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
        title={hot ? "MIC HOT" : handoff ? "NO MIC OUT HERE — TYPE IT INSTEAD" : "HOLD TO TALK"}
        onPointerDown={onDown}
      >
        <Mic size={15} aria-hidden />
      </button>
    );
  }

  return (
    <button type="button" className={cls} style={style} onPointerDown={onDown}>
      <span className="btn">
        <Mic size={15} aria-hidden />
      </span>
      <span className="lbl">
        {hot ? (
          <b>MIC HOT</b>
        ) : handoff ? (
          <b>NO MIC OUT HERE — TYPE IT INSTEAD</b>
        ) : (
          <>
            <b>{short ? "TALK" : "HOLD TO TALK"}</b>
            {subLabel ? <small>{subLabel}</small> : null}
          </>
        )}
      </span>
    </button>
  );
}
