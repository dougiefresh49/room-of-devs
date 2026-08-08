import { Waveform } from "@room/ui/rig";
import { AvatarFace } from "../avatars/AvatarFace";
import { useRoom } from "../mock/store";
import { FieldCrtFace } from "../rig-ext/FieldCrtFace";

export function ComsHeader() {
  const room = useRoom();
  const speaking = room.speakingPersona != null;
  const persona = room.speakingPersona ?? (room.donnieCheckout ? "donnie" : "mikey");
  const checkedOut = persona === "donnie" && room.donnieCheckout != null;
  const callsign = room.crew.find((member) => member.id === persona)?.callsign ?? persona.toUpperCase();

  return (
    <div className="coms-header">
      <FieldCrtFace size={28} scanlines>
        <AvatarFace persona={persona} mode={speaking ? "speaking" : "idle"} size={28} />
      </FieldCrtFace>
      <div className="coms-header-copy">
        <b>{callsign}</b>
        <span>// {checkedOut ? "CHECKED OUT" : "ON VOICE"}</span>
      </div>
      <Waveform active={speaking} bars={9} />
    </div>
  );
}
