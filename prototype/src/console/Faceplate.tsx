import { CrtFace, Tag, Waveform } from "@room/ui/rig";
import { AvatarFace } from "../avatars/AvatarFace";
import { PartNo } from "../map/PartNo";
import { useRoom } from "../mock/store";

export function Faceplate() {
  const room = useRoom();
  const mikeySpeaking = room.speakingPersona === "mikey";
  const stoked = room.mood === "the-lull";
  const mode = stoked ? "stoked" : mikeySpeaking ? "speaking" : "idle";

  return (
    <div className="faceplate">
      <PartNo partNo="S-01" />
      <div className="fp-label">
        <span>CREW CHIEF</span>
        <Tag tone="dim">DIAL 2 · VOICE</Tag>
      </div>
      <div className="screenbed fp-screen">
        <div className="facewrap">
          <CrtFace size={176} halo scanlines>
            <AvatarFace persona="mikey" mode={mode} size={176} />
          </CrtFace>
        </div>
        <div className="fp-meta">
          <span className="who">MIKEY</span>
          <span className="role">ALWAYS ON // STATELESS</span>
        </div>
        <div className="fp-wavebar">
          <span
            className="talklamp"
            style={
              mikeySpeaking
                ? undefined
                : { background: "#3a3f45", boxShadow: "none", animation: "none" }
            }
          />
          <Waveform active={mikeySpeaking} />
          <span className="dotmx" style={{ marginLeft: "auto" }}>
            {mikeySpeaking ? "SPEAKING" : stoked ? "STOKED" : "IDLE"}
          </span>
        </div>
      </div>
    </div>
  );
}

export function DonnieBay() {
  const room = useRoom();
  if (!room.donnieCheckout) return null;
  const speaking = room.speakingPersona === "donnie";
  return (
    <div className="chassis donbay">
      <PartNo partNo="S-02" />
      <div className="screenbed" style={{ padding: 6 }}>
        <div className="facewrap">
          <CrtFace size={58} scanlines>
            <AvatarFace persona="donnie" mode={speaking ? "speaking" : "idle"} size={58} />
          </CrtFace>
        </div>
      </div>
      <div className="info">
        SECOND VOICE BAY
        <br />
        <b>DONNIE — CHECKED OUT</b>
        <br />
        PURPOSE: {room.donnieCheckout.purpose}
        <br />
        ELAPSED {room.donnieCheckout.elapsed} · RETURNS ON “THANKS DONNIE”
      </div>
    </div>
  );
}
