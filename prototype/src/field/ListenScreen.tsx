import { useEffect, useRef } from "react";
import { AvatarFace } from "../avatars/AvatarFace";
import {
  replayLastMikey,
  stopPlayback,
  toggleAudioRoute,
} from "../mock/scenario";
import { useRoom } from "../mock/store";
import { PttPill } from "./PttPill";

export function ListenScreen() {
  const room = useRoom();
  const speaking = room.speakingPersona != null;
  // Whoever is actually speaking owns the face; the checkout swap only
  // applies while idle (Donnie speaking sets speakingPersona anyway).
  const persona =
    room.speakingPersona ?? (room.donnieCheckout ? "donnie" : "mikey");
  const faceMode = speaking
    ? "speaking"
    : room.mood === "the-lull"
      ? "stoked"
      : "idle";
  const phoneRoute = room.audio.route === "phone";
  const watched = room.crafts.find((c) => c.watched);
  const rows = room.transcript.slice(-8);
  const threadRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [room.transcript.length]);

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
          {persona === "donnie" && room.donnieCheckout
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
        className={`routechip routeswitch${phoneRoute ? "" : " dim"}`}
        role="switch"
        aria-checked={phoneRoute}
        aria-label="Audio route"
        onClick={() => toggleAudioRoute()}
      >
        <span className={`led${phoneRoute ? " on" : ""}`} />
        <span className="rlabel">
          AUDIO → <b>{phoneRoute ? "THIS PHONE" : "MAC SPEAKERS"}</b>
        </span>
        <span className="spacer" />
        <span className="gatewd">{phoneRoute ? "GATE HELD" : "GATE OPEN"}</span>
        <span className={`rswitch${phoneRoute ? " on" : ""}`} aria-hidden>
          <i />
        </span>
      </button>

      <div className="vt field-thread" ref={threadRef}>
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

      <div className="introw">
        <button
          type="button"
          className="stopkey"
          aria-label="Stop playback"
          title="STOP"
          onClick={() => stopPlayback()}
        >
          <span className="sq" />
        </button>
        <button
          type="button"
          className="replaykey"
          aria-label="Replay last clip (free)"
          title="REPLAY LAST · FREE"
          onClick={() => replayLastMikey()}
        >
          <svg
            viewBox="0 0 20 20"
            width="20"
            height="20"
            aria-hidden
            style={{ transform: "scaleX(-1)" }}
          >
            <path
              d="M14.5 6.5 A6 6 0 1 0 16 10"
              stroke="var(--amber)"
              strokeWidth="2"
              fill="none"
              strokeLinecap="round"
            />
            <path d="M14.8 2.6 L14.8 7.2 L10.2 7.2 Z" fill="var(--amber)" />
          </svg>
        </button>
        <PttPill style={{ flex: 1 }} />
      </div>
    </div>
  );
}
