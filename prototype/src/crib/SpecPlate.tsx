import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  CutFrame,
  ScreenBed,
  Tag,
} from "@room/ui";
import type { Instrument } from "./crib-manifest";
import { adoptionCaveat } from "./crib-manifest";
import { ProvenanceStamp, StockLamp } from "./crib-chrome";
import { StateRack } from "./specimens";

export function SpecPlate({
  instrument,
  open,
  onOpenChange,
}: {
  instrument: Instrument | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!instrument) {
    return (
      <div className="crib-inspector crib-inspector--empty">
        <CutFrame scale="m">
          <div className="chassis crib-spec-empty">
            <span className="stn">SPEC PLATE</span>
            <span className="tag dim">SELECT AN INSTRUMENT</span>
          </div>
        </CutFrame>
      </div>
    );
  }

  return (
    <div className="crib-inspector">
      <CutFrame scale="m">
        <Collapsible open={open} onOpenChange={onOpenChange} className="chassis crib-spec">
          <div className="crib-spec-head">
            <span className="crib-cardno crib-cardno--hot">{instrument.id}</span>
            <span className="crib-inm">{instrument.name}</span>
            <ProvenanceStamp provenance={instrument.provenance} verdict={instrument.verdict} />
            <CollapsibleTrigger className="crib-spec-toggle">
              {open ? "▾ PLATE" : "▸ PLATE"}
            </CollapsibleTrigger>
          </div>

          <ScreenBed className="crib-istage">
            <StateRack name={instrument.name} />
          </ScreenBed>

          <CollapsibleContent className="crib-spec-body">
            <div className="crib-irow">
              <div className="crib-ik">States — this row IS the API surface</div>
              <div className="crib-iv">{instrument.states.join(" · ")}</div>
            </div>

            <div className="crib-irow">
              <div className="crib-ik">Tolerances — props</div>
              <table className="crib-tol">
                <thead>
                  <tr>
                    <th>PROP</th>
                    <th>TYPE</th>
                    <th>NOTE</th>
                  </tr>
                </thead>
                <tbody>
                  {instrument.props.map((row) => (
                    <tr key={row.name}>
                      <td className="k">{row.name}</td>
                      <td>{row.type}</td>
                      <td className="d">{row.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="crib-irow">
              <div className="crib-ik">Stock lamp</div>
              <div className="crib-iv">
                <StockLamp consumers={instrument.consumers} />
                <span className="crib-iv-hint">
                  {" "}
                  — green ≥2, amber exactly 1, red 0.
                </span>
              </div>
            </div>

            <div className="crib-irow">
              <div className="crib-ik">Where used</div>
              <div className="crib-iv">
                {instrument.consumers.length === 0 ? (
                  <em>No imports detected — grep union of @room/ui and @room/ui/rig.</em>
                ) : (
                  instrument.consumers.join(" · ")
                )}
              </div>
            </div>

            {instrument.registryEquivalent && instrument.verdict ? (
              <div className="crib-irow">
                <div className="crib-ik">Registry equivalent — verdict printed verbatim</div>
                <div className="crib-iv">
                  <span className="crib-rej">REJECTED</span> — <em>{instrument.verdict}</em> — shadcn-audit.md
                </div>
              </div>
            ) : null}

            {instrument.defect ? (
              <div className="crib-irow">
                <div className="crib-ik">Known defect</div>
                <div className="crib-defect">{instrument.defect}</div>
              </div>
            ) : null}

            <div className="crib-irow">
              <div className="crib-ik">Path</div>
              <div className="crib-iv">{instrument.path}</div>
            </div>

            <p className="crib-honesty">
              After Round D partial adoption, dialog and command have consumers in the prototype; tooltip and toast may
              still read red until commissioning wires sonner and stamps use Tooltip. The lamps above come from the
              generated manifest — not prose.
            </p>
            <p className="crib-honesty">
              <Tag tone="dim">ADOPTION CAVEAT</Tag> {adoptionCaveat}
            </p>
          </CollapsibleContent>
        </Collapsible>
      </CutFrame>
    </div>
  );
}
