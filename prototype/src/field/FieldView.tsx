import { useEffect, useRef, useState } from "react";
import { focusCraftForAnswer } from "../mock/scenario";
import { useRoom } from "../mock/store";
import "../styles/field.css";
import { AnswerScreen } from "./AnswerScreen";
import { FieldDock } from "./FieldDock";
import { FieldNav, type FieldScreen } from "./FieldNav";
import { FieldRoomRail } from "./FieldRoomRail";
import { GaugesScreen } from "./GaugesScreen";
import { GlanceScreen } from "./GlanceScreen";
import { ListenScreen } from "./ListenScreen";
import { StartScreen } from "./StartScreen";

export function FieldView() {
  const room = useRoom();
  const [screen, setScreen] = useState<FieldScreen>("glance");
  const screenRef = useRef(screen);
  screenRef.current = screen;
  const prev = useRef({
    held: room.heldQuestion,
    speaking: room.speakingPersona,
    tapIn: room.tapIn,
  });

  useEffect(() => {
    const p = prev.current;
    const heldNow = room.heldQuestion;
    const speakingNow = room.speakingPersona;
    const tapNow = room.tapIn;

    if (p.held == null && heldNow != null) {
      setScreen("answer");
    } else if (
      p.speaking == null &&
      speakingNow != null &&
      !(screenRef.current === "answer" && heldNow != null) &&
      // A tap-in answer speaks 700ms after the jump to START — stay there.
      !(screenRef.current === "start" && tapNow != null)
    ) {
      setScreen("listen");
    } else if (p.tapIn == null && tapNow != null) {
      setScreen("start");
    }

    prev.current = {
      held: heldNow,
      speaking: speakingNow,
      tapIn: tapNow,
    };
  }, [room.heldQuestion, room.speakingPersona, room.tapIn]);

  const answerBadge =
    room.heldQuestion != null ||
    room.crafts.some((c) => c.state === "needs-you");
  const listenBadge = room.speakingPersona != null;

  const moodClass =
    room.mood === "mic-open"
      ? "mood-mic-open"
      : room.mood === "the-lull"
        ? "mood-the-lull"
        : room.mood === "arrival"
          ? "mood-arrival"
          : "";

  const goAnswer = (craftId: string) => {
    focusCraftForAnswer(craftId);
    setScreen("answer");
  };

  return (
    <div className={`field-root ${moodClass}`.trim()}>
      <div className="field-mast">
        <div className="haz" style={{ marginBottom: 12 }} />
        <h1>
          THE <span>RIG</span> // FIELD UNIT
        </h1>
        <a className="back" href="/">
          ◂ RIG
        </a>
      </div>

      <div className="fone">
        <span className="sidekey" />
        <span className="sidekey low" />
        <div className="screenbed fscr">
          <div className="inner">
            <div className="fhead">
              <FieldRoomRail />
              <FieldNav
                screen={screen}
                onChange={setScreen}
                answerBadge={answerBadge}
                listenBadge={listenBadge}
              />
            </div>

            {screen === "glance" ? (
              <GlanceScreen onSelectCraft={goAnswer} />
            ) : null}
            {screen === "answer" ? <AnswerScreen /> : null}
            {screen === "listen" ? <ListenScreen /> : null}
            {screen === "start" ? <StartScreen /> : null}
            {screen === "gauges" ? <GaugesScreen /> : null}

            {/* One dock everywhere: "text or speak it". LISTEN adds the
                transport keys and drops the chip (big faceplate above). */}
            <FieldDock listen={screen === "listen"} />
          </div>
        </div>
      </div>
    </div>
  );
}
