import { toast } from "@room/ui";
import { Chassis, CutFrame, Keycap, Tag } from "@room/ui/rig";
import {
  patchFleet,
  strikeCommission,
  updateCommission,
  useFleet,
} from "../../mock/store";
import { CeremonyFork } from "./CeremonyFork";
import { DialRow } from "./DialRow";
import { ManifestPreview } from "./ManifestPreview";
import { VoicePath } from "./VoicePath";

const CONNECTORS = ["gh-issues", "tmux", "vercel", "sentry"] as const;

export function CommissioningBay() {
  const draft = useFleet().commission;
  if (!draft) return null;

  const strike = () => {
    if (!draft.name.trim() || (draft.ceremony === "full" && !draft.repo.trim())) {
      toast.error("DESIGNATION + REPO REQUIRED BEFORE THE BERTH CAN BE STRUCK");
      return;
    }
    const receipt = strikeCommission();
    if (!receipt) return;
    if (receipt.ceremony === "full") {
      toast("MANIFEST CHECKED IN · MIKEY ANNOUNCES THE BERTH AT THE LULL");
    } else {
      toast("SCRATCH BERTH STRUCK · NOTHING DURABLE WRITTEN · DIES ON DELIVERY");
    }
  };

  return (
    <CutFrame
      scale="l"
      glow="0 14px 32px rgba(0,0,0,.58)"
      className="commission-bay-frame"
      innerClassName="commission-bay"
    >
      <header className="commission-bay-head">
        <div>
          <span className="commission-bay-kicker">COMMISSIONING BAY · B-{String(draft.berth ?? 0).padStart(2, "0")}</span>
          <h2>STRIKE A ROOM FROM CONFIG</h2>
        </div>
        <Tag tone={draft.source === "voice" ? "hot" : "dim"}>
          SOURCE · {draft.source.toUpperCase()}
        </Tag>
        <Keycap glyph="×" label="RETURN TO HANGAR" onPress={() => patchFleet({ commission: null })} />
      </header>

      <div className="commission-bay-grid">
        <Chassis screws className="commission-bench" glow="0 10px 22px rgba(0,0,0,.42)">
          <div className="commission-bench-body">
            <div className="commission-fields">
              <label>
                <span>DESIGNATION</span>
                <input
                  value={draft.name}
                  onChange={(event) => updateCommission({ name: event.target.value })}
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <label>
                <span>REPO</span>
                <input
                  value={draft.repo}
                  onChange={(event) => updateCommission({ repo: event.target.value })}
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
            </div>

            <fieldset className="commission-fieldset">
              <legend>CEREMONY CLASS · THE FORK</legend>
              <CeremonyFork
                value={draft.ceremony}
                onChange={(ceremony) => updateCommission({ ceremony })}
              />
            </fieldset>

            <fieldset className="commission-fieldset">
              <legend>THE THREE DIALS · HOME + CONSEQUENCE AT EACH DETENT</legend>
              <DialRow draft={draft} onChange={updateCommission} />
            </fieldset>

            <fieldset className="commission-fieldset commission-connectors">
              <legend>CONNECTORS</legend>
              <div>
                {CONNECTORS.map((connector) => (
                  <label key={connector}>
                    <input
                      type="checkbox"
                      checked={Boolean(draft.connectors[connector])}
                      onChange={(event) =>
                        updateCommission({
                          connectors: {
                            ...draft.connectors,
                            [connector]: event.target.checked,
                          },
                        })
                      }
                    />
                    <span>{connector.toUpperCase()}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="commission-strike-row">
              <Keycap
                glyph="↵"
                label={`STRIKE ${draft.ceremony === "full" ? `BERTH B-${String(draft.berth ?? 0).padStart(2, "0")}` : "SCRATCH BERTH"}`}
                hint="WRITE CONFIG"
                onPress={strike}
              />
              <span>
                {draft.ceremony === "full"
                  ? "ONE FILE · NEW BERTH ON NEXT SNAPSHOT"
                  : "MEMORY ONLY · NO FILE · DIES ON DELIVERY"}
              </span>
            </div>
          </div>
        </Chassis>

        <div className="commission-output-stack">
          <VoicePath draft={draft} />
          <ManifestPreview draft={draft} />
        </div>
      </div>
    </CutFrame>
  );
}
