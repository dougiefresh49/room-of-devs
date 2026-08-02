import { Tag } from "@room/ui";
import { deadStockBin, fragileCount } from "./crib-manifest";
import { ProvenanceStamp } from "./crib-chrome";

export function DeadStockBin() {
  return (
    <div className="crib-deadbin">
      <div className="haz" />
      <div className="crib-deadbin-head">
        <span className="rig-led rig-led--red" aria-hidden />
        <span className="crib-deadbin-title">Dead stock bin</span>
        <span className="crib-deadbin-sub">
          {deadStockBin.length === 0
            ? "NO ZERO-CONSUMER PARTS DETECTED"
            : "ZERO-CONSUMER PARTS — AND WHAT HAND-ROLLS THEM INSTEAD"}
        </span>
      </div>
      <div className="crib-deadbin-grid">
        {deadStockBin.length === 0 ? (
          <div className="crib-deadbin-empty">
            <Tag tone="green">NO DEAD STOCK</Tag>
            <span>EVERY PART HAS A DETECTED CONSUMER · {fragileCount()} FRAGILE</span>
          </div>
        ) : (
          deadStockBin.map((entry) => (
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
          ))
        )}
      </div>
    </div>
  );
}
