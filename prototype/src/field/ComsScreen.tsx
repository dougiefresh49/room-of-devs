import { CutFrame, Led, Tag } from "@room/ui/rig";
import { AvatarFace } from "../avatars/AvatarFace";
import { useRoom } from "../mock/store";
import { FieldCrtFace } from "../rig-ext/FieldCrtFace";
import { CommsLog, type CommsRow } from "./CommsLog";
import { ComsHeader } from "./ComsHeader";

interface ComsScreenProps {
  onOpenNode: (craftId: string) => void;
  onOpenFloor: () => void;
}

function formatHold(seconds: number): string {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function ComsScreen({ onOpenNode, onOpenFloor }: ComsScreenProps) {
  const room = useRoom();
  const heldCraft = room.heldQuestion
    ? room.crafts.find((craft) => craft.id === room.heldQuestion?.craftId)
    : null;
  const tap = room.tapIn;
  const rows: CommsRow[] = [...room.transcript];
  if (tap && !rows.some((row) => row.text === tap.question)) {
    const at = Date.now();
    rows.push({ who: "YOU", text: tap.question, you: true, at });
    rows.push({ who: "MIKEY", text: tap.answer ?? "Reading the room…", at });
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
  const onAirAliases = room.nowPlaying
    ? [
        room.nowPlaying.persona,
        room.crew.find((member) => member.id === room.nowPlaying?.persona)?.callsign.toLowerCase(),
        room.crafts.find((craft) => craft.id === room.nowPlaying?.craftId)?.callsign.toLowerCase(),
      ].filter((value): value is string => Boolean(value))
    : [];

  return (
    <div className="screen-body coms-body" data-part="F-02">
      <ComsHeader />

      <CommsLog
        rows={rows}
        typing={tap?.answer == null && tap != null}
        footNote={footNote}
        className="field-thread coms-thread"
        nowPlaying={room.nowPlaying}
        onAirAliases={onAirAliases}
        onOpenFloor={onOpenFloor}
        stickyHeader={room.heldQuestion && heldCraft ? (
          <button
            type="button"
            className="screenbed coms-banner"
            onClick={() => onOpenNode(heldCraft.id)}
          >
            <Led tone="red" />
            <b>{heldCraft.callsign} HOLDING · {heldCraft.ticket} · {formatHold(heldCraft.holdSeconds)}</b>
            <i aria-hidden>▸</i>
          </button>
        ) : null}
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
