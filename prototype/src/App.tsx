import { setView } from "./mock/scenario";
import { useRoom } from "./mock/store";
import { ConsoleView } from "./console/ConsoleView";
import { ControlDeck } from "./deck/ControlDeck";
import { FieldView } from "./field/FieldView";
import { LongRangePlot } from "./plot/LongRangePlot";

const isField =
  typeof window !== "undefined" &&
  window.location.pathname.startsWith("/field");

export function App() {
  const room = useRoom();

  if (isField) {
    return (
      <>
        <FieldView />
        <ControlDeck />
      </>
    );
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
        <span className="clock sseg">REV {room.rev} · {room.clock}</span>
      </div>

      {room.view === "plot" ? <LongRangePlot /> : <ConsoleView />}

      <ControlDeck />
    </div>
  );
}
