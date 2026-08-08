import { CrtFace, Tag } from "@room/ui/rig";
import { AvatarFace } from "../avatars/AvatarFace";
import { PartNo } from "../map/PartNo";
import { replayLastMikey, setAudioRoute, stopPlayback } from "../mock/scenario";
import { useRoom } from "../mock/store";
import { NowPlaying } from "../rig-ext/NowPlaying";

export function Faceplate() {
  const room = useRoom();
  const voice = room.crew.find((member) => member.id === room.voicePersona);
  const voiceCallsign = voice?.callsign ?? room.voicePersona.toUpperCase();
  const voiceSpeaking = room.speakingPersona === room.voicePersona;
  const stoked = room.mood === "the-lull";
  const mode = stoked ? "stoked" : voiceSpeaking ? "speaking" : "idle";

  return (
    <div className="faceplate">
      <PartNo partNo="S-01" />
      <div className="fp-label">
        <span>CREW CHIEF</span>
        <Tag tone="dim">DIAL 2 · {voiceCallsign}</Tag>
      </div>
      <div className="screenbed fp-screen">
        <div className="facewrap">
          <CrtFace size={176} halo scanlines>
            <AvatarFace persona={room.voicePersona} mode={mode} size={176} />
          </CrtFace>
        </div>
        <div className="fp-meta">
          <span className="who">{voiceCallsign}</span>
          <span className="role">ALWAYS ON // STATELESS</span>
        </div>
        <div className="fp-wavebar">
          <span
            className="talklamp"
            style={
              voiceSpeaking
                ? undefined
                : { background: "#3a3f45", boxShadow: "none", animation: "none" }
            }
          />
          <NowPlaying
            variant="faceplate"
            nowPlaying={room.nowPlaying}
            route={room.audio.route}
            gateStartedAt={room.audio.gateStartedAt}
            onStop={stopPlayback}
            onReplay={replayLastMikey}
            onRoute={setAudioRoute}
          />
        </div>
      </div>
    </div>
  );
}

export function DonnieBay() {
  const room = useRoom();
  const checkoutIsVisible = Boolean(room.donnieCheckout) && room.voicePersona !== "donnie";
  const standby = room.crew.find(
    (member) => member.id !== room.voicePersona && !member.piloting,
  );
  const bayPersona = checkoutIsVisible ? "donnie" : (standby?.id ?? "mikey");
  const bayCallsign =
    room.crew.find((member) => member.id === bayPersona)?.callsign ?? bayPersona.toUpperCase();
  const speaking = room.speakingPersona === bayPersona;
  return (
    <div className="chassis donbay">
      <PartNo partNo="S-02" />
      <div className="screenbed" style={{ padding: 6 }}>
        <div className="facewrap">
          <CrtFace size={58} scanlines>
            <AvatarFace persona={bayPersona} mode={speaking ? "speaking" : "idle"} size={58} />
          </CrtFace>
        </div>
      </div>
      <div className="info">
        SECOND VOICE BAY
        <br />
        <b>
          {bayCallsign} — {checkoutIsVisible ? "CHECKED OUT" : "ON THE RACK · STANDBY"}
        </b>
        {checkoutIsVisible && room.donnieCheckout ? (
          <>
            <br />
            PURPOSE: {room.donnieCheckout.purpose}
            <br />
            ELAPSED {room.donnieCheckout.elapsed} · RETURNS ON “THANKS DONNIE”
          </>
        ) : (
          <>
            <br />
            AVAILABLE FOR SECOND-VOICE CHECKOUT
          </>
        )}
      </div>
    </div>
  );
}
