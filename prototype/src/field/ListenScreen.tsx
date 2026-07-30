import { useEffect, useState } from "react";
import { AvatarFace } from "../avatars/AvatarFace";
import {
  replayLastMikey,
  stopPlayback,
  toggleAudioRoute,
} from "../mock/scenario";
import { useRoom } from "../mock/store";

function DuckPtt() {
  const room = useRoom();
  const [handoff, setHandoff] = useState(false);
  useEffect(() => {
    if (!handoff) return;
    const t = window.setTimeout(() => setHandoff(false), 2400);
    return () => window.clearTimeout(t);
  }, [handoff]);
  const hot = room.micHot;
  const cls = hot ? "pttpill hot" : handoff ? "pttpill handoff" : "pttpill";
  return (
    <button
      type="button"
      className={cls}
      style={{ flex: 1 }}
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
            DESKTOP TRIGGER
          </>
        ) : handoff ? (
          <>
            <b>VOICE LIVES AT THE RIG</b>
            <br />
            WALK TO THE RIG — OR TYPE IT
          </>
        ) : (
          <>
            <b>HOLD = DUCK + TALK BACK</b>
            <br />
            V1: STOP + SPEAK AFTER · FREE
          </>
        )}
      </span>
    </button>
  );
}

export function ListenScreen() {
  const room = useRoom();
  const speaking = room.speakingPersona != null;
  const persona = room.donnieCheckout
    ? "donnie"
    : (room.speakingPersona ?? "mikey");
  const faceMode = speaking
    ? "speaking"
    : room.mood === "the-lull"
      ? "stoked"
      : "idle";
  const phoneRoute = room.audio.route === "phone";
  const watched = room.crafts.find((c) => c.watched);
  const rows = room.transcript.slice(-3);

  return (
    <div className="screen-body">
      <div className="ffaceplate">
        <div className="facewrap">
          <div className="face-crt">
            <AvatarFace persona={persona} mode={faceMode} size={158} />
          </div>
        </div>
      </div>
      <div className="fwho">
        <span className="who">{persona === "donnie" ? "DONNIE" : "MIKEY"}</span>
        <span className="role">
          {room.donnieCheckout
            ? `CHECKED OUT · ${room.donnieCheckout.purpose} · ${room.donnieCheckout.elapsed}`
            : "CONCIERGE · ON VOICE"}
        </span>
      </div>

      <div className="fwavebar">
        <span
          className="talklamp"
          style={speaking ? undefined : { opacity: 0.25, animation: "none" }}
        />
        <div className={`wave${speaking ? "" : " flat"}`} aria-hidden>
          {Array.from({ length: 12 }, (_, i) => (
            <i key={i} />
          ))}
        </div>
      </div>

      <button
        type="button"
        className={`routechip${phoneRoute ? "" : " dim"}`}
        onClick={() => toggleAudioRoute()}
      >
        <span className={`led${phoneRoute ? " on" : ""}`} />
        {phoneRoute ? (
          <>
            AUDIO → <b>THIS PHONE</b> · SPEAKER GATE HELD · MAC SPEAKERS COLD
          </>
        ) : (
          <>AUDIO → MAC SPEAKERS · THIS PHONE COLD</>
        )}
      </button>

      <div
        className="vt"
        style={{
          marginTop: 10,
          padding: 10,
          border: "1px solid rgba(255,179,71,.18)",
          borderRadius: 6,
          background: "rgba(0,0,0,.35)",
        }}
      >
        {rows.map((r, i) => (
          <div className="row" key={`${r.who}-${i}-${r.text.slice(0, 12)}`}>
            <span className="who">{r.who === "YOU" ? "YOU" : r.who.slice(0, 3)}</span>
            <span className={`say${r.you ? " you" : ""}`}>{r.text}</span>
          </div>
        ))}
        {room.queuedForLull.length > 0 ? (
          <div className="row">
            <span className="who" />
            <span className="say" style={{ color: "var(--amber-dim)", opacity: 0.75 }}>
              QUEUED FOR THE LULL: {room.queuedForLull.join(" · ")}
            </span>
          </div>
        ) : null}
      </div>

      {watched ? (
        <div className="watchchip">
          <span className="eye" />
          WATCH ORDER · {watched.ticket}
          {room.liveClip ? ` · ${room.liveClip}` : ""} · SAY &quot;STAND DOWN&quot; TO
          CANCEL
        </div>
      ) : null}

      <div className="introw" style={{ marginTop: "auto" }}>
        <button type="button" className="stopkey" onClick={() => stopPlayback()}>
          <span className="sq" />
          <span className="sl">STOP</span>
        </button>
        <DuckPtt />
      </div>

      <button
        type="button"
        className="routechip dim"
        style={{ marginTop: 8 }}
        onClick={() => replayLastMikey()}
      >
        REPLAY LAST · FREE — SAVED MP3, NO SYNTHESIS
      </button>
    </div>
  );
}
