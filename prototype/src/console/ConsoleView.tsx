import { useState } from "react";
import { RigMasthead } from "../chrome/RigMasthead";
import { useRoom } from "../mock/store";
import { ConsoleDock } from "./ConsoleDock";
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

function InstrumentStack({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <div className="instr">
      <button
        type="button"
        className="instr-latch"
        aria-expanded={open}
        aria-label="Instruments column"
        onClick={onToggle}
      >
        ▸
      </button>
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
  );
}

function InstrumentStub({ clearPct, onExpand }: { clearPct: number; onExpand: () => void }) {
  return (
    <button
      type="button"
      className="instr-stub"
      aria-expanded="false"
      aria-label="Instruments column"
      onClick={onExpand}
    >
      <span className="stub-latch" aria-hidden>
        ◂
      </span>
      <span className="stub-label">INSTRUMENTS</span>
      <span className="stub-value sseg">{clearPct}%</span>
    </button>
  );
}

export function ConsoleView() {
  const room = useRoom();
  const [instrOpen, setInstrOpen] = useState(true);

  if (room.view === "node") {
    const craft =
      room.crafts.find((c) => c.id === room.focusCraftId) ??
      room.crafts.find((c) => c.state !== "empty");
    return (
      <div className="chassis mainwin">
        <RigMasthead mode="room" stamp={`ZOOM 3 · ${craft?.ticket ?? "—"}`} />
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          {craft ? <ThreadNode craft={{ ...craft, open: true }} /> : null}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="chassis mainwin">
        <RigMasthead mode="room" />
        <span className="screw tl" />
        <span className="screw tr" />
        <span className="screw bl" />
        <span className="screw br" />
        <div className={`cols${instrOpen ? "" : " cols--instr-collapsed"}`}>
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
            <ConsoleDock />
            <DonnieBay />
          </div>

          <SpineRail />

          <div className="instr-slot">
            <InstrumentStack open={instrOpen} onToggle={() => setInstrOpen(false)} />
            <InstrumentStub clearPct={room.salience.clearPct} onExpand={() => setInstrOpen(true)} />
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
