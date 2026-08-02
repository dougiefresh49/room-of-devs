import { Led, Tag, Tooltip, TooltipContent, TooltipTrigger } from "@room/ui";
import type { Instrument } from "./crib-manifest";
import { provenanceClass, provenanceLabel, stockLabel, stockTone } from "./crib-utils";

export function ProvenanceStamp({
  provenance,
  verdict,
}: {
  provenance: Instrument["provenance"];
  verdict?: string;
}) {
  const stamp = (
    <span className={provenanceClass(provenance)}>{provenanceLabel(provenance)}</span>
  );
  if (!verdict) return stamp;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="crib-prov-trigger">
          {stamp}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="crib-verdict-tip">
        {verdict}
      </TooltipContent>
    </Tooltip>
  );
}

export function StockLamp({ consumers }: { consumers: string[] }) {
  const tone = stockTone(consumers.length);
  const ledTone = tone === "red" ? "red" : tone === "amber" ? "amber" : "green";
  return (
    <span className={`crib-stocklamp crib-stocklamp--${tone}`}>
      <Led tone={ledTone} pulse={tone === "red"} />
      {stockLabel(consumers.length)}
    </span>
  );
}

const SURFACE_KEYS = [
  { key: "console" as const, pin: "C" },
  { key: "field" as const, pin: "F" },
  { key: "panel" as const, pin: "P" },
  { key: "mobile" as const, pin: "M" },
];

export function SurfacePins({ surfaces }: { surfaces: Instrument["surfaces"] }) {
  return (
    <div className="crib-surface-pins">
      {SURFACE_KEYS.map(({ key, pin }) => {
        const on = surfaces.includes(key);
        return (
          <span key={key} className="crib-surface-pin">
            <Led tone={on ? "amber" : "dim"} />
            {pin}
          </span>
        );
      })}
    </div>
  );
}

export function SurfaceFilterPins({
  active,
  onToggle,
}: {
  active: Set<Instrument["surfaces"][number]>;
  onToggle: (surface: Instrument["surfaces"][number]) => void;
}) {
  return (
    <div className="crib-surfchips">
      {SURFACE_KEYS.map(({ key, pin }) => {
        const on = active.has(key);
        return (
          <button
            key={key}
            type="button"
            className={`crib-surfchip${on ? " crib-surfchip--on" : ""}`}
            onClick={() => onToggle(key)}
            aria-pressed={on}
          >
            <Tag tone={on ? "amber" : "dim"}>{pin}</Tag>
          </button>
        );
      })}
    </div>
  );
}
