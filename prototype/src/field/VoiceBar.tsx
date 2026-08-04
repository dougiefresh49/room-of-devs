import { CutFrame, Led, Waveform } from "@room/ui/rig";
import { AvatarFace } from "../avatars/AvatarFace";
import { useRoom } from "../mock/store";
import { FieldCrtFace } from "../rig-ext/FieldCrtFace";

export function VoiceBar({ large }: { large: boolean }) {
  const room = useRoom();
  const speaking = room.speakingPersona != null;
  const persona = room.speakingPersona ?? (room.donnieCheckout ? "donnie" : "mikey");
  const checkout = persona === "donnie" ? room.donnieCheckout : null;
  const faceMode = speaking ? "speaking" : room.mood === "the-lull" ? "stoked" : "idle";

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
    </CutFrame>
  );
}
