import { CrtFace } from "@room/ui/rig";
import { AvatarFace } from "../avatars/AvatarFace";
import { PartNo } from "../map/PartNo";
import { useRoom } from "../mock/store";

export function CrewManifest() {
  const { crew, speakingPersona } = useRoom();
  return (
    <div className="crew">
      <PartNo partNo="S-12" />
      {crew.map((m) => (
        <div key={m.id} className={`crewplate chassis${m.piloting ? "" : " off"}`}>
          <div className="cscr screenbed">
            <div className="facewrap">
              <CrtFace size={104} scanlines>
                <AvatarFace
                  persona={m.id}
                  mode={speakingPersona === m.id ? "speaking" : "idle"}
                  size={104}
                />
              </CrtFace>
            </div>
            <div className="cname">{m.callsign}</div>
            <div className="crole">{m.role}</div>
            <div className="cstat">
              <span
                className={`led${m.piloting ? " on" : ""}`}
                style={m.piloting ? undefined : { background: "#3a3f45" }}
              />
              {m.piloting ? "IN FLIGHT" : "ON RACK"}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
