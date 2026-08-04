import { useFleet, useRoom } from "./mock/store";
import { ConsoleView } from "./console/ConsoleView";
import { DockMiniBar } from "./console/DockMiniBar";
import { ControlDeck } from "./deck/ControlDeck";
import { FieldView } from "./field/FieldView";
import { HangarView, useFleetKeyboard } from "./hangar/HangarView";
import { RoomSwitcherPalette } from "./hangar/RoomSwitcherPalette";
import { MapDialog } from "./map/MapView";
import { LongRangePlot } from "./plot/LongRangePlot";
import { CribView, MapView, currentRoute } from "./routes";

const route = currentRoute();

export function App() {
  if (route === "field-test") {
    return (
      <>
        <FieldView bare />
        <ControlDeck />
        <MapDialog />
      </>
    );
  }
  if (route === "field") {
    return (
      <>
        <FieldView />
        <ControlDeck />
        <MapDialog />
      </>
    );
  }
  if (route === "crib") {
    return (
      <>
        <CribView />
        <ControlDeck />
        <MapDialog />
      </>
    );
  }
  if (route === "map") {
    return <MapView onClose={() => window.location.assign("/")} />;
  }

  return <ConsoleApp />;
}

function ConsoleApp() {
  const room = useRoom();
  const fleet = useFleet();
  useFleetKeyboard(true);

  const moodClass =
    room.mood === "mic-open"
      ? "mic-open"
      : room.mood === "the-lull"
        ? "the-lull"
        : room.mood === "arrival"
          ? "arrival"
          : "";

  return (
    <div
      className={`proto-app${fleet.zoom === "hangar" ? " proto-app--hangar" : ""}${moodClass ? ` ${moodClass}` : ""}`}
    >
      {fleet.zoom === "hangar" ? (
        <>
          <HangarView />
          <DockMiniBar />
          <ControlDeck />
        </>
      ) : (
        <>
          {room.view === "plot" ? <LongRangePlot /> : <ConsoleView />}

          <ControlDeck />
        </>
      )}
      <RoomSwitcherPalette />
      <MapDialog />
    </div>
  );
}
