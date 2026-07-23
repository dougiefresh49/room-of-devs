/**
 * Header overflow (⋮) menu. Hold room is fully wired here (toggle → daemon
 * hold_room, label reflects snapshot.roomHeld).
 *
 * "Catch up" is DEFERRED: in mobile.html it posts nothing to the server — it
 * drives client-side playback of unheard replay clips, which belongs to the
 * chunk-D audio/replay layer that does not exist yet. Per the phase rule
 * (actions whose target doesn't exist are omitted, not disabled), it is left
 * out here; the menu is the seam where chunk D re-adds it. Logged in
 * decisions-overnight.md.
 */
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@room/ui";
import { IconMore } from "../icons.js";

interface OverflowMenuProps {
  held: boolean;
  onToggleHold: () => void;
}

export function OverflowMenu({ held, onToggleHold }: OverflowMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="grid size-9 place-items-center rounded-lg border border-line-strong text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent [&_svg]:size-5"
        aria-label="More"
      >
        <IconMore />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onToggleHold}>
          {held ? "Release room" : "Hold room"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
