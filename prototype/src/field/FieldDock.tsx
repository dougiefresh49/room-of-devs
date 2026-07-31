import { useEffect, useRef, useState } from "react";
import { AvatarFace } from "../avatars/AvatarFace";
import {
  injectReply,
  replayLastMikey,
  setComposer,
  stopPlayback,
} from "../mock/scenario";
import { useRoom } from "../mock/store";
import { PttPill } from "./PttPill";

/** STOP + REPLAY — only on LISTEN, where there is playback to interrupt. */
function TransportKeys() {
  return (
    <>
      <button
        type="button"
        className="stopkey"
        aria-label="Stop playback"
        title="STOP"
        onClick={() => stopPlayback()}
      >
        <span className="sq" />
      </button>
      <button
        type="button"
        className="replaykey"
        aria-label="Replay last clip (free)"
        title="REPLAY LAST · FREE"
        onClick={() => replayLastMikey()}
      >
        <svg
          viewBox="0 0 20 20"
          width="20"
          height="20"
          aria-hidden
          style={{ transform: "scaleX(-1)" }}
        >
          <path
            d="M14.5 6.5 A6 6 0 1 0 16 10"
            stroke="var(--amber)"
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
          />
          <path d="M14.8 2.6 L14.8 7.2 L10.2 7.2 Z" fill="var(--amber)" />
        </svg>
      </button>
    </>
  );
}

/**
 * The one place you talk to the room: "text or speak it", on every screen.
 *
 * Collapsed — avatar chip · [ chat | HOLD TO TALK ] as ONE capsule: both
 *             segments do the same job (get words into the room), so they
 *             read as one segmented control, not two loose buttons.
 * Expanded  — the keys give way to a composer that slides up from the bottom,
 *             with the face chip docked to its top-left corner (comms card).
 *
 * `listen` swaps in the playback transport keys and shrinks the PTT to a mic
 * key so STOP · REPLAY · CHAT · MIC all fit one row; the big faceplate above
 * already carries the identity there, so the chip is dropped.
 */
export function FieldDock({ listen = false }: { listen?: boolean }) {
  const room = useRoom();

  // Composer is hidden until the chat key is tapped; opening focuses the input
  // immediately so typing can start without a second tap.
  const [typing, setTyping] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (typing) inputRef.current?.focus();
  }, [typing]);

  const showChip = !listen;

  return (
    <div className={`fdock${typing ? " typing" : ""}`}>
      <div className="fdock-row">
        {showChip ? (
          <div className="mface">
            <div className="face-crt">
              <AvatarFace
                persona={
                  room.speakingPersona ??
                  (room.donnieCheckout ? "donnie" : "mikey")
                }
                mode={
                  room.speakingPersona
                    ? "speaking"
                    : room.mood === "the-lull"
                      ? "stoked"
                      : "idle"
                }
                size={52}
              />
            </div>
          </div>
        ) : null}

        <div className="fdock-keys" aria-hidden={typing}>
          {listen ? <TransportKeys /> : null}
          {/* Type it OR say it — one segmented control, because it is one
              decision: how do these words reach the room? */}
          <div
            className="talkgroup"
            role="group"
            aria-label="Send words to the room"
          >
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
            <span className="tgdiv" aria-hidden />
            <PttPill compact={!listen} icon={listen} />
          </div>
        </div>
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
