import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@room/ui";
import { Info } from "lucide-react";
import { AvatarFace } from "../avatars/AvatarFace";

export function SpineLegendButton() {
  return (
    <Popover>
      <TooltipProvider delayDuration={180}>
        <Tooltip>
          <PopoverTrigger asChild>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="spine-legend-trigger"
                aria-label="How to read a node"
              >
                <Info size={11} aria-hidden />
              </button>
            </TooltipTrigger>
          </PopoverTrigger>
          <TooltipContent className="spine-legend-tip">HOW TO READ A NODE</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <PopoverContent
        className="spine-legend-pop"
        sideOffset={8}
        align="start"
        collisionPadding={12}
      >
        <div className="spine-legend-head">
          <b>HOW TO READ A NODE</b>
          <span>S-03</span>
        </div>
        <div className="spine-legend-grid">
          <span className="lgface" aria-hidden>
            <AvatarFace persona="mikey" mode="idle" size={26} />
          </span>
          <b>PILOT = PERSONA</b>
          <span>who is flying it</span>

          <span className="lgcard" aria-hidden />
          <b>CRAFT = T-####</b>
          <span>one mortal thread</span>

          <span className="lgdock" aria-hidden />
          <b>DOCK = PLAN ON RAIL</b>
          <span>the ticket it pulls</span>
        </div>
        <p>A NODE IS A SESSION, NEVER THE TASK. THE TASK LIVES ON THE PLAN CARD ABOVE IT.</p>
      </PopoverContent>
    </Popover>
  );
}
