import { Sheet, SheetContent, SheetTitle } from "@room/ui";
import { Keycap, Tag } from "@room/ui/rig";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { AvatarFace } from "../avatars/AvatarFace";
import { answer, focusCraftForAnswer } from "../mock/scenario";
import { useRoom } from "../mock/store";
import { FieldCrtFace } from "../rig-ext/FieldCrtFace";

function fmtHold(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function fmtClear(value: number): string {
  return value < 0 ? `−${Math.abs(value)}` : `+${value}`;
}

interface NodeSheetProps {
  craftId: string;
  open: boolean;
  onRequestClose: () => void;
  onAfterClose: () => void;
  onAnswered: () => void;
}

export function NodeSheet({
  craftId,
  open,
  onRequestClose,
  onAfterClose,
  onAnswered,
}: NodeSheetProps) {
  const room = useRoom();
  const craft = room.crafts.find((item) => item.id === craftId);
  const question = room.heldQuestion?.craftId === craftId ? room.heldQuestion : null;
  const closeFinished = useRef(false);
  const pullStart = useRef<{ x: number; y: number } | null>(null);

  const finishClose = useCallback(() => {
    if (closeFinished.current) return;
    closeFinished.current = true;
    onAfterClose();
  }, [onAfterClose]);

  useEffect(() => {
    if (open) {
      closeFinished.current = false;
      return;
    }
    const fallback = window.setTimeout(finishClose, 240);
    return () => window.clearTimeout(fallback);
  }, [finishClose, open]);

  useLayoutEffect(() => {
    focusCraftForAnswer(craftId);
    const setBounds = () => {
      const rect = document.querySelector(".field-root .fscr")?.getBoundingClientRect();
      if (!rect) return;
      const root = document.documentElement;
      root.style.setProperty("--field-screen-left", `${rect.left}px`);
      root.style.setProperty("--field-screen-top", `${rect.top}px`);
      root.style.setProperty("--field-screen-width", `${rect.width}px`);
      root.style.setProperty("--field-screen-height", `${rect.height}px`);
      root.style.setProperty("--field-screen-bottom", `${window.innerHeight - rect.bottom}px`);
    };
    setBounds();
    window.addEventListener("resize", setBounds);
    window.addEventListener("scroll", setBounds, true);
    const screen = document.querySelector(".field-root .fscr");
    const observer = screen && "ResizeObserver" in window ? new ResizeObserver(setBounds) : null;
    if (screen) observer?.observe(screen);
    return () => {
      window.removeEventListener("resize", setBounds);
      window.removeEventListener("scroll", setBounds, true);
      observer?.disconnect();
    };
  }, [craftId]);

  if (!craft) return null;

  const held = craft.state === "needs-you";
  const settled = craft.state === "settled";
  const stateLabel = held ? `HELD ${fmtHold(craft.holdSeconds)}` : settled ? "SETTLED" : "WORKING";
  const stateTone = held ? "red" : settled ? "green" : "amber";

  return (
    <Sheet
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onRequestClose();
      }}
    >
      <SheetContent
        side="bottom"
        showClose={false}
        className={`screenbed field-nodesheet ${held ? "is-held" : "is-short"}${open ? "" : " is-closing"}`}
        overlayClassName={`field-sheet-overlay${open ? "" : " is-closing"}`}
        aria-modal="true"
        onCloseAutoFocus={(event) => event.preventDefault()}
        onAnimationEnd={(event) => {
          if (event.target === event.currentTarget && !open) finishClose();
        }}
      >
        <button
          type="button"
          className="nodesheet-pull"
          aria-label="Disengage and close node"
          onPointerDown={(event) => {
            pullStart.current = { x: event.clientX, y: event.clientY };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerUp={(event) => {
            const start = pullStart.current;
            pullStart.current = null;
            if (!start) return;
            const dx = event.clientX - start.x;
            const dy = event.clientY - start.y;
            if (dy > 40 || Math.hypot(dx, dy) <= 8) onRequestClose();
          }}
          onPointerCancel={() => {
            pullStart.current = null;
          }}
          onClick={(event) => {
            // Keyboard activation has detail 0; pointer taps are handled above
            // so a drag's synthetic click cannot accidentally close the sheet.
            if (event.detail === 0) onRequestClose();
          }}
        >
          <span aria-hidden />
        </button>

        <header className="nodesheet-head">
          <div className="nodesheet-identity">
            <FieldCrtFace size={56} scanlines>
              <AvatarFace persona={craft.persona} size={56} />
            </FieldCrtFace>
            <div className="nodesheet-idcopy">
              <SheetTitle>{craft.callsign}</SheetTitle>
              <span>{craft.ticket} · TMUX {craft.tmux ? "✓" : "—"} · {fmtClear(craft.salienceDelta)} CLR</span>
            </div>
            <div className="nodesheet-state">
              <Tag tone={stateTone}>{stateLabel}</Tag>
              <button type="button" className="nodesheet-disengage" onClick={onRequestClose}>
                DISENGAGE ▾
              </button>
            </div>
          </div>
          <p className="nodesheet-task">{craft.task}</p>
        </header>

        {question ? (
          <section className="nodesheet-answer" aria-label="Held question answers">
            <p>{question.prompt}</p>
            {question.options.map((option, index) => (
              <Keycap
                key={option.id}
                glyph={String(index + 1)}
                label={option.label}
                hint={`SAY “${option.speakHint}”`}
                armed={option.armed}
                onPress={() => {
                  answer(option.id);
                  onAnswered();
                }}
                className="nodesheet-keycap"
              />
            ))}
          </section>
        ) : null}

        <section className="nodesheet-context">
          <div className="nodesheet-cap">LIVE TAIL</div>
          <div className="nodesheet-tail">
            {craft.tail.slice(-4).map((line, index) => (
              <div key={`${line.kind}-${line.text}-${index}`}>
                <span aria-hidden>{line.kind === "cmd" ? "▸" : "·"}</span>
                {line.text}
              </div>
            ))}
          </div>
          <div className="nodesheet-spend">
            {`${(craft.tokens / 1000).toFixed(1)}k TOK · $${craft.spendUsd.toFixed(2)} · ${craft.turns} TURNS`}
          </div>
          <div className="nodesheet-diff">
            <b>DIFF · {craft.diff ? "3 FILES" : "NO PATCH YET"}</b>
            <span>ON THE BIG BOARD ▸</span>
          </div>
        </section>
        <div className="field-root nodesheet-composer-mount" />
      </SheetContent>
    </Sheet>
  );
}
