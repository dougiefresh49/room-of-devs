import { AvatarFace } from "../avatars/AvatarFace";
import { toggleVerb } from "../mock/scenario";
import { useRoom } from "../mock/store";

export function StartScreen() {
  const room = useRoom();
  const tap = room.tapIn;
  const spawning = room.crafts.find((c) => c.state === "spawning");

  let exchange: { you?: string; mikey?: string; typing?: boolean } = {};
  if (tap) {
    exchange = {
      you: tap.question,
      mikey: tap.answer ?? undefined,
      typing: tap.answer === null,
    };
  } else {
    const lastYou = [...room.transcript].reverse().find((r) => r.who === "YOU");
    const lastMikey = [...room.transcript].reverse().find((r) => r.who === "MIKEY");
    exchange = { you: lastYou?.text, mikey: lastMikey?.text };
  }

  return (
    <div className="screen-body">
      <div
        className="vt"
        style={{
          padding: 10,
          border: "1px solid rgba(255,179,71,.18)",
          borderRadius: 6,
          background: "rgba(0,0,0,.35)",
        }}
      >
        {exchange.you ? (
          <div className="row">
            <span className="who">YOU</span>
            <span className="say you">{exchange.you}</span>
          </div>
        ) : (
          <div className="row">
            <span className="who">YOU</span>
            <span className="say" style={{ color: "var(--amber-dim)" }}>
              speak new work — or tap a verb below
            </span>
          </div>
        )}
        {exchange.mikey || exchange.typing ? (
          <div className="row">
            <span className="who">MIK</span>
            <span className="say">
              {exchange.typing ? (
                <>
                  …<span className="cursor" />
                </>
              ) : (
                exchange.mikey
              )}
            </span>
          </div>
        ) : null}
      </div>

      <div className="watchchip" style={{ marginTop: 10 }}>
        {tap ? (
          <>INTERPRETER: {tap.interpreter}</>
        ) : spawning ? (
          <>
            NEW WORK → FILE {spawning.ticket} → SPAWN · FLASH $0.002 · LOGGED
          </>
        ) : (
          <span style={{ color: "var(--steel-dim)" }}>
            INTERPRETER COLD · NEW WORK FILES A TICKET → SPAWN
          </span>
        )}
      </div>

      {spawning ? (
        <div className="trows">
          <div className="trow spawning">
            <div className="tface">
              <div className="face-crt">
                <AvatarFace persona={spawning.persona} size={40} />
              </div>
            </div>
            <div className="tmid">
              <span className="callsign">{spawning.callsign}</span>
              <span className="tid">{spawning.ticket}</span>
              <div className="ttask">{spawning.task}</div>
            </div>
            <span className="tag">LAUNCHING</span>
          </div>
        </div>
      ) : (
        <div className="empty-line">BIRTH SLOT OPEN · SPEAK NEW WORK</div>
      )}

      <div className="vrack" style={{ marginTop: "auto" }}>
        {room.verbs.map((v) => (
          <button
            type="button"
            key={v.id}
            className={`vswitch${v.on ? " on" : ""}`}
            onClick={() => toggleVerb(v.id)}
          >
            <span className="lever" />
            <span>
              <div className="vname">&quot;{v.utterance}&quot;</div>
              <div className="vparams">{v.params}</div>
            </span>
            {v.gatedIssue != null ? (
              <span className="tag red">GATED #{v.gatedIssue}</span>
            ) : (
              <span className={`led${v.on ? " on" : ""}`} />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
