import { adoptionCaveat, workOrders } from "./crib-manifest";

export function WorkOrders() {
  return (
    <div className="crib-workorders">
      <h3 className="crib-workorders-title">
        WORK ORDERS — audit §3 top five, with real call sites
      </h3>
      <ol className="crib-workorders-list">
        {workOrders.map((order, index) => (
          <li key={order.id}>
            <b>{order.title}</b> — {order.payoff}
            <div className="crib-workorders-sites">{order.callSites.join(" · ")}</div>
            {order.note ? <div className="crib-workorders-note">{order.note}</div> : null}
            {index === 0 ? null : null}
          </li>
        ))}
      </ol>
      <div className="crib-workorders-caveat">
        <b>ADOPTION CAVEAT, PRINTED ON EVERY ORDER:</b> {adoptionCaveat}
        <br />
        <b>DO NOT ADOPT:</b> badge · card · progress · chart · avatar · theme-* — the audit rules
        each out explicitly, and the RIG primitives they would replace are the product.
      </div>
    </div>
  );
}
