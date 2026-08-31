import { Sheet, SheetContent, SheetTitle } from "@room/ui";
import { Keycap, Tag } from "@room/ui/rig";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { AvatarFace } from "../avatars/AvatarFace";
import { answer, focusCraftForAnswer } from "../mock/scenario";
import { useRoom } from "../mock/store";
import { FieldCrtFace } from "../rig-ext/FieldCrtFace";
import { useHeldSeconds } from "./useHeldSeconds";

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
  const [showFull, setShowFull] = useState(false);
  // Captured question-form height: the sheet never gets SMALLER on OPEN FULL NODE.
  const [minHeight, setMinHeight] = useState<number | null>(null);
  const closeFinished = useRef(false);
  const pullStart = useRef<{ x: number; y: number } | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const heldSeconds = useHeldSeconds(question?.heldSince ?? null, craft?.holdSeconds ?? 0);

  const finishClose = useCallback(() => {
    if (closeFinished.current) return;
    closeFinished.current = true;
    onAfterClose();
  }, [onAfterClose]);

  useEffect(() => {
    if (open) {
      closeFinished.current = false;
      setShowFull(false);
      setMinHeight(null);
      return;
    }
    const fallback = window.setTimeout(finishClose, 240);
    return () => window.clearTimeout(fallback);
  }, [finishClose, open]);

  // Each direction remounts the scroll body; the frame reset catches the
  // post-layout height change as well as the immediate content swap.
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    body.scrollTop = 0;
    const frame = window.requestAnimationFrame(() => {
      if (bodyRef.current) bodyRef.current.scrollTop = 0;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [showFull]);

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
  const stateLabel = held ? `HELD ${fmtHold(heldSeconds)}` : settled ? "SETTLED" : "WORKING";
  const stateTone = held ? "red" : settled ? "green" : "amber";
  const questionOnly = question != null && !showFull;

  const openFull = (event: MouseEvent<HTMLButtonElement>) => {
    const sheet = event.currentTarget.closest<HTMLElement>(".field-nodesheet");
    setMinHeight(sheet ? Math.ceil(sheet.getBoundingClientRect().height) : null);
    setShowFull(true);
  };

  const chooseAnswer = (optionId: string) => {
    answer(optionId);
    onAnswered();
  };

  const answerKeycaps = (compact = false) =>
    question?.options.map((option, index) => (
      <Keycap
        key={option.id}
        glyph={String(index + 1)}
        label={option.label}
        hint={`SAY “${option.speakHint}”`}
        armed={option.armed}
        onPress={() => chooseAnswer(option.id)}
        className={`nodesheet-keycap${compact ? " is-compact" : ""}`}
      />
    ));

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
        className={`screenbed field-nodesheet field-sheet-open${questionOnly ? "" : " is-full"}${open ? "" : " is-closing"}`}
        overlayClassName={`field-sheet-overlay${open ? "" : " is-closing"}`}
        style={minHeight != null && !questionOnly ? { minHeight } : undefined}
        aria-modal="true"
        onCloseAutoFocus={(event) => event.preventDefault()}
        onAnimationEnd={(event) => {
          if (event.target === event.currentTarget && !open) finishClose();
        }}
      >
        <button
          type="button"
          className="nodesheet-pull"
          aria-label="Close node"
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
              <span>
                {craft.ticket} · TMUX {craft.tmux ? "✓" : "—"} · {fmtClear(craft.salienceDelta)} CLR
              </span>
            </div>
            <div className="nodesheet-state">
              <Tag tone={stateTone}>{stateLabel}</Tag>
              <button type="button" className="nodesheet-disengage" onClick={onRequestClose}>
                CLOSE ▾
              </button>
            </div>
          </div>
          {!questionOnly ? <p className="nodesheet-task">{craft.task}</p> : null}
        </header>

        <div key={showFull ? "full" : "question"} ref={bodyRef} className="nodesheet-body">
          {questionOnly && question ? (
            <section className="nodesheet-answer" aria-label="Held question answers">
              <p>{question.prompt}</p>
              {answerKeycaps()}
              <button type="button" className="nodesheet-open-full" onClick={openFull}>
                OPEN FULL NODE ▸
              </button>
            </section>
          ) : null}

          {!questionOnly ? (
            <section className="nodesheet-context">
              {question ? (
                <button type="button" className="nodesheet-back" onClick={() => setShowFull(false)}>
                  ◂ BACK TO QUESTION
                </button>
              ) : null}
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
                <span className="nodesheet-board-status">ON THE BIG BOARD</span>
              </div>
            </section>
          ) : null}
        </div>

        {showFull && question ? (
          <section className="nodesheet-answerbar" aria-label="Held question answers">
            {answerKeycaps(true)}
          </section>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
