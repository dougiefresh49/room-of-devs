import { Chassis, Tag } from "@room/ui/rig";
import type { CommissionDraft } from "../../mock/types";

export function VoicePath({ draft }: { draft: CommissionDraft }) {
  const voice = draft.source === "voice";
  return (
    <Chassis className="commission-voice-path" glow="0 10px 22px rgba(0,0,0,.42)">
      <header>
        <span>VOICE-FIRST PATH</span>
        <Tag tone={voice ? "hot" : "dim"}>{voice ? "PREFILLED BY MIKEY" : "SAME FORM"}</Tag>
      </header>
      <div className="commission-voice-line is-you">
        <b>YOU</b>
        <span>“Mikey, spin up a room for the story engine.”</span>
      </div>
      <div className="commission-voice-line">
        <b>MIKEY</b>
        <span>
          “Berth {draft.berth ?? "scratch"}. It has a repo and it’ll live a while — full ceremony. Leo can lead.”
        </span>
      </div>
      <div className="commission-interpreter-receipt">
        INTERPRETER · NEW ROOM → DRAFT MANIFEST → CONFIRM · FLASH $0.002 · LOGGED
      </div>
    </Chassis>
  );
}
