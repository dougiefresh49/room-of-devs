import { useEffect, useState } from "react";
import { AvatarFace } from "../avatars/AvatarFace";
import { useRoom } from "../mock/store";

export function FieldDock() {
  const room = useRoom();
  const [handoff, setHandoff] = useState(false);

  useEffect(() => {
    if (!handoff) return;
    const t = window.setTimeout(() => setHandoff(false), 2400);
    return () => window.clearTimeout(t);
  }, [handoff]);

  const hot = room.micHot;
  const pillClass = hot ? "pttpill hot" : handoff ? "pttpill handoff" : "pttpill";

  return (
    <div className="fdock">
      <div className="mface">
        <div className="face-crt">
          <AvatarFace
            persona={
              room.speakingPersona ?? (room.donnieCheckout ? "donnie" : "mikey")
            }
            mode={
              room.speakingPersona
                ? "speaking"
                : room.mood === "the-lull"
                  ? "stoked"
                  : "idle"
            }
            size={52}
          />
        </div>
      </div>
      <button
        type="button"
        className={pillClass}
        onPointerDown={() => {
          if (hot) return;
          setHandoff(true);
        }}
      >
        <span className="btn" />
        <span className="lbl">
          {hot ? (
            <>
              <b>MIC HOT — ROOM OPEN</b>
              <br />
              DESKTOP TRIGGER · NEVER ALWAYS-LISTENING
            </>
          ) : handoff ? (
            <>
              <b>VOICE LIVES AT THE RIG</b>
              <br />
              WALK TO THE RIG — OR TYPE IT · KEYCAPS + INJECT WORK FROM HERE
            </>
          ) : (
            <>
              <b>HOLD TO TALK</b>
              <br />
              MIC COLD · NEVER ALWAYS-LISTENING
            </>
          )}
        </span>
      </button>
    </div>
  );
}
