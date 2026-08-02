import { PartNo } from "../map/PartNo";
import { useRoom } from "../mock/store";

export function TurnChip() {
  const { turnChip, tapIn } = useRoom();
  return (
    <div className="watchchip" style={{ borderColor: "#3a3f45", color: "var(--steel-dim)" }}>
      <PartNo partNo="S-11" />
      <span
        className="eye"
        style={{ background: "var(--steel-dim)", boxShadow: "none", animation: "none" }}
      />
      DIAL 3 · THIS TURN: {turnChip.model} · ${turnChip.costUsd.toFixed(3)} — ROUTING TABLE, NOT
      JUDGMENT
      {tapIn ? (
        <div className="tapin-chip">
          TAP-IN · Q: {tapIn.question}
          <br />
          INTERPRETER · {tapIn.interpreter}
          <br />
          {tapIn.answer ? `A: ${tapIn.answer}` : "…thinking"}
        </div>
      ) : null}
    </div>
  );
}
