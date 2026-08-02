import { useEffect, useRef } from "react";
import { Keycap, Led, Tag } from "@room/ui/rig";
import { AvatarFace } from "../avatars/AvatarFace";
import { FieldCard } from "../rig-ext/FieldCard";
import { FieldCrtFace } from "../rig-ext/FieldCrtFace";
import { PartNo } from "../map/PartNo";
import { answer } from "../mock/scenario";
import { useRoom } from "../mock/store";

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
    room.heldQuestion && room.heldQuestion.craftId === focus?.id
      ? room.heldQuestion
      : null;

  const holding = focus?.state === "needs-you";
  const tailLines = focus ? focus.tail.slice(-2) : [];
  const threadRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [room.transcript.length, focus?.tail.length]);

  // Talk row + composer live in FieldDock now — one dock for every screen.

  return (
    <div className="screen-body">
      <PartNo partNo="F-02" />
      <div className="fstat" style={{ borderBottom: "none", marginBottom: 4, paddingBottom: 0 }}>
        <span>◂ ROOM</span>
        <span className="spacer" />
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
          <Tag tone={holding ? "red" : "dim"}>
            {holding ? "HELD" : focus.state.toUpperCase()}
          </Tag>
        </div>
      ) : null}

      {hq ? (
        <FieldCard className="vt" style={{ marginTop: 10, padding: 10 }}>
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
        </FieldCard>
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

      <div className="vt field-thread" ref={threadRef}>
        {room.transcript.map((r, i) => (
          <div className="row" key={`${r.who}-${i}-${r.text.slice(0, 12)}`}>
            <span className="who">{r.who === "YOU" ? "YOU" : r.who.slice(0, 3)}</span>
            <span className={`say${r.you ? " you" : ""}`}>{r.text}</span>
          </div>
        ))}
        {tailLines.map((t, i) => (
          <div className="row" key={`t-${t.text.slice(0, 16)}-${i}`}>
            <span className="who">{t.kind === "cmd" ? "▸" : "·"}</span>
            <span
              className="say"
              style={{ color: "var(--amber-dim)", opacity: 0.8 }}
            >
              {t.text}
            </span>
          </div>
        ))}
      </div>

      {room.grantArmed ? (
        <div className="grantchip">
          <Led tone="green" />
          SPEAKER GRANT ARMED · THIS PHONE · {room.grantCountdown}s LEFT
        </div>
      ) : null}
    </div>
  );
}
