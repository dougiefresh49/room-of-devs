/**
 * Header overflow (⋮) menu. Hold room + Catch up.
 *
 * Catch up (chunk D, re-added per its deferral note): client-side sequential
 * playback of unheard replay clips — no server call. Shown as "Catch up (N
 * unheard)" when there is unheard audio, "Stop catch-up" while a run is in
 * progress; hidden otherwise. App computes the unheard queue and drives the
 * AudioController.
 */
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@room/ui";
import { IconMore } from "../icons.js";

interface OverflowMenuProps {
  held: boolean;
  onToggleHold: () => void;
  catchUp: boolean;
  unheardCount: number;
  onCatchUp: () => void;
  onStopCatchUp: () => void;
}

export function OverflowMenu({
  held,
  onToggleHold,
  catchUp,
  unheardCount,
  onCatchUp,
  onStopCatchUp,
}: OverflowMenuProps) {
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
        {catchUp ? (
          <DropdownMenuItem onSelect={onStopCatchUp}>Stop catch-up</DropdownMenuItem>
        ) : unheardCount > 0 ? (
          <DropdownMenuItem onSelect={onCatchUp}>
            Catch up ({unheardCount} unheard)
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
