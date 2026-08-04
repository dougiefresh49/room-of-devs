import { CutFrame, Led, Tag } from "@room/ui/rig";
import { AvatarFace } from "../avatars/AvatarFace";
import { useRoom } from "../mock/store";
import { FieldCrtFace } from "../rig-ext/FieldCrtFace";
import { CommsLog, type CommsRow } from "./CommsLog";
import { VoiceBar } from "./VoiceBar";

interface ComsScreenProps {
  faceplateLarge: boolean;
  onReadBack: () => void;
  onOpenNode: (craftId: string) => void;
}

export function ComsScreen({ faceplateLarge, onReadBack, onOpenNode }: ComsScreenProps) {
  const room = useRoom();
  const heldCraft = room.heldQuestion
    ? room.crafts.find((craft) => craft.id === room.heldQuestion?.craftId)
    : null;
  const tap = room.tapIn;
  const rows: CommsRow[] = [...room.transcript];
  if (tap && !rows.some((row) => row.text === tap.question)) {
    rows.push({ who: "YOU", text: tap.question, you: true });
    rows.push({ who: "MIKEY", text: tap.answer ?? "Reading the room…" });
  }
  const latestBirth = room.crafts.reduce<(typeof room.crafts)[number] | null>(
    (latest, craft) =>
      craft.spawnedRev != null && (!latest || craft.spawnedRev > (latest.spawnedRev ?? -1))
        ? craft
        : latest,
    null,
  );
  const footNote = room.queuedForLull.length
    ? `QUEUED FOR THE LULL: ${room.queuedForLull.join(" · ")}`
    : undefined;

  return (
    <div className="screen-body coms-body" data-part="F-02">
      <VoiceBar large={faceplateLarge} />

      {room.heldQuestion && heldCraft ? (
        <button
          type="button"
          className="screenbed coms-banner"
          onClick={() => onOpenNode(heldCraft.id)}
        >
          <FieldCrtFace size={32} scanlines>
            <AvatarFace persona={heldCraft.persona} size={32} />
          </FieldCrtFace>
          <span>
            <b>{heldCraft.callsign} · {heldCraft.ticket}</b>
            <small>HELD QUESTION · {heldCraft.lastStamp}</small>
          </span>
          <Tag tone="red">NEEDS YOU</Tag>
          <i aria-hidden>▸</i>
        </button>
      ) : null}

      {room.grantArmed ? (
        <div className="grantchip coms-grant">
          <Led tone="green" /> SPEAKER GRANT ARMED · THIS PHONE · {room.grantCountdown}s
        </div>
      ) : null}

      <CommsLog
        rows={rows}
        typing={tap?.answer == null && tap != null}
        footNote={footNote}
        className="field-thread coms-thread"
        onReadBack={onReadBack}
      />

      {latestBirth ? (
        <div className="coms-receipts">
          <CutFrame scale="s" innerClassName="coms-receipt">
            NEW WORK → FILE {latestBirth.ticket} → SPAWN · FLASH $0.002 · LOGGED
          </CutFrame>
          <button type="button" className="trow" onClick={() => onOpenNode(latestBirth.id)}>
            <div className="tface">
              <FieldCrtFace size={40} scanlines>
                <AvatarFace persona={latestBirth.persona} size={40} />
              </FieldCrtFace>
            </div>
            <div className="tmid">
              <span className="callsign">{latestBirth.callsign}</span>
              <span className="tid">{latestBirth.ticket}</span>
              <div className="ttask">{latestBirth.task}</div>
            </div>
            <Tag>{latestBirth.state === "spawning" ? "LAUNCHING" : "JUST LAUNCHED"}</Tag>
          </button>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <div className="coms-empty">
          <b>TELL MIKEY WHAT TO BUILD</b>
          <span>Say it out loud. He writes the ticket and puts a dev on it.</span>
        </div>
      ) : null}
    </div>
  );
}
