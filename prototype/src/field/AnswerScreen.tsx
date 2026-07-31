import { useEffect, useRef, useState } from "react";
import { AvatarFace } from "../avatars/AvatarFace";
import {
  answer,
  injectReply,
  setComposer,
} from "../mock/scenario";
import { useRoom } from "../mock/store";
import { PttPill } from "./PttPill";

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

  // Composer is hidden until the chat key is tapped; opening focuses the input
  // immediately so typing can start without a second tap.
  const [typing, setTyping] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (typing) inputRef.current?.focus();
  }, [typing]);

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
      ) : null}

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
          <span className="gl" />
          SPEAKER GRANT ARMED · THIS PHONE · {room.grantCountdown}s LEFT
        </div>
      ) : null}

      {/* Default: hold-to-talk + chat key. Tapping chat slides the composer up
          from the bottom and hides this row until it collapses again. */}
      <div className={`talkrow${typing ? " gone" : ""}`} aria-hidden={typing}>
        <PttPill compact style={{ flex: 1 }} />
        <button
          type="button"
          className="chatkey"
          aria-label="Type a reply"
          title="TYPE IT"
          tabIndex={typing ? -1 : 0}
          onClick={() => setTyping(true)}
        >
          <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden>
            <path
              d="M3 5.5A1.5 1.5 0 0 1 4.5 4h11A1.5 1.5 0 0 1 17 5.5v7a1.5 1.5 0 0 1-1.5 1.5H8l-4 3v-3H4.5A1.5 1.5 0 0 1 3 12.5z"
              fill="none"
              stroke="var(--amber)"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      <div className={`composer-slot${typing ? " open" : ""}`}>
        <div className="composer-slide">
          <div className="composer">
            <button
              type="button"
              className="closekey"
              aria-label="Close composer"
              title="CLOSE"
              tabIndex={typing ? 0 : -1}
              onClick={() => {
                setComposer("");
                setTyping(false);
              }}
            >
              ✕
            </button>
            <input
              ref={inputRef}
              className="field"
              value={room.composerText}
              placeholder="type it — lands as a tmux inject"
              tabIndex={typing ? 0 : -1}
              onChange={(e) => setComposer(e.target.value)}
              onBlur={() => {
                if (!room.composerText.trim()) setTyping(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  setComposer("");
                  setTyping(false);
                }
                if (e.key === "Enter") {
                  e.preventDefault();
                  injectReply(room.composerText);
                }
              }}
            />
            <button
              type="button"
              className="sendkey"
              aria-label="Inject reply"
              title="INJECT"
              tabIndex={typing ? 0 : -1}
              onClick={() => injectReply(room.composerText)}
            >
              <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden>
                <path
                  d="M8 13.5V3.5M4 7.5l4-4 4 4"
                  stroke="#181206"
                  strokeWidth="2.1"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
