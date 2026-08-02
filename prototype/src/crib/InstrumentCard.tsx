import { ScreenBed } from "@room/ui";
import type { Instrument } from "./crib-manifest";
import { InstrumentPlaten } from "./specimens";
import { ProvenanceStamp, StockLamp, SurfacePins } from "./crib-chrome";
import { stockTone } from "./crib-utils";

export function InstrumentCard({
  instrument,
  selected,
  onSelect,
}: {
  instrument: Instrument;
  selected: boolean;
  onSelect: () => void;
}) {
  const dead = stockTone(instrument.consumers.length) === "red";
  return (
    <button
      type="button"
      className={`crib-speccard${selected ? " crib-speccard--sel" : ""}${dead ? " crib-speccard--dead" : ""}`}
      onClick={onSelect}
    >
      <span className="crib-cardno">{instrument.id}</span>
      {dead ? <div className="crib-deadstamp">DEAD STOCK · 0 CONSUMERS</div> : null}
      <ScreenBed className="crib-platen">
        <InstrumentPlaten name={instrument.name} />
      </ScreenBed>
      <div className="crib-sinfo">
        <span className="crib-snm">{instrument.name}</span>
        <ProvenanceStamp provenance={instrument.provenance} />
        <StockLamp consumers={instrument.consumers} />
        <SurfacePins surfaces={instrument.surfaces} />
        <span className="crib-spath">{instrument.path}</span>
      </div>
    </button>
  );
}
