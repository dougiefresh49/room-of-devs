import { Button } from "@room/ui";
import { RotateCcw, Square } from "lucide-react";
import { replayLastMikey, stopPlayback } from "../mock/scenario";

export function FieldTransport() {
  return (
    <div className="ftransport" aria-label="Global audio transport">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="ftransport-key stopkey"
        aria-label="Stop playback"
        title="STOP"
        onClick={stopPlayback}
      >
        <Square size={14} fill="currentColor" strokeWidth={0} />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="ftransport-key replaykey"
        aria-label="Replay last clip, free"
        title="REPLAY LAST · FREE"
        onClick={replayLastMikey}
      >
        <RotateCcw size={15} />
      </Button>
    </div>
  );
}
