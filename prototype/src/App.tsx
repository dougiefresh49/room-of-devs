import { setView } from "./mock/scenario";
import { useRoom } from "./mock/store";
import { ConsoleView } from "./console/ConsoleView";
import { ControlDeck } from "./deck/ControlDeck";
import { LongRangePlot } from "./plot/LongRangePlot";

export function App() {
  const room = useRoom();
  const moodClass =
    room.mood === "mic-open"
      ? "mic-open"
      : room.mood === "the-lull"
        ? "the-lull"
        : room.mood === "arrival"
          ? "arrival"
          : "";

  return (
    <div className={`proto-app ${moodClass}`.trim()}>
      <div className="haz" style={{ marginBottom: 18 }} />
      <div className="view-switch">
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
              room.focusCraftId ??
              room.crafts.find((c) => c.state !== "empty")?.id ??
              null;
            setView("node", id);
          }}
        >
          NODE
        </button>
        <span className="clock sseg">REV {room.rev} · {room.clock}</span>
      </div>

      {room.view === "plot" ? <LongRangePlot /> : <ConsoleView />}

      <ControlDeck />
    </div>
  );
}
