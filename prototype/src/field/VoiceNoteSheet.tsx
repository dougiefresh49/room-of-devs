import { Sheet, SheetContent, SheetTitle } from "@room/ui";
import { Tag, Waveform } from "@room/ui/rig";
import { Mic, MicOff, Play, RotateCcw, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { sendVoiceChat } from "../mock/scenario";

type VoiceState = "unavailable" | "idle" | "recording" | "preview";

function durationLabel(seconds: number): string {
  return `00:${String(seconds).padStart(2, "0")}`;
}

export function VoiceNoteSheet({
  open,
  onOpenChange,
  onTypeInstead,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTypeInstead: () => void;
}) {
  const [state, setState] = useState<VoiceState>("unavailable");
  const [seconds, setSeconds] = useState(0);
  const focusComposerOnClose = useRef(false);
  const canPreview =
    import.meta.env.DEV && window.localStorage.getItem("rig.field.mockmic") === "1";

  useEffect(() => {
    if (open) {
      setState("unavailable");
      setSeconds(0);
    }
  }, [open]);

  useEffect(() => {
    if (state !== "recording") return;
    const interval = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(interval);
  }, [state]);

  const mock = state !== "unavailable";
  const restart = () => {
    setSeconds(0);
    setState("recording");
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showClose={false}
        className="screenbed field-bounds-sheet field-voicesheet field-sheet-open"
        overlayClassName="field-sheet-overlay"
        onCloseAutoFocus={(event) => {
          if (!focusComposerOnClose.current) return;
          focusComposerOnClose.current = false;
          event.preventDefault();
        }}
      >
        <button
          type="button"
          className="nodesheet-pull"
          aria-label="Close voice reply"
          onClick={() => onOpenChange(false)}
        >
          <span aria-hidden />
        </button>
        <SheetTitle className="visually-hidden">Voice reply</SheetTitle>
        <div className="fvoice-cap">VOICE REPLY</div>
        {mock ? (
          <Tag tone="dim" className="fvoice-mock-tag">
            MOCK
          </Tag>
        ) : null}

        {state === "unavailable" ? (
          <div className="fvoice-unavailable">
            <MicOff size={34} aria-hidden />
            <b>NO MIC ON THIS HANDSET</b>
            <p>
              The RIG doesn&apos;t capture audio from the phone. Type it and Mikey speaks for you.
            </p>
            <button
              type="button"
              className="fvoice-type"
              onClick={() => {
                focusComposerOnClose.current = true;
                onTypeInstead();
              }}
            >
              TYPE IT INSTEAD
            </button>
            {canPreview ? (
              <button
                type="button"
                className="fvoice-preview-link"
                onClick={() => setState("idle")}
              >
                PREVIEW THE RECORDER (MOCK)
              </button>
            ) : null}
          </div>
        ) : (
          <div className="fvoice-mock">
            {state === "idle" ? (
              <>
                <div className="fvoice-icon-well">
                  <Mic size={34} aria-hidden />
                </div>
                <b className="fvoice-state-label">TAP TO RECORD</b>
              </>
            ) : state === "recording" ? (
              <>
                <div className="fvoice-timer">
                  <i aria-hidden />
                  <b className="sseg">{durationLabel(seconds)}</b>
                </div>
                <Waveform active bars={28} />
                <span className="fvoice-level-caption">MOCK LEVELS · NOT A MIC</span>
              </>
            ) : (
              <div className="fvoice-playback">
                <button type="button" aria-label="Preview mock voice note">
                  <Play size={18} fill="currentColor" />
                </button>
                <Waveform active={false} bars={20} />
                <b className="sseg">{durationLabel(seconds)}</b>
              </div>
            )}

            <div className="fvoice-actions">
              <button
                type="button"
                onClick={state === "idle" ? () => onOpenChange(false) : restart}
              >
                {state === "idle" ? (
                  <>
                    <X size={15} /> CANCEL
                  </>
                ) : (
                  <>
                    <RotateCcw size={15} /> RESTART
                  </>
                )}
              </button>
              <button
                type="button"
                className={`fvoice-record${state === "recording" ? " is-recording" : ""}`}
                aria-label={state === "recording" ? "Stop mock recording" : "Start mock recording"}
                onClick={() => {
                  if (state === "recording") setState("preview");
                  else if (state !== "preview") restart();
                }}
              >
                {state === "recording" ? (
                  <Square size={22} fill="currentColor" />
                ) : (
                  <Mic size={24} />
                )}
              </button>
              <button
                type="button"
                className={state === "preview" ? "is-enabled" : undefined}
                disabled={state !== "preview"}
                onClick={() => {
                  sendVoiceChat(`[voice note · 0:${String(seconds).padStart(2, "0")} · mock]`);
                  onOpenChange(false);
                }}
              >
                ✓ ATTACH
              </button>
            </div>
            <div className="fvoice-foot">NO AUDIO IS CAPTURED OR SENT · MOCK ONLY</div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
