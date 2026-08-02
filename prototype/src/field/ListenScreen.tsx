import { useEffect, useRef } from "react";
import { ToggleGroup, ToggleGroupItem } from "@room/ui";
import { CutFrame, Led, Waveform } from "@room/ui/rig";
import { AvatarFace } from "../avatars/AvatarFace";
import { FieldCrtFace } from "../rig-ext/FieldCrtFace";
import { PartNo } from "../map/PartNo";
import { setAudioRoute } from "../mock/scenario";
import { useRoom } from "../mock/store";

/** House-style glyphs for the audio-route segments (no emoji). */
function PhoneGlyph() {
  return (
    <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden>
      <rect
        x="5.5"
        y="2"
        width="9"
        height="16"
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M8.6 4.4h2.8"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <circle cx="10" cy="15.4" r="0.9" fill="currentColor" />
    </svg>
  );
}

function MacGlyph() {
  return (
    <svg viewBox="0 0 20 20" width="17" height="17" aria-hidden>
      <rect
        x="3.2"
        y="4"
        width="13.6"
        height="9"
        rx="1.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M1.6 15.6h16.8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * LISTEN — the "who is talking, where does it come out" screen.
 *
 * Round 3 layout: a 1/3 · 2/3 head — left column stacks name, duty line,
 * the synth light bar and a compact phone|mac route toggle; the face owns
 * the right two thirds. The walk-plan line sits under both. That buys back
 * the vertical space the old square faceplate + text row + route strip ate.
 */
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
  const checkout = persona === "donnie" ? room.donnieCheckout : null;
  const watched = room.crafts.find((c) => c.watched);
  const rows = room.transcript.slice(-8);
  const threadRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [room.transcript.length]);

  return (
    <div className="screen-body">
      <PartNo partNo="F-03" />
      <div className="lhead">
        <CutFrame scale="s" className="lcol-wrap" innerClassName="lcol">
          <div className="lname">{persona === "donnie" ? "DONNIE" : "MIKEY"}</div>
          <div className="lsub">// {checkout ? "CHECKED OUT" : "ON VOICE"}</div>

          <div className="lwave">
            <Led
              tone={speaking ? "amber" : "dim"}
              pulse={speaking}
              pulseSpeed="hot"
              className="talklamp-led"
            />
            <Waveform active={speaking} bars={9} className="lwave-bars" />
          </div>

          <ToggleGroup
            type="single"
            value={phoneRoute ? "phone" : "mac"}
            onValueChange={(v) => {
              if (v === "phone" || v === "mac") setAudioRoute(v);
            }}
            className="devtog"
            aria-label="Audio route"
          >
            <ToggleGroupItem
              value="phone"
              className="dseg"
              aria-label="Play on this phone"
              title="AUDIO → THIS PHONE"
            >
              <PhoneGlyph />
            </ToggleGroupItem>
            <ToggleGroupItem
              value="mac"
              className="dseg"
              aria-label="Play on Mac speakers"
              title="AUDIO → MAC SPEAKERS"
            >
              <MacGlyph />
            </ToggleGroupItem>
          </ToggleGroup>

          <div className="lgate">
            {phoneRoute ? (
              <>
                GATE <b>HELD</b>
              </>
            ) : (
              <>GATE OPEN</>
            )}
          </div>
        </CutFrame>

        <CutFrame scale="s" className="lface-wrap" innerClassName="lface">
          <FieldCrtFace size={148} halo scanlines>
            <AvatarFace persona={persona} mode={faceMode} size={148} />
          </FieldCrtFace>
        </CutFrame>
      </div>

      <div className="lplan">
        <Led tone={speaking ? "amber" : "dim"} pulse={speaking} />
        {checkout ? (
          <span>
            <b>{checkout.purpose}</b> · {checkout.elapsed}
          </span>
        ) : (
          <span>
            CONCIERGE · <b>ROOM VOICE</b> · {room.audio.gateCountdown}
          </span>
        )}
      </div>

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
          <Led tone="amber" pulse className="watch-eye" />
          WATCH ORDER · {watched.ticket}
          {room.liveClip ? ` · ${room.liveClip}` : ""} · SAY &quot;STAND DOWN&quot; TO
          CANCEL
        </div>
      ) : null}
    </div>
  );
}
