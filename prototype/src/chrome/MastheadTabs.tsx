import { Led } from "@room/ui/rig";
import { coupleRoom, setView } from "../mock/scenario";
import { openCommission, useFleet } from "../mock/store";

export function roomShortLabel(roomId: string) {
  if (roomId === "room-of-devs") return "R-DEVS";
  if (roomId === "comic-reader") return "COMIC-RDR";
  return roomId.toLocaleUpperCase();
}

export function MastheadTabs() {
  const fleet = useFleet();
  const rooms = fleet.rooms
    .filter((room) => room.berth != null)
    .sort((a, b) => (a.berth ?? 0) - (b.berth ?? 0));

  return (
    <nav className="masthead-rail" aria-label="Room berths">
      <button
        type="button"
        className={`masthead-tab masthead-tab--hangar${fleet.zoom === "hangar" ? " is-active" : ""}`}
        onClick={() => setView("hangar")}
        aria-current={fleet.zoom === "hangar" ? "page" : undefined}
      >
        ⌘0 HANGAR
      </button>
      {rooms.map((room) => {
        const needsYou = room.counts.needsYou > 0;
        const active = fleet.zoom === "room" && fleet.activeRoomId === room.id;
        return (
          <button
            type="button"
            className={`masthead-tab${active ? " is-active" : ""}${needsYou ? " needs-you" : ""}`}
            key={room.id}
            onClick={() => coupleRoom(room.id)}
            aria-current={active ? "page" : undefined}
          >
            <Led
              tone={needsYou ? "red" : active ? "amber" : "dim"}
              pulse={needsYou}
              pulseSpeed={needsYou ? "hot" : "default"}
              title={
                needsYou
                  ? `${room.manifest.name} needs you · red`
                  : active
                    ? `${room.manifest.name} coupled · amber`
                    : `${room.manifest.name} idle · dim`
              }
            />
            {roomShortLabel(room.id)}
          </button>
        );
      })}
      <button
        type="button"
        className="masthead-tab masthead-tab--new"
        aria-label="Commission a room"
        title="COMMISSION A ROOM"
        onClick={() => openCommission("rig")}
      >
        +
      </button>
    </nav>
  );
}
