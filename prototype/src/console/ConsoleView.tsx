import { Led } from "@room/ui/rig";
import { CrewManifest } from "./CrewManifest";
import { DockMiniBar } from "./DockMiniBar";
import { DonnieBay, Faceplate } from "./Faceplate";
import { ReplyDeck } from "./ReplyDeck";
import { SalienceRing } from "./SalienceRing";
import { SpineRail } from "./SpineRail";
import { TheCore } from "./TheCore";
import { ThreadNode } from "./ThreadNode";
import { TurnChip } from "./TurnChip";
import { VerbRack } from "./VerbRack";
import { WatchChips } from "./WatchChips";
import { useRoom } from "../mock/store";
import { BerthTabs } from "../hangar/BerthTabs";

export function ConsoleView() {
  const room = useRoom();

  if (room.view === "node") {
    const craft =
      room.crafts.find((c) => c.id === room.focusCraftId) ??
      room.crafts.find((c) => c.state !== "empty");
    return (
      <div className="chassis mainwin">
        <div className="titlebar">
          <span className="stn">ROOM CONSOLE // NODE</span>
          <span className="tag">ZOOM 3 · HARD CUT</span>
          <BerthTabs compact />
          <span className="spacer" />
          <span className="sseg" style={{ fontSize: 11 }}>
            {craft?.ticket ?? "—"}
          </span>
        </div>
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          {craft ? <ThreadNode craft={{ ...craft, open: true }} /> : null}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="chassis mainwin">
        <span className="screw tl" />
        <span className="screw tr" />
        <span className="screw bl" />
        <span className="screw br" />
        <div className="titlebar">
          <span className="stn">ROOM CONSOLE // MAIN</span>
          <span className="tag">SNAPSHOT REV {room.rev}</span>
          <BerthTabs compact />
          <span className="spacer" />
          <div className="lamps">
            <span>
              <Led tone="green" /> DAEMON
            </span>
            <span>
              <Led tone="green" /> WS
            </span>
            <span>
              <Led tone="amber" pulse={room.speakingPersona != null} /> VOICE
            </span>
            <span>
              <Led tone={room.micHot ? "red" : "dim"} pulse={room.micHot} pulseSpeed="hot" /> MIC
            </span>
            <span className="sseg" style={{ fontSize: 11 }}>
              {room.clock}
            </span>
          </div>
        </div>

        <div className="cols">
          <div>
            <Faceplate />
            <div className="screenbed vt">
              {room.transcript.slice(-4).map((r, i) => (
                <div className="row" key={i}>
                  <span className="who">{r.who}</span>
                  <span className={`say${r.you ? " you" : ""}`}>
                    {r.text}
                    {i === room.transcript.slice(-4).length - 1 &&
                    room.speakingPersona === "mikey" ? (
                      <span className="cursor" />
                    ) : null}
                  </span>
                </div>
              ))}
              <WatchChips />
              <TurnChip />
            </div>
            <DonnieBay />
            <div className={`pttbar${room.micHot ? " hot" : ""}`}>
              <span className="btn" />
              <span className="lbl">
                <b>{room.micHot ? "CAPTURING" : "MIC COLD"}</b>
                <br />
                HOLD SPACE OR HW KEY TO OPEN · NEVER ALWAYS-LISTENING
              </span>
            </div>
          </div>

          <SpineRail />

          <div className="instr">
            <SalienceRing />
            <TheCore />
            <div className="chassis gaugebox">
              <span className="screw bl" />
              <span className="screw br" />
              <div className="cap">
                <span>THE THREE DIALS</span>
                <b>EACH LIVES SOMEWHERE VISIBLE</b>
              </div>
              <div className="knobs">
                <div className="knob k1">
                  <div className="kface" />
                  <div className="kl">1 · CEREMONY</div>
                  <div className="kv">FULL</div>
                  <div className="khome">
                    PER THREAD · <b>HOME: THE PLAN CARD</b>
                  </div>
                </div>
                <div className="knob k2">
                  <div className="kface" />
                  <div className="kl">2 · VOICE</div>
                  <div className="kv">MIKEY</div>
                  <div className="khome">
                    ATTACHMENT · <b>HOME: THE FACEPLATE</b>
                  </div>
                </div>
                <div className="knob k3">
                  <div className="kface" />
                  <div className="kl">3 · BRAIN / TURN</div>
                  <div className="kv">FLASH → OPUS</div>
                  <div className="khome">
                    ROUTING TABLE · <b>HOME: THE TURN CHIP</b>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <h2>
        <span className="idx">03</span> Reply deck · verb rack
      </h2>
      <ReplyDeck />
      <div className="startgrid" style={{ marginTop: 14 }}>
        <VerbRack />
      </div>

      <h2>
        <span className="idx">04</span> Crew manifest
      </h2>
      <CrewManifest />

      <DockMiniBar />
    </>
  );
}
