import { Led } from "@room/ui/rig";
import { roomShortLabel } from "../chrome/MastheadTabs";
import { coupleRoom } from "../mock/scenario";
import { useFleet, useRoom } from "../mock/store";

export function FieldRoomRail() {
  const fleet = useFleet();
  const room = useRoom();
  const rooms = fleet.rooms
    .filter((berth) => berth.berth != null)
    .sort((a, b) => (a.berth ?? 0) - (b.berth ?? 0));

  return (
    <div className="frail">
      <nav className="frail-scroll" aria-label="Fleet rooms">
        {rooms.map((berth) => {
          const active = berth.id === fleet.activeRoomId;
          return (
            <button
              type="button"
              key={berth.id}
              className={active ? "is-active" : undefined}
              onClick={() => coupleRoom(berth.id)}
              aria-current={active ? "page" : undefined}
            >
              <span>{roomShortLabel(berth.id)}</span>
              <b>{berth.salience.clearPct}%</b>
              {!active && berth.counts.needsYou > 0 ? (
                <i role="img" aria-label="Needs you" />
              ) : null}
            </button>
          );
        })}
      </nav>

      <div className="flamps">
        <span
          role="img"
          title="SSE link — RoomClient connected to the daemon"
          aria-label="SSE link — RoomClient connected to the daemon"
        >
          <Led tone="green" /> <em>SSE</em>
        </span>
        <span
          role="img"
          title="AUD — lit when this phone holds the speaker gate (audio plays here, Mac speakers cold)"
          aria-label="AUD — lit when this phone holds the speaker gate (audio plays here, Mac speakers cold)"
        >
          <Led
            tone={room.audio.route === "phone" ? "amber" : "dim"}
            pulse={room.audio.route === "phone"}
          />{" "}
          <em>AUD</em>
        </span>
      </div>
    </div>
  );
}
