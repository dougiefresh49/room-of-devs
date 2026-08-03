import type { Plan } from "../mock/types";
import { PlanCard } from "./PlanCard";

export function SettledStrip({ plans }: { plans: Plan[] }) {
  const [departing, ...rest] = plans;
  if (!departing) return null;

  return (
    <div className="settled-strip">
      <div className="settled-rule">RAIL ENDS · BELOW THIS LINE IS OFF THE SPINE</div>
      <PlanCard plan={departing} departing />
      {rest.length > 0 ? (
        <div className="settled-roster">
          ALSO SETTLED ·{" "}
          {rest.map((plan, index) => (
            <span key={plan.id}>
              {index > 0 ? " · " : null}
              <b>{plan.id}</b> {plan.name}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
