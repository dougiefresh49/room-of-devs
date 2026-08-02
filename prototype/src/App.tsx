import { setView } from "./mock/scenario";
import { useFleet, useRoom } from "./mock/store";
import { ConsoleView } from "./console/ConsoleView";
import { DockMiniBar } from "./console/DockMiniBar";
import { ControlDeck } from "./deck/ControlDeck";
import { FieldView } from "./field/FieldView";
import { HangarView, useFleetKeyboard } from "./hangar/HangarView";
import { LongRangePlot } from "./plot/LongRangePlot";
import { currentRoute } from "./routes";

const route = currentRoute();

function RoutePlaceholder({ label, phase }: { label: string; phase: string }) {
  return (
    <div className="proto-app">
      <div className="haz" style={{ marginBottom: 18 }} />
      <div className="chassis mainwin route-placeholder">
        <span className="stn">{label}</span>
        <span className="tag">PLACEHOLDER · {phase}</span>
      </div>
      <ControlDeck />
    </div>
  );
}

export function App() {
  const room = useRoom();
  const fleet = useFleet();
  useFleetKeyboard(route === "console");

  if (route === "field") {
    return (
      <>
        <FieldView />
        <ControlDeck />
      </>
    );
  }
  if (route === "crib") {
    return <RoutePlaceholder label="THE TOOL CRIB" phase="ROUND D · PHASE 3" />;
  }
  if (route === "map") {
    return <RoutePlaceholder label="SERVICE SCHEMATIC" phase="ROUND D · PHASE 4" />;
  }

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
      <div className="haz" style={{ marginBottom: 18 }} />
      {fleet.zoom === "hangar" ? (
        <>
          <HangarView />
          <DockMiniBar />
          <ControlDeck />
        </>
      ) : (
        <>
          <div className="view-switch">
            <button type="button" onClick={() => setView("hangar")}>
              HANGAR ⌘0
            </button>
            <button
              type="button"
              className={room.view === "console" || room.view === "node" ? "active" : ""}
              onClick={() => setView("console")}
            >
              CONSOLE / RAIL
            </button>
            <button
              type="button"
              className={room.view === "plot" ? "active" : ""}
              onClick={() => setView("plot")}
            >
              LONG-RANGE PLOT
            </button>
            <button
              type="button"
              className={room.view === "node" ? "active" : ""}
              onClick={() => {
                const id =
                  room.focusCraftId ?? room.crafts.find((c) => c.state !== "empty")?.id ?? null;
                setView("node", id);
              }}
            >
              NODE
            </button>
            <a
              href="/field"
              className={undefined}
              style={{
                font: "inherit",
                fontFamily: "var(--mono)",
                fontSize: 10,
                letterSpacing: ".14em",
                textTransform: "uppercase",
                color: "var(--steel-dim)",
                textDecoration: "none",
                padding: "6px 10px",
                border: "1px solid #3a3f45",
                borderRadius: 4,
              }}
            >
              FIELD ▸
            </a>
            <span className="clock sseg">
              REV {room.rev} · {room.clock}
            </span>
          </div>

          {room.view === "plot" ? <LongRangePlot /> : <ConsoleView />}

          <ControlDeck />
        </>
      )}
    </div>
  );
}
