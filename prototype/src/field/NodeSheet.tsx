import { Button, Sheet, SheetContent, SheetDescription, SheetTitle } from "@room/ui";
import { Keycap, Tag } from "@room/ui/rig";
import { MessageSquare, X } from "lucide-react";
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

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onRequestClose();
      }}
    >
      <SheetContent
        side="bottom"
        showClose={false}
        className={`screenbed field-nodesheet${open ? "" : " is-closing"}`}
        overlayClassName={`field-sheet-overlay${open ? "" : " is-closing"}`}
        aria-modal="true"
        onCloseAutoFocus={(event) => event.preventDefault()}
        onAnimationEnd={(event) => {
          if (event.target === event.currentTarget && !open) finishClose();
        }}
      >
        <header className="nodesheet-head">
          <FieldCrtFace size={42} scanlines>
            <AvatarFace persona={craft.persona} size={42} />
          </FieldCrtFace>
          <div>
            <SheetTitle>
              {craft.callsign} · {craft.ticket}
            </SheetTitle>
            <SheetDescription>{craft.task}</SheetDescription>
            <span>
              {craft.state === "needs-you"
                ? `HELD ${fmtHold(craft.holdSeconds)}`
                : craft.state.toUpperCase()}
              {` · TMUX ${craft.tmux ? "✓" : "—"} · ${craft.salienceDelta} CLR`}
            </span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="nodesheet-x"
            aria-label="Close node"
            onClick={onRequestClose}
          >
            <X size={17} />
          </Button>
        </header>

        {question ? (
          <section className="nodesheet-answer" aria-label="Held question answers">
            <p>{question.prompt}</p>
            {question.options.map((option, index) => (
              <Keycap
                key={option.id}
                glyph={String(index + 1)}
                label={`${option.label} — ${option.detail}`}
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
          <button
            type="button"
            className="nodesheet-reply"
            onClick={() => window.dispatchEvent(new Event("field:focus-composer"))}
          >
            <MessageSquare size={14} /> REPLY TO {craft.callsign}
          </button>
          {question ? <Tag tone="red">QUESTION HELD UNTIL ANSWERED</Tag> : null}
        </section>
        <div className="field-root nodesheet-composer-mount" />
      </SheetContent>
    </Sheet>
  );
}
