import { AvatarFace } from "../avatars/AvatarFace";
import {
  answer,
  injectReply,
  setComposer,
} from "../mock/scenario";
import { useRoom } from "../mock/store";

function fmtHold(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function AnswerScreen() {
  const room = useRoom();
  const hq = room.heldQuestion;
  const focus =
    room.crafts.find((c) => c.id === hq?.craftId) ??
    room.crafts.find((c) => c.state === "needs-you") ??
    room.crafts.find((c) => c.id === room.focusCraftId) ??
    room.crafts.find((c) => c.state !== "empty") ??
    null;

  const holding = focus?.state === "needs-you";

  return (
    <div className="screen-body">
      <div className="fstat" style={{ borderBottom: "none", marginBottom: 4, paddingBottom: 0 }}>
        <span>◂ ROOM</span>
        <span className="spacer" />
        {holding && focus ? (
          <span className="tag red" style={{ fontSize: "7.5px" }}>
            NEEDS YOU · HELD {fmtHold(focus.holdSeconds)}
          </span>
        ) : (
          <span className="tag dim" style={{ fontSize: "7.5px" }}>
            ALL QUIET
          </span>
        )}
      </div>

      {focus ? (
        <div className={`trow${focus.state === "needs-you" ? " needsyou" : ""}`}>
          <div className="tface">
            <div className="face-crt">
              <AvatarFace persona={focus.persona} size={40} />
            </div>
          </div>
          <div className="tmid">
            <span className="callsign">{focus.callsign}</span>
            <span className="tid">
              {focus.ticket}
              {focus.tmux ? " · TMUX ✓" : ""}
            </span>
            <div className="ttask">{focus.task}</div>
          </div>
          <span className={`tag${holding ? " red" : " dim"}`}>
            {holding ? "HELD" : focus.state.toUpperCase()}
          </span>
        </div>
      ) : null}

      {hq ? (
        <div
          className="vt"
          style={{
            marginTop: 10,
            padding: 10,
            border: "1px solid rgba(255,179,71,.18)",
            borderRadius: 6,
            background: "rgba(0,0,0,.35)",
          }}
        >
          <div className="row">
            <span className="who">
              {focus?.callsign.slice(0, 3).toUpperCase() ?? "???"}
            </span>
            <span className="say">{hq.prompt}</span>
          </div>
          <div className="row">
            <span className="who" />
            <span className="say" style={{ color: "var(--amber-dim)" }}>
              /thread/{focus?.ticket ?? "—"} · full history above ▴
            </span>
          </div>
        </div>
      ) : (
        <div className="empty-line">NO QUESTION HELD — THE ROOM IS WORKING</div>
      )}

      {hq
        ? hq.options.map((opt, i) => (
            <button
              type="button"
              key={opt.id}
              className={`optbtn${opt.armed ? " armed" : ""}`}
              style={{ marginTop: i === 0 ? 10 : 7 }}
              onClick={() => answer(opt.id)}
            >
              <span className="keycap">{i + 1}</span>
              <span>
                <b>{opt.label}</b> — {opt.detail}
              </span>
              <span className="odim">SAY “{opt.speakHint}”</span>
            </button>
          ))
        : null}

      <div className="composer">
        <input
          className="field"
          value={room.composerText}
          placeholder="or type it — lands as a tmux inject"
          onChange={(e) => setComposer(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              injectReply(room.composerText);
            }
          }}
        />
        <button
          type="button"
          className="sendkey"
          onClick={() => injectReply(room.composerText)}
        >
          INJECT ⏎
        </button>
      </div>

      {room.grantArmed ? (
        <div className="grantchip">
          <span className="gl" />
          SPEAKER GRANT ARMED · THIS PHONE · {room.grantCountdown}s LEFT — DAEMON&apos;S
          CLAIM MARKER STAYS THE BILLING AUTHORITY
        </div>
      ) : null}
    </div>
  );
}
