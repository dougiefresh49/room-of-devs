import { Led, Tag } from "@room/ui/rig";
import { useFleet, useRoom } from "../mock/store";
import { MastheadTabs } from "./MastheadTabs";
import { ViewMenu } from "./ViewMenu";

export function RigMasthead({ mode, stamp }: { mode: "hangar" | "room"; stamp?: string }) {
  return mode === "hangar" ? <HangarMasthead /> : <RoomMasthead stamp={stamp} />;
}

function HangarMasthead() {
  const fleet = useFleet();
  const numbered = fleet.rooms.filter((berth) => berth.berth != null);
  const scratch = fleet.rooms.filter((berth) => berth.berth == null);

  return (
    <header className="masthead">
      <MastheadTabs />
      <div className="masthead-plate">
        <span className="stn">{"THE HANGAR // ALL ROOMS"}</span>
        <Tag>
          {numbered.length} BERTHS · {scratch.length ? `${scratch.length} SCRATCH` : "SCRATCH COLD"}
        </Tag>
        <span className="spacer" />
      </div>
    </header>
  );
}

function RoomMasthead({ stamp }: { stamp?: string }) {
  const room = useRoom();
  const rungTitle =
    room.view === "plot" ? "LONG-RANGE PLOT" : room.view === "node" ? "NODE" : "MAIN";
  const voiceOn = room.speakingPersona != null;

  return (
    <header className="masthead">
      <MastheadTabs />
      <div className="masthead-plate">
        <span className="stn">{`ROOM CONSOLE // ${rungTitle}`}</span>
        <Tag>{stamp ?? `SNAPSHOT REV ${room.rev}`}</Tag>
        <span className="spacer" />
        <div className="lamps" aria-label="Room connection indicators">
          <span>
            <Led tone="green" title="Daemon on · green" /> DAEMON
          </span>
          <span>
            <Led tone="green" title="WebSocket on · green" /> WS
          </span>
          <span>
            <Led
              tone={voiceOn ? "amber" : "dim"}
              pulse={voiceOn}
              title={`Voice ${voiceOn ? "on · amber" : "off · dim"}`}
            />{" "}
            VOICE
          </span>
          <span>
            <Led
              tone={room.micHot ? "red" : "dim"}
              pulse={room.micHot}
              pulseSpeed="hot"
              title={`Microphone ${room.micHot ? "on · red" : "off · dim"}`}
            />{" "}
            MIC
          </span>
        </div>
        <ViewMenu />
      </div>
    </header>
  );
}
