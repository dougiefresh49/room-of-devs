import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@room/ui";
import { useEffect, useRef } from "react";
import { PART_TITLES } from "./map-data";

export interface PartNoProps {
  partNo: string;
  title?: string;
  className?: string;
  /** The map reuses the stencil without reloading its own route. */
  deepLink?: boolean;
  /** Attach shift-click behavior to the direct housing parent. */
  bindHousing?: boolean;
}

function schematicHref(partNo: string): string {
  return `/map?part=${encodeURIComponent(partNo)}`;
}

export function PartNo({
  partNo,
  title,
  className,
  deepLink = true,
  bindHousing = true,
}: PartNoProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const partTitle = title ?? PART_TITLES[partNo] ?? "Unindexed part";

  useEffect(() => {
    if (!deepLink || !bindHousing) return;
    const housing = ref.current?.parentElement;
    if (!housing) return;
    const openFromHousing = (event: MouseEvent) => {
      if (!event.shiftKey) return;
      event.preventDefault();
      event.stopPropagation();
      window.location.assign(schematicHref(partNo));
    };
    housing.addEventListener("click", openFromHousing);
    return () => housing.removeEventListener("click", openFromHousing);
  }, [bindHousing, deepLink, partNo]);

  const stencilClass = `part-no${className ? ` ${className}` : ""}`;
  const stencil = deepLink ? (
    <button
      ref={ref}
      type="button"
      className={stencilClass}
      aria-label={`${partNo} · ${partTitle}. Shift-click to open the service schematic.`}
      onClick={(event) => {
        if (!event.shiftKey) return;
        event.preventDefault();
        event.stopPropagation();
        window.location.assign(schematicHref(partNo));
      }}
      onKeyDown={(event) => {
        if (!event.shiftKey || event.key !== "Enter") return;
        event.preventDefault();
        window.location.assign(schematicHref(partNo));
      }}
    >
      {partNo}
    </button>
  ) : (
    <span className={stencilClass}>{partNo}</span>
  );

  return (
    <TooltipProvider delayDuration={180}>
      <Tooltip>
        <TooltipTrigger asChild>{stencil}</TooltipTrigger>
        <TooltipContent className="part-no-tooltip">
          <b>{partTitle}</b>
          {deepLink ? <span>SHIFT-CLICK · OPEN SCHEMATIC</span> : null}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
