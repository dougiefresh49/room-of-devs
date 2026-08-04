import { Keycap, Led, Tag } from "@room/ui/rig";
import { AvatarFace } from "../avatars/AvatarFace";
import { FieldCrtFace } from "../rig-ext/FieldCrtFace";
import { answer } from "../mock/scenario";
import { useRoom } from "../mock/store";
import { CommsLog } from "./CommsLog";

function fmtHold(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function AnswerScreen() {
  const room = useRoom();
  const focus =
    room.crafts.find((c) => c.id === room.focusCraftId) ??
    room.crafts.find((c) => c.id === room.heldQuestion?.craftId) ??
    room.crafts.find((c) => c.state === "needs-you") ??
    room.crafts.find((c) => c.state !== "empty") ??
    null;
  // Only surface the held question when it belongs to the focused craft —
  // tapping another row must not show someone else's keycaps.
  const hq =
    room.heldQuestion && room.heldQuestion.craftId === focus?.id ? room.heldQuestion : null;

  const holding = focus?.state === "needs-you";
  const tailLines = focus
    ? focus.tail.slice(-2).map((line) => ({
        kind: line.kind === "cmd" ? ("cmd" as const) : ("out" as const),
        text: line.text,
      }))
    : [];

  // Talk row + composer live in FieldDock now — one dock for every screen.

  return (
    <div className="screen-body answer-body" data-part="F-02">
      <div className="answer-status">
        {holding && focus ? (
          <Tag tone="red" className="field-tag-sm">
            NEEDS YOU · HELD {fmtHold(focus.holdSeconds)}
          </Tag>
        ) : (
          <Tag tone="dim" className="field-tag-sm">
            ALL QUIET
          </Tag>
        )}
      </div>

      {focus ? (
        <div className={`trow${focus.state === "needs-you" ? " needsyou" : ""}`}>
          <div className="tface">
            <FieldCrtFace size={40} scanlines>
              <AvatarFace persona={focus.persona} size={40} />
            </FieldCrtFace>
          </div>
          <div className="tmid">
            <span className="callsign">{focus.callsign}</span>
            <span className="tid">
              {focus.ticket}
              {focus.tmux ? " · TMUX ✓" : ""}
            </span>
            <div className="ttask">{focus.task}</div>
          </div>
          <Tag tone={holding ? "red" : "dim"}>{holding ? "HELD" : focus.state.toUpperCase()}</Tag>
        </div>
      ) : null}

      {hq ? (
        <CommsLog
          className="field-thread held-question-log"
          rows={[{ who: focus?.callsign ?? "???", text: hq.prompt }]}
          footNote={`/thread/${focus?.ticket ?? "—"} · full history above ▴`}
        />
      ) : null}

      {hq
        ? hq.options.map((opt, i) => (
            <Keycap
              key={opt.id}
              glyph={String(i + 1)}
              label={`${opt.label} — ${opt.detail}`}
              hint={`SAY “${opt.speakHint}”`}
              armed={opt.armed}
              onPress={() => answer(opt.id)}
              className={i === 0 ? "field-opt field-opt-first" : "field-opt"}
            />
          ))
        : null}

      <CommsLog rows={room.transcript} tail={tailLines} />

      {room.grantArmed ? (
        <div className="grantchip">
          <Led tone="green" />
          SPEAKER GRANT ARMED · THIS PHONE · {room.grantCountdown}s LEFT
        </div>
      ) : null}
    </div>
  );
}
