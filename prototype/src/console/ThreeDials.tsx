import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@room/ui";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { setBrainTable, setCeremony, setVoiceDial } from "../mock/scenario";
import { useRoom } from "../mock/store";
import type { BrainTable, GearDefault, PersonaId } from "../mock/types";

const CEREMONY: readonly GearDefault[] = ["bare", "light", "full"];
const VOICE: readonly PersonaId[] = [
  "mikey",
  "donnie",
  "leo",
  "raph",
  "splinter",
  "shredder",
  "karai",
];
const BRAIN: readonly BrainTable[] = ["lean", "std", "deep"];

type DialId = "ceremony" | "voice" | "brain";

interface DialProps<T extends string> {
  id: DialId;
  dialClass: string;
  ariaLabel: string;
  label: string;
  tooltip: string;
  values: readonly T[];
  value: T;
  readout: (value: T) => string;
  hit: boolean;
  onChange: (value: T) => void;
  onHit: () => void;
}

function Dial<T extends string>({
  id,
  dialClass,
  ariaLabel,
  label,
  tooltip,
  values,
  value,
  readout,
  hit,
  onChange,
  onHit,
}: DialProps<T>) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const index = Math.max(0, values.indexOf(value));
  const indexRef = useRef(index);
  const dragRef = useRef<{
    pointerId: number;
    startY: number;
    lastY: number;
    accumulator: number;
  } | null>(null);
  const suppressClickRef = useRef(false);

  useEffect(() => {
    indexRef.current = index;
  }, [index]);

  const setIndex = useCallback(
    (nextIndex: number) => {
      const next = ((nextIndex % values.length) + values.length) % values.length;
      const nextValue = values[next];
      if (nextValue === undefined) return;
      indexRef.current = next;
      onChange(nextValue);
      onHit();
    },
    [onChange, onHit, values],
  );

  const step = useCallback(
    (direction: 1 | -1) => setIndex(indexRef.current + direction),
    [setIndex],
  );

  useEffect(() => {
    const button = buttonRef.current;
    if (!button) return;
    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY === 0 || document.activeElement !== button) return;
      event.preventDefault();
      step(event.deltaY < 0 ? 1 : -1);
    };
    button.addEventListener("wheel", handleWheel, { passive: false });
    return () => button.removeEventListener("wheel", handleWheel);
  }, [step]);

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      lastY: event.clientY,
      accumulator: 0,
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const delta = drag.lastY - event.clientY;
    drag.lastY = event.clientY;
    drag.accumulator += delta;

    while (drag.accumulator >= 18) {
      step(1);
      drag.accumulator -= 18;
    }
    while (drag.accumulator <= -18) {
      step(-1);
      drag.accumulator += 18;
    }
  };

  const finishPointer = (event: PointerEvent<HTMLButtonElement>, cancelled = false) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!cancelled && Math.abs(event.clientY - drag.startY) > 4) {
      suppressClickRef.current = true;
    }
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    switch (event.key) {
      case "ArrowRight":
      case "ArrowUp":
        event.preventDefault();
        step(1);
        break;
      case "ArrowLeft":
      case "ArrowDown":
        event.preventDefault();
        step(-1);
        break;
      case "Home":
        event.preventDefault();
        setIndex(0);
        break;
      case "End":
        event.preventDefault();
        setIndex(values.length - 1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        step(1);
        break;
    }
  };

  const rotation = values.length > 1 ? -52 + index * (104 / (values.length - 1)) : 0;
  const style = { "--dial-rot": `${rotation}deg` } as CSSProperties;

  return (
    <div className={`knob ${dialClass}${hit ? " is-hit" : ""}`}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            ref={buttonRef}
            id={`dial-${id}`}
            type="button"
            className="kface"
            role="slider"
            aria-label={ariaLabel}
            aria-valuemin={0}
            aria-valuemax={values.length - 1}
            aria-valuenow={index}
            aria-valuetext={readout(value)}
            style={style}
            onClick={(event) => {
              if (suppressClickRef.current) {
                suppressClickRef.current = false;
                return;
              }
              step(event.altKey ? -1 : 1);
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={(event) => finishPointer(event)}
            onPointerCancel={(event) => finishPointer(event, true)}
            onKeyDown={onKeyDown}
          />
        </TooltipTrigger>
        <TooltipContent className="dial-tooltip">{tooltip}</TooltipContent>
      </Tooltip>
      <div className="kl">{label}</div>
      <div className="kv">{readout(value)}</div>
    </div>
  );
}

const emptyHits = (): Record<DialId, boolean> => ({
  ceremony: false,
  voice: false,
  brain: false,
});

export function ThreeDials() {
  const room = useRoom();
  const [knobHits, setKnobHits] = useState(emptyHits);
  const [homeHits, setHomeHits] = useState(emptyHits);
  const knobTimers = useRef<Partial<Record<DialId, number>>>({});
  const homeTimers = useRef<Partial<Record<DialId, number>>>({});

  useEffect(
    () => () => {
      Object.values(knobTimers.current).forEach(window.clearTimeout);
      Object.values(homeTimers.current).forEach(window.clearTimeout);
    },
    [],
  );

  const flash = (id: DialId) => {
    const knobTimer = knobTimers.current[id];
    const homeTimer = homeTimers.current[id];
    if (knobTimer) window.clearTimeout(knobTimer);
    if (homeTimer) window.clearTimeout(homeTimer);
    setKnobHits((hits) => ({ ...hits, [id]: true }));
    setHomeHits((hits) => ({ ...hits, [id]: true }));
    knobTimers.current[id] = window.setTimeout(
      () => setKnobHits((hits) => ({ ...hits, [id]: false })),
      160,
    );
    homeTimers.current[id] = window.setTimeout(
      () => setHomeHits((hits) => ({ ...hits, [id]: false })),
      900,
    );
  };

  const callsign = (persona: PersonaId) =>
    room.crew.find((member) => member.id === persona)?.callsign ?? persona.toUpperCase();
  const availableVoices = useMemo(
    () =>
      VOICE.filter(
        (persona) => !room.crew.find((member) => member.id === persona)?.piloting,
      ),
    [room.crew],
  );

  useEffect(() => {
    if (availableVoices.includes(room.dials.voice)) return;
    const fallback = availableVoices[0];
    if (fallback) setVoiceDial(fallback);
  }, [availableVoices, room.dials.voice]);

  return (
    <TooltipProvider delayDuration={180}>
      <div className="instr-plate">
        <span className="screw bl" />
        <span className="screw br" />
        <div className="cap">
          <span>THE THREE DIALS</span>
          <b>TURN TO SET</b>
        </div>
        <div className="knobs">
          <Dial
            id="ceremony"
            dialClass="k1"
            ariaLabel="Dial 1 · Ceremony"
            label="1 · CEREMONY"
            tooltip="CEREMONY · PER THREAD · HOME: THE PLAN CARD — HOW MUCH PROCESS A THREAD RUNS"
            values={CEREMONY}
            value={room.dials.ceremony}
            readout={(value) => value.toUpperCase()}
            hit={knobHits.ceremony}
            onChange={setCeremony}
            onHit={() => flash("ceremony")}
          />
          <Dial
            id="voice"
            dialClass="k2"
            ariaLabel="Dial 2 · Voice"
            label="2 · VOICE"
            tooltip="VOICE · ATTACHMENT · HOME: THE FACEPLATE — WHICH CREW VOICE WEARS THE ROOM"
            values={availableVoices}
            value={room.dials.voice}
            readout={callsign}
            hit={knobHits.voice}
            onChange={setVoiceDial}
            onHit={() => flash("voice")}
          />
          <Dial
            id="brain"
            dialClass="k3"
            ariaLabel="Dial 3 · Brain / Turn"
            label="3 · BRAIN / TURN"
            tooltip="BRAIN / TURN · ROUTING TABLE · HOME: THE TURN CHIP — HOW DEEP THIS TURN RUNS"
            values={BRAIN}
            value={room.dials.brain}
            readout={(value) => value.toUpperCase()}
            hit={knobHits.brain}
            onChange={setBrainTable}
            onHit={() => flash("brain")}
          />
        </div>
        <div className="dial-homes">
          HOMES · <span className={`dhome${homeHits.ceremony ? " is-hit" : ""}`}>PLAN CARD</span>
          <span className="dhome-sep"> · </span>
          <span className={`dhome${homeHits.voice ? " is-hit" : ""}`}>FACEPLATE</span>
          <span className="dhome-sep"> · </span>
          <span className={`dhome${homeHits.brain ? " is-hit" : ""}`}>TURN CHIP</span>
        </div>
      </div>
    </TooltipProvider>
  );
}
