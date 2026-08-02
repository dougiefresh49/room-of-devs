import { ToggleGroup, ToggleGroupItem } from "@room/ui";
import type { Ceremony } from "../../mock/types";

export interface CeremonyForkProps {
  value: Ceremony;
  onChange: (value: Ceremony) => void;
}

const CEREMONIES: Array<{
  value: Ceremony;
  title: string;
  detail: string;
}> = [
  {
    value: "full",
    title: "FULL-CEREMONY ROOM",
    detail: "SPINE · STANDING CAST · NUMBERED BERTH · PLANS DOCK AND SETTLE · LIVES UNTIL DECOMMISSIONED",
  },
  {
    value: "one-off",
    title: "ONE-OFF · MORTAL",
    detail: "NO SPINE · NO TICKET · SCRATCH BERTH · MIKEY NARRATES · DIES ON DELIVERY",
  },
];

export function CeremonyFork({ value, onChange }: CeremonyForkProps) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(next) => {
        if (next) onChange(next as Ceremony);
      }}
      className="commission-ceremony-fork"
      aria-label="Ceremony class"
    >
      {CEREMONIES.map((ceremony) => (
        <ToggleGroupItem
          key={ceremony.value}
          value={ceremony.value}
          className="commission-ceremony-card"
          aria-label={ceremony.title}
        >
          <span className="commission-ceremony-lamp" aria-hidden />
          <span className="commission-ceremony-title">{ceremony.title}</span>
          <span className="commission-ceremony-detail">{ceremony.detail}</span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
