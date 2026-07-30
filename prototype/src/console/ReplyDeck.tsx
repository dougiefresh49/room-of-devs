import { Keycap, Waveform } from "@room/ui/rig";
import { answer, micClose, micOpen, setComposer } from "../mock/scenario";
import { useRoom } from "../mock/store";

export function ReplyDeck() {
  const room = useRoom();
  const hq = room.heldQuestion;
  const focus =
    room.crafts.find((c) => c.id === room.focusCraftId) ??
    room.crafts.find((c) => c.state === "working");

  return (
    <div className="replydeck">
      <div className="chassis rcard">
        <span className="screw tl" />
        <span className="screw tr" />
        <div className="sc-head">
          <span className="stn">TEXT REPLY → A THREAD</span>
          <span className="tag">TMUX INJECT</span>
        </div>
        <div className="screenbed scr" style={{ minHeight: 0 }}>
          <div className="dimln">
            REPLY // {focus?.ticket ?? "—"} · {focus?.callsign ?? "—"} · BOUND TO
            TICKET
          </div>
          <div className="amberln">
            {focus?.task ?? "No craft selected."}
          </div>
        </div>
        <div className="composer">
          <input
            className="field"
            value={room.composerText}
            placeholder="type an inject…"
            onChange={(e) => setComposer(e.target.value)}
          />
          <button type="button" className="sendkey">
            INJECT ⏎
          </button>
        </div>
        <div className="voicehint">
          SERIALIZED VIA COMMANDPLAN — TWO QUEUED INJECTS NEVER CLOBBER.
        </div>
      </div>

      <div className="chassis rcard">
        <div className="sc-head">
          <span className="stn">VOICE REPLY — PTT + GRANT</span>
          <span className={`tag${room.micHot ? " red" : ""}`}>
            {room.micHot ? "MIC HOT" : "MIC COLD"}
          </span>
        </div>
        <div
          className={`pttbar${room.micHot ? " hot" : ""}`}
          style={{ marginTop: 0 }}
          onPointerDown={() => micOpen()}
          onPointerUp={() => micClose()}
          onPointerLeave={() => {
            if (room.micHot) micClose();
          }}
        >
          <span className="btn" />
          <span className="lbl">
            <b>{room.micHot ? "CAPTURING — RELEASE TO SEND" : "MIC COLD"}</b>
            <br />
            HOLD TO OPEN · NEVER ALWAYS-LISTENING
          </span>
          {room.micHot ? <Waveform active bars={6} /> : null}
        </div>
        {room.grantArmed ? (
          <div className="grantchip">
            <span className="gl" /> SPEAKER GRANT ARMED · MOCK DEVICE ·{" "}
            {room.grantCountdown}s
          </div>
        ) : null}
      </div>

      <div className="chassis rcard">
        <div className="sc-head">
          <span className="stn">HELD-QUESTION KEYCAPS</span>
          <span className="tag">ARMED = MIKEY</span>
        </div>
        {hq ? (
          <div className="screenbed scr">
            <div className="dimln">HELD // {hq.craftId}</div>
            <div className="amberln">{hq.prompt}</div>
            {hq.options.map((o, i) => (
              <Keycap
                key={o.id}
                glyph={String(i + 1)}
                label={`${o.label} — ${o.detail}`}
                hint={`“${o.speakHint}”`}
                armed={o.armed}
                onPress={() => answer(o.id)}
              />
            ))}
            <div className="voicehint">
              OR <b>SPEAK IT</b> FROM THE CONTROL DECK — STT RESOLVES TO OPTION ID.
            </div>
          </div>
        ) : (
          <div className="screenbed scr">
            <div className="dimln">NO HELD QUESTION</div>
            <div className="amberln">Trigger HELD QUESTION from the deck.</div>
          </div>
        )}
      </div>
    </div>
  );
}
