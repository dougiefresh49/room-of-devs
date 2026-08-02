import { PartNo } from "../map/PartNo";
import { toggleVerb } from "../mock/scenario";
import { useRoom } from "../mock/store";

export function VerbRack() {
  const { verbs } = useRoom();
  return (
    <div className="chassis rcard">
      <PartNo partNo="S-10" />
      <div className="sc-head">
        <span className="stn">VERB RACK</span>
        <span className="tag">NAMING IS CONSENT</span>
      </div>
      <div className="vrack">
        {verbs.map((v) => (
          <button
            type="button"
            key={v.id}
            className={`vswitch${v.on ? " on" : ""}`}
            onClick={() => toggleVerb(v.id)}
            disabled={v.gatedIssue != null}
            style={{ width: "100%", cursor: v.gatedIssue ? "not-allowed" : "pointer" }}
          >
            <span className="lever" />
            <span>
              <div className="vname">{v.utterance}</div>
              <div className="vparams">{v.params}</div>
            </span>
            {v.gatedIssue != null ? (
              <span className="tag red">GATED #{v.gatedIssue}</span>
            ) : (
              <span className="tag dim">{v.on ? "ON" : "OFF"}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
