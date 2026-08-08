import { Led, Tag } from "@room/ui/rig";
import { X } from "lucide-react";
import { standDownWatch, toggleVerb } from "../mock/scenario";
import { useRoom } from "../mock/store";

export function OrdersScreen({ onLocalChange }: { onLocalChange: () => void }) {
  const room = useRoom();
  const running = room.crafts.filter((craft) => craft.watched);

  return (
    <div className="screen-body orders-body" data-part="F-03">
      <div className="orders-head">STANDING ORDERS</div>
      <div className="vrack orders-rack">
        {room.verbs.map((verb) => {
          const gated = verb.gatedIssue != null;
          const on = !gated && verb.on;
          return (
            <button
              type="button"
              key={verb.id}
              className={`vswitch${on ? " on" : ""}${gated ? " is-gated" : ""}`}
              onClick={
                gated
                  ? undefined
                  : () => {
                      onLocalChange();
                      toggleVerb(verb.id);
                    }
              }
              disabled={gated}
              aria-pressed={on}
            >
              <span className="lever" />
              <span>
                <span className="vname">&quot;{verb.utterance}&quot;</span>
                <span className="vparams">{verb.fieldLabel}</span>
              </span>
              {gated ? <Tag tone="red">GATED #{verb.gatedIssue}</Tag> : <Led tone={on ? "amber" : "dim"} />}
            </button>
          );
        })}
      </div>

      <div className="orders-head orders-running-head">RUNNING NOW</div>
      {running.length ? (
        <div className="orders-running">
          {running.map((craft) => (
            <div className="watchchip orders-watch" key={craft.id}>
              <Led tone="amber" pulse className="watch-eye" />
              <span>
                <b>WATCH ORDER · {craft.ticket} · {craft.callsign}</b>
                <small>SAY “STAND DOWN” TO CANCEL</small>
              </span>
              <button type="button" aria-label={`Stand down ${craft.ticket}`} onClick={() => standDownWatch(craft.id)}>
                <X size={15} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="orders-empty">NO WATCH ORDERS RUNNING</div>
      )}
    </div>
  );
}
