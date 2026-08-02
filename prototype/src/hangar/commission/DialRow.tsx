import { ToggleGroup, ToggleGroupItem } from "@room/ui";
import type { BrainTable, CommissionDraft, GearDefault, PersonaId } from "../../mock/types";

export interface DialRowProps {
  draft: CommissionDraft;
  onChange: (patch: Partial<CommissionDraft>) => void;
}

interface Detent {
  value: string;
  label: string;
  consequence: string;
}

const GEAR: Detent[] = [
  { value: "bare", label: "BARE", consequence: "+0 EXTRA TURNS · DIRECT WORK, NO CEREMONY" },
  { value: "light", label: "LIGHT", consequence: "≈ 2 EXTRA TURNS PER PIECE OF WORK" },
  { value: "full", label: "FULL", consequence: "≈ 5 EXTRA TURNS PER PIECE OF WORK" },
];

const CAST: Detent[] = [
  { value: "mikey", label: "MIKEY", consequence: "ELEVENLABS BILLS PER CHARACTER · SOLO CAST" },
  { value: "leo", label: "LEO + D", consequence: "ELEVENLABS BILLS PER CHARACTER · DONNIE IN POOL" },
  { value: "raph", label: "RAPH + POOL", consequence: "ELEVENLABS BILLS PER CHARACTER · CAST CHANGES WHO, NOT RATE" },
];

const BRAIN: Detent[] = [
  { value: "lean", label: "LEAN", consequence: "TYPICAL TURN $0.002 · FLASH ROUTING" },
  { value: "std", label: "STD", consequence: "TYPICAL TURN $0.018 · BALANCED TABLE" },
  { value: "deep", label: "DEEP", consequence: "TYPICAL TURN ≈ $0.09 · ESCALATION LOGGED" },
];

function Dial({
  number,
  title,
  home,
  value,
  detents,
  onChange,
}: {
  number: string;
  title: string;
  home: string;
  value: string;
  detents: Detent[];
  onChange: (value: string) => void;
}) {
  const activeIndex = Math.max(0, detents.findIndex((detent) => detent.value === value));
  const active = detents[activeIndex] ?? detents[0];
  return (
    <div className="commission-dial">
      <div className="commission-knob" data-position={activeIndex} aria-hidden>
        <span />
      </div>
      <ToggleGroup
        type="single"
        value={value}
        onValueChange={(next) => {
          if (next) onChange(next);
        }}
        className="commission-detents"
        aria-label={`${number} ${title}`}
      >
        {detents.map((detent) => (
          <ToggleGroupItem
            key={detent.value}
            value={detent.value}
            className="commission-detent"
          >
            {detent.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <div className="commission-dial-label">
        <b>{number} · {title}</b>
        <span>HOME: {home}</span>
      </div>
      <div className="commission-consequence">
        <b>{active.label}</b> — {active.consequence}
      </div>
    </div>
  );
}

function castForLead(lead: PersonaId): PersonaId[] {
  if (lead === "leo") return ["donnie"];
  if (lead === "raph") return ["donnie", "mikey"];
  return [];
}

export function DialRow({ draft, onChange }: DialRowProps) {
  return (
    <div className="commission-dial-row">
      <Dial
        number="D1"
        title="GEAR DEFAULT"
        home="PLAN CARD"
        value={draft.gearDefault}
        detents={GEAR}
        onChange={(gearDefault) => onChange({ gearDefault: gearDefault as GearDefault })}
      />
      <Dial
        number="D2"
        title="VOICE / CAST"
        home="FACEPLATE"
        value={draft.lead}
        detents={CAST}
        onChange={(lead) => {
          const persona = lead as PersonaId;
          onChange({ lead: persona, checkout: castForLead(persona) });
        }}
      />
      <Dial
        number="D3"
        title="BRAIN TABLE"
        home="TURN CHIP"
        value={draft.brainTable}
        detents={BRAIN}
        onChange={(brainTable) => onChange({ brainTable: brainTable as BrainTable })}
      />
    </div>
  );
}
