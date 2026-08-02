import { Tag } from "@room/ui";
import { deadStockBin } from "./crib-manifest";
import { ProvenanceStamp } from "./crib-chrome";

export function DeadStockBin() {
  return (
    <div className="crib-deadbin">
      <div className="haz" />
      <div className="crib-deadbin-head">
        <span className="rig-led rig-led--red" aria-hidden />
        <span className="crib-deadbin-title">Dead stock bin</span>
        <span className="crib-deadbin-sub">
          VENDORED, PAID FOR, ZERO IMPORTS — AND WHAT HAND-ROLLS IT INSTEAD
        </span>
      </div>
      <div className="crib-deadbin-grid">
        {deadStockBin.map((entry) => (
          <div key={entry.id} className="crib-deaditem">
            <div className="crib-deaditem-name">
              {entry.name.toUpperCase()}{" "}
              <ProvenanceStamp provenance={entry.provenance} />
            </div>
            <div className="crib-deaditem-roll">
              <b>HAND-ROLLED BY:</b> {entry.handRolledBy}
            </div>
            <Tag tone="green" className="crib-dead-verdict">
              VERDICT · {entry.verdict}
            </Tag>
          </div>
        ))}
      </div>
    </div>
  );
}
