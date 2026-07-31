import { AvatarFace } from "../avatars/AvatarFace";
import { useRoom } from "../mock/store";
import { PttPill } from "./PttPill";

export function FieldDock() {
  const room = useRoom();

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
      <PttPill />
    </div>
  );
}
