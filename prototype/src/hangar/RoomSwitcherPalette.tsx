import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
  Dialog,
  DialogContent,
  DialogTitle,
} from "@room/ui";
import { useEffect, useState } from "react";
import { coupleRoom } from "../mock/scenario";
import { useFleet } from "../mock/store";
import { roomShortLabel } from "./BerthTabs";

export function RoomSwitcherPalette() {
  const fleet = useFleet();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const rooms = fleet.rooms
    .filter((room) => room.berth != null)
    .sort((a, b) => (a.berth ?? 0) - (b.berth ?? 0));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="rig-command-dialog room-switcher-dialog">
        <DialogTitle className="visually-hidden">Couple a room</DialogTitle>
        <Command aria-label="Room switcher">
          <CommandInput autoFocus placeholder="COUPLE A ROOM…" aria-label="Filter rooms" />
          <CommandList>
            <CommandEmpty>NO BERTH MATCHES THAT CALLSIGN</CommandEmpty>
            <CommandGroup heading="HANGAR BERTHS">
              {rooms.map((room) => (
                <CommandItem
                  key={room.id}
                  value={`${room.manifest.name} ${roomShortLabel(room.id)} berth ${room.berth}`}
                  onSelect={() => {
                    coupleRoom(room.id);
                    setOpen(false);
                  }}
                >
                  <span
                    className={
                      room.counts.needsYou > 0 ? "command-room-led is-red" : "command-room-led"
                    }
                  />
                  <span>
                    B-{String(room.berth).padStart(2, "0")} · {room.manifest.name}
                  </span>
                  <CommandShortcut>⌘{room.berth}</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
