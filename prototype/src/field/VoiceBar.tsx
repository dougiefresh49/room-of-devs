import { ToggleGroup, ToggleGroupItem } from "@room/ui";
import { CutFrame, Led, Waveform } from "@room/ui/rig";
import { AvatarFace } from "../avatars/AvatarFace";
import { setAudioRoute } from "../mock/scenario";
import { useRoom } from "../mock/store";
import { FieldCrtFace } from "../rig-ext/FieldCrtFace";

function PhoneGlyph() {
  return (
    <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden>
      <rect x="5.5" y="2" width="9" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8.6 4.4h2.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="10" cy="15.4" r="0.9" fill="currentColor" />
    </svg>
  );
}

function MacGlyph() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden>
      <rect x="3.2" y="4" width="13.6" height="9" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M1.6 15.6h16.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function VoiceBar({ large }: { large: boolean }) {
  const room = useRoom();
  const speaking = room.speakingPersona != null;
  const persona = room.speakingPersona ?? (room.donnieCheckout ? "donnie" : "mikey");
  const checkout = persona === "donnie" ? room.donnieCheckout : null;
  const faceMode = speaking ? "speaking" : room.mood === "the-lull" ? "stoked" : "idle";
  const phoneRoute = room.audio.route === "phone";

  return (
    <CutFrame
      scale={large ? "m" : "s"}
      className={`coms-voicebar-wrap${large ? " is-large" : ""}`}
      innerClassName="coms-voicebar"
    >
      <div className="coms-face">
        <FieldCrtFace size={large ? 148 : 44} halo={large} scanlines>
          <AvatarFace persona={persona} mode={faceMode} size={large ? 148 : 44} />
        </FieldCrtFace>
      </div>
      <div className="coms-voice-main">
        <div className="coms-name">
          <b>{persona === "donnie" ? "DONNIE" : "MIKEY"}</b>
          <span>// {checkout ? "CHECKED OUT" : "ON VOICE"}</span>
        </div>
        <div className="coms-wave">
          <Led tone={speaking ? "amber" : "dim"} pulse={speaking} pulseSpeed="hot" />
          <Waveform active={speaking} bars={9} />
        </div>
        <div className="coms-duty">
          {checkout ? `${checkout.purpose} · ${checkout.elapsed}` : "CREW CHIEF · ROOM VOICE"}
        </div>
      </div>
      <div className="coms-route">
        <ToggleGroup
          type="single"
          value={phoneRoute ? "phone" : "mac"}
          onValueChange={(value) => {
            if (value === "phone" || value === "mac") setAudioRoute(value);
          }}
          className="devtog"
          aria-label="Audio route"
        >
          <ToggleGroupItem value="phone" className="dseg" aria-label="Play on this phone">
            <PhoneGlyph />
          </ToggleGroupItem>
          <ToggleGroupItem value="mac" className="dseg" aria-label="Play on Mac speakers">
            <MacGlyph />
          </ToggleGroupItem>
        </ToggleGroup>
        <span className={phoneRoute ? "is-held" : undefined}>
          {phoneRoute ? "GATE HELD" : "GATE OPEN"}
        </span>
      </div>
    </CutFrame>
  );
}
