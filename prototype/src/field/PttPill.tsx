import { Mic } from "lucide-react";
import { useEffect, useState } from "react";
import { useRoom } from "../mock/store";

function PillLabel({ label }: { label: string }) {
  const ticketAt = label.lastIndexOf(" · T-");
  if (ticketAt < 0) return <>{label}</>;
  return (
    <>
      <span className="pttpill-main">{label.slice(0, ticketAt)}</span>
      <span className="pttpill-ticket">{label.slice(ticketAt)}</span>
    </>
  );
}

/**
 * The FIELD hold-to-talk control. There is no phone mic: pressing it only
 * flashes the handoff caption and never starts recording or synthesis.
 */
export function PttPill({
  compact = false,
  icon = false,
  segment = false,
  big = false,
  label = "TALK TO MIKEY",
  style,
}: {
  compact?: boolean;
  icon?: boolean;
  segment?: boolean;
  big?: boolean;
  label?: string;
  style?: React.CSSProperties;
}) {
  const room = useRoom();
  const [handoff, setHandoff] = useState(false);

  useEffect(() => {
    if (!handoff) return;
    const timer = window.setTimeout(() => setHandoff(false), 2400);
    return () => window.clearTimeout(timer);
  }, [handoff]);

  const hot = room.micHot;
  const showHandoff = handoff && !hot;
  useEffect(() => {
    if (hot) setHandoff(false);
  }, [hot]);
  const cls = [
    "pttpill",
    hot ? "hot" : showHandoff ? "handoff" : "",
    compact ? "compact" : "",
    icon ? "iconpill" : "",
    segment ? "segment" : "",
    big ? "big" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const onDown = () => {
    if (hot) return;
    setHandoff(true);
  };

  if (big) {
    return (
      <div className="pttpill-bigwrap">
        <button
          type="button"
          className={cls}
          style={style}
          aria-label="Hold to talk"
          title={showHandoff ? "NO MIC OUT HERE — TYPE IT INSTEAD" : hot ? "MIC HOT" : "HOLD TO TALK"}
          onPointerDown={onDown}
        >
          <Mic size={28} aria-hidden />
        </button>
        {showHandoff ? (
          <span className="pttpill-handoff" role="status">
            NO MIC OUT HERE — TYPE IT INSTEAD
          </span>
        ) : null}
      </div>
    );
  }

  if (icon) {
    return (
      <button
        type="button"
        className={cls}
        style={style}
        aria-label="Hold to talk"
        title={showHandoff ? "NO MIC OUT HERE — TYPE IT INSTEAD" : hot ? "MIC HOT" : "HOLD TO TALK"}
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
        ) : showHandoff ? (
          <b>NO MIC OUT HERE — TYPE IT INSTEAD</b>
        ) : (
          <b><PillLabel label={label} /></b>
        )}
      </span>
    </button>
  );
}
