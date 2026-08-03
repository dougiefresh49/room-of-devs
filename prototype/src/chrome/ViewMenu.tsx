import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@room/ui";
import { Led } from "@room/ui/rig";
import { useState } from "react";
import { openSchematic } from "../map/schematic-events";
import { setView } from "../mock/scenario";
import { useRoom } from "../mock/store";

export function ViewMenu() {
  const room = useRoom();
  const [open, setOpen] = useState(false);
  const current = room.view === "console" ? "RAIL" : room.view.toLocaleUpperCase();

  const viewMark = (view: typeof room.view) =>
    room.view === view ? (
      <Led tone="amber" title={`${view} view active · amber`} />
    ) : (
      <Led tone="dim" title={`${view} view inactive · dim`} />
    );

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button type="button" className="viewmenu-trigger">
          <span className="vm-key">VIEW ·</span>
          {current}
          <span aria-hidden>▾</span>
        </button>
      </DropdownMenuTrigger>
      {/* forceMount keeps Radix's portal stable across rung changes; the paired
          closed-state CSS is load-bearing because a mounted menu must not paint. */}
      <DropdownMenuContent className="viewmenu-content" align="end" sideOffset={6} forceMount>
        <DropdownMenuItem className="vm-item" onSelect={() => setView("plot")}>
          {viewMark("plot")}
          <span>LONG-RANGE PLOT</span>
          <span className="vm-hint">ESC ▴</span>
        </DropdownMenuItem>
        <DropdownMenuItem className="vm-item" onSelect={() => setView("console")}>
          {viewMark("console")}
          <span>CONSOLE / RAIL</span>
          <span className="vm-hint">ESC ▴</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          className="vm-item"
          onSelect={() => {
            const id =
              room.focusCraftId ?? room.crafts.find((craft) => craft.state !== "empty")?.id ?? null;
            setView("node", id);
          }}
        >
          {viewMark("node")}
          <span>NODE</span>
          <span className="vm-hint">ESC ▾</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator className="vm-sep" />
        <DropdownMenuItem
          className="vm-item"
          onSelect={() => {
            setOpen(false);
            openSchematic();
          }}
        >
          <Led tone="dim" title="Service schematic closed · dim" />
          <span>SERVICE SCHEMATIC</span>
          <span className="vm-hint">PLATE</span>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="vm-item">
          <a href="/field">
            <span aria-hidden>↗</span>
            <span>FIELD UNIT</span>
            <span className="vm-hint">PHONE VIEW</span>
          </a>
        </DropdownMenuItem>
        <DropdownMenuSeparator className="vm-sep" />
        <div className="vm-foot">ESC CLIMBS OUT · ⌘0 HANGAR · ⌘1-9 ROOMS · ⌘K SWITCH</div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
