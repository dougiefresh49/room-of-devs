import { Led, Odometer } from "@room/ui/rig";
import { PartNo } from "../map/PartNo";
import type { Plan } from "../mock/types";

function Schematic({ kind }: { kind: Plan["schematic"] }) {
  if (kind === "queued") {
    return (
      <svg viewBox="0 0 120 34">
        <g fill="none" stroke="#8a5c20" strokeWidth="1">
          <rect x="4" y="6" width="30" height="22" rx="2" />
          <rect x="86" y="6" width="30" height="22" rx="2" />
          <path d="M34 17h52" strokeDasharray="3 3" />
          <circle cx="60" cy="17" r="5" />
        </g>
      </svg>
    );
  }
  if (kind === "active") {
    return (
      <svg viewBox="0 0 120 40">
        <g fill="none" stroke="#ffb347" strokeWidth="1">
          <rect x="4" y="4" width="34" height="14" rx="2" />
          <rect x="4" y="22" width="34" height="14" rx="2" />
          <rect x="82" y="13" width="34" height="14" rx="2" />
          <path d="M38 11h20v9h24M38 29h20v-9" opacity=".8" />
          <circle cx="60" cy="20" r="2.5" fill="#ffb347" />
        </g>
      </svg>
    );
  }
  return null;
}

export function PlanCard({ plan }: { plan: Plan }) {
  const dockClass =
    plan.dock === "live"
      ? "active"
      : plan.dock === "queued"
        ? "queued"
        : plan.dock === "birth"
          ? "queued spawning birth"
          : "archived";

  return (
    <div className={`node plan ${dockClass}`}>
      <PartNo partNo="S-04" />
      <div className="bpcard">
        <div className="pl-id">
          PLAN {plan.id} //{" "}
          {plan.dock === "live"
            ? "ACTIVE"
            : plan.dock === "queued"
              ? "QUEUED"
              : plan.dock === "birth"
                ? "BIRTH"
                : "SETTLED"}
        </div>
        <div className="pl-name">{plan.name}</div>
        <Schematic kind={plan.schematic} />
      </div>
      <div className="pl-right">
        {plan.steps.length > 0 ? (
          <>
            <div className="steps">
              {plan.steps.map((s, i) => (
                <i key={i} className={s} />
              ))}
              {plan.gearTag ? (
                <span className="tag" style={{ fontSize: 7.5, marginLeft: 6 }}>
                  {plan.gearTag}
                </span>
              ) : null}
            </div>
            <span className="pl-status">
              {plan.stepLabel} <Odometer value={47} digits={4} rolling />
            </span>
          </>
        ) : (
          <span
            className={`pl-status${plan.dock === "queued" || plan.dock === "birth" ? " dim" : ""}`}
          >
            {plan.dock === "settled" ? (
              <>
                <Led tone="green" />{" "}
              </>
            ) : null}
            {plan.status}
          </span>
        )}
      </div>
    </div>
  );
}
