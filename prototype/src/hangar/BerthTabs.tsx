import { Led } from "@room/ui/rig";
import { coupleRoom, setView } from "../mock/scenario";
import { useFleet } from "../mock/store";

export function roomShortLabel(roomId: string) {
  if (roomId === "room-of-devs") return "R-DEVS";
  if (roomId === "comic-reader") return "COMIC-RDR";
  return roomId.toLocaleUpperCase();
}

export function BerthTabs({ compact = false }: { compact?: boolean }) {
  const fleet = useFleet();
  const rooms = fleet.rooms
    .filter((room) => room.berth != null)
    .sort((a, b) => (a.berth ?? 0) - (b.berth ?? 0));

  return (
    <nav className={`berth-tabs${compact ? " berth-tabs--compact" : ""}`} aria-label="Room berths">
      <button
        type="button"
        className="berth-tab berth-tab--hangar"
        onClick={() => setView("hangar")}
      >
        ⌘0 HANGAR
      </button>
      {rooms.map((room) => {
        const needsYou = room.counts.needsYou > 0;
        const active = fleet.zoom === "room" && fleet.activeRoomId === room.id;
        return (
          <button
            type="button"
            className={`berth-tab${active ? " is-active" : ""}${needsYou ? " needs-you" : ""}`}
            key={room.id}
            onClick={() => coupleRoom(room.id)}
            aria-current={active ? "page" : undefined}
          >
            <Led
              tone={needsYou ? "red" : active ? "amber" : "dim"}
              pulse={needsYou}
              pulseSpeed={needsYou ? "hot" : "default"}
            />
            {roomShortLabel(room.id)}
          </button>
        );
      })}
    </nav>
  );
}
