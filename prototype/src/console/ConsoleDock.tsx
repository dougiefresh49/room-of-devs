import { Button } from "@room/ui";
import { useEffect, useRef, useState } from "react";
import { micClose, micOpen, sendMikeyChat } from "../mock/scenario";
import { useRoom } from "../mock/store";

export function ConsoleDock() {
  const room = useRoom();
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (typing) inputRef.current?.focus();
  }, [typing]);

  const close = () => {
    setDraft("");
    setTyping(false);
  };
  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    sendMikeyChat(text);
    setDraft("");
  };

  return (
    <div className={`cdock${typing ? " typing" : ""}`}>
      <div className="cdock-keys" aria-hidden={typing} inert={typing ? true : undefined}>
        <fieldset className={`talkgroup${room.micHot ? " hot" : ""}`}>
          <legend className="visually-hidden">Send words to Mikey</legend>
          <Button
            type="button"
            variant="ghost"
            className="chatkey"
            aria-label="Type a message to Mikey"
            title="TYPE IT"
            tabIndex={typing ? -1 : 0}
            onClick={() => setTyping(true)}
          >
            <span className="chatglyph" aria-hidden>
              ⌨
            </span>
            <span>TYPE IT</span>
          </Button>
          <span className="tgdiv" aria-hidden />
          <button
            type="button"
            className="cdock-ptt"
            tabIndex={typing ? -1 : 0}
            onPointerDown={() => micOpen()}
            onPointerUp={() => micClose()}
            onPointerLeave={() => {
              if (room.micHot) micClose();
            }}
          >
            <span className="btn" />
            <span className="lbl">
              <b>{room.micHot ? "CAPTURING — RELEASE TO SEND" : "HOLD TO TALK"}</b>
              <span>{room.micHot ? "RELEASE SPACE / HW KEY" : "SPACE / HW KEY"}</span>
            </span>
          </button>
        </fieldset>
      </div>
      <div
        className={`composer-slot${typing ? " open" : ""}`}
        aria-hidden={!typing}
        inert={typing ? undefined : true}
      >
        <div className="composer-slide">
          <form
            className="composer"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="closekey"
              aria-label="Close composer"
              tabIndex={typing ? 0 : -1}
              onClick={close}
            >
              ✕
            </Button>
            <input
              ref={inputRef}
              className="field"
              value={draft}
              placeholder="message Mikey…"
              aria-label="Message Mikey"
              tabIndex={typing ? 0 : -1}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={() => {
                if (!draft.trim()) setTyping(false);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  close();
                }
              }}
            />
            <Button
              type="submit"
              variant="default"
              size="icon"
              className="sendkey"
              aria-label="Send message"
              title="SEND"
              tabIndex={typing ? 0 : -1}
              disabled={!draft.trim()}
            >
              ⏎
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
