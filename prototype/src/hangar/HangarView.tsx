import { Toaster } from "@room/ui";
import { CutFrame, Keycap, Tag } from "@room/ui/rig";
import { useEffect } from "react";
import { coupleRoom, setView } from "../mock/scenario";
import { getFleet, getRoom, openCommission, useAppState, useFleet } from "../mock/store";
import { BerthCard } from "./BerthCard";
import { BerthTabs } from "./BerthTabs";
import { CommissioningBay } from "./commission/CommissioningBay";
import { FloorBus } from "./FloorBus";
import { RoomSwitcherPalette } from "./RoomSwitcherPalette";
import { TrafficStrip } from "./TrafficStrip";

function isEditable(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  return Boolean(
    element &&
      (element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.isContentEditable),
  );
}

export function useFleetKeyboard(enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (isEditable(event.target)) return;
      if (event.metaKey && /^\d$/.test(event.key)) {
        event.preventDefault();
        if (event.key === "0") {
          setView("hangar");
          return;
        }
        const berthNumber = Number(event.key);
        const berth = getFleet().rooms.find((room) => room.berth === berthNumber);
        if (berth) coupleRoom(berth.id);
        return;
      }
      if (event.key !== "Escape") return;
      if (document.querySelector("[data-slot='dialog-content']")) return;
      const fleet = getFleet();
      if (fleet.zoom === "hangar") return;
      event.preventDefault();
      const room = getRoom();
      if (room.view === "node") setView("console");
      else if (room.view === "console") setView("plot");
      else setView("hangar");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}

export function HangarView() {
  const fleet = useFleet();
  const app = useAppState();
  const numbered = fleet.rooms
    .filter((room) => room.berth != null)
    .sort((a, b) => (a.berth ?? 0) - (b.berth ?? 0));
  const scratch = fleet.rooms.filter((room) => room.berth == null);

  return (
    <>
      <CutFrame
        scale="l"
        glow="0 14px 32px rgba(0,0,0,.58)"
        className="hangar-frame"
        innerClassName="hangar-shell"
      >
        <span className="screw tl" />
        <span className="screw tr" />
        <span className="screw bl" />
        <span className="screw br" />
        <header className="hangar-header">
          <div className="hangar-title">
            <span>{"THE HANGAR // ALL ROOMS"}</span>
            <Tag>
              {numbered.length} BERTHS ·{" "}
              {scratch.length ? `${scratch.length} SCRATCH` : "SCRATCH COLD"}
            </Tag>
          </div>
          <BerthTabs compact />
          <Keycap
            glyph="+"
            label="COMMISSION A ROOM"
            className="commission-entry-key"
            onPress={() => openCommission("rig")}
          />
          <nav className="hangar-ladder" aria-label="Zoom ladder">
            <b>HANGAR</b>
            <span>▸ PLOT ▸ RAIL ▸ NODE · ESC · ⌘K</span>
          </nav>
        </header>

        {fleet.commission ? (
          <CommissioningBay />
        ) : (
          <>
            <TrafficStrip fleet={fleet} />
            <div className={`hangar-grid${scratch.length > 1 ? " hangar-grid--multi-scratch" : ""}`}>
              <FloorBus
                audioFloor={fleet.audioFloor}
                rooms={numbered}
                holderSpeaking={Boolean(
                  fleet.audioFloor.roomId &&
                    app.rooms[fleet.audioFloor.roomId]?.speakingPersona ===
                      fleet.audioFloor.persona,
                )}
              />
              {numbered.map((berth) => (
                <BerthCard
                  key={berth.id}
                  berth={berth}
                  audioFloor={fleet.audioFloor}
                  threshold={fleet.threshold}
                  onCouple={() => coupleRoom(berth.id)}
                />
              ))}
              {scratch.map((berth) => (
                <BerthCard
                  key={berth.id}
                  berth={berth}
                  audioFloor={fleet.audioFloor}
                  threshold={fleet.threshold}
                />
              ))}
              <BerthCard berth={null} audioFloor={fleet.audioFloor} threshold={fleet.threshold} />
            </div>
          </>
        )}
      </CutFrame>
      <Toaster position="top-right" closeButton />
      <RoomSwitcherPalette />
    </>
  );
}
