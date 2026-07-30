import { CrtFace, Keycap } from "@room/ui/rig";
import { AvatarFace } from "../avatars/AvatarFace";
import {
  answer,
  discardArtifact,
  keepArtifact,
  setView,
  toggleCraftOpen,
} from "../mock/scenario";
import { useRoom } from "../mock/store";
import type { Craft } from "../mock/types";

function stateTag(state: Craft["state"]) {
  switch (state) {
    case "needs-you":
      return <span className="tag red">NEEDS YOU</span>;
    case "settled":
      return <span className="tag grn">SETTLED</span>;
    case "spawning":
      return <span className="tag">SPAWNING</span>;
    case "empty":
      return <span className="tag dim">EMPTY</span>;
    default:
      return <span className="tag">WORKING</span>;
  }
}

export function ThreadNode({ craft }: { craft: Craft }) {
  const room = useRoom();
  const hq =
    room.heldQuestion?.craftId === craft.id ? room.heldQuestion : null;
  const artifact = room.artifacts.find(
    (a) => a.craftId === craft.id && a.status === "pending",
  );
  const wrapClass = [
    "tnwrap",
    craft.state === "needs-you" ? "needy" : "",
    craft.state === "settled" ? "settledw" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const nodeClass = [
    "tnode",
    craft.state === "needs-you" ? "needsyou" : "",
    craft.state === "settled" ? "settled" : "",
    craft.state === "spawning" ? "spawning" : "",
    craft.state === "empty" ? "empty" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={wrapClass}>
      <details
        className={nodeClass}
        open={craft.open}
        onToggle={(e) => {
          const open = (e.target as HTMLDetailsElement).open;
          if (open !== craft.open) toggleCraftOpen(craft.id);
        }}
      >
        <summary
          onDoubleClick={(e) => {
            e.preventDefault();
            setView("node", craft.id);
          }}
        >
          <div className="tface">
            <CrtFace size={58} scanlines>
              <AvatarFace persona={craft.persona} mode="idle" size={58} />
            </CrtFace>
          </div>
          <div className="tmid">
            <div className="trow1">
              <span className="callsign">{craft.callsign}</span>
              <span className="tid">
                {craft.ticket}
                {craft.tmux ? " · TMUX ✓" : ""}
              </span>
              {craft.watched ? (
                <span className="tag" style={{ fontSize: 8 }}>
                  WATCH ORDER
                </span>
              ) : null}
              {craft.oneOff ? (
                <span className="tag dim" style={{ fontSize: 8 }}>
                  ONE-OFF
                </span>
              ) : null}
            </div>
            <div className="ttask">{craft.task}</div>
          </div>
          <div className="tstat">
            {stateTag(craft.state)}
            {craft.lastStamp ? (
              <span className="laststamp">{craft.lastStamp}</span>
            ) : null}
          </div>
        </summary>
        <div className="expandhint">▸ OPEN NODE</div>
        {craft.state !== "empty" ? (
          <div className="innards">
            <div className="screenbed term">
              <div className="cap">
                <span>
                  {hq
                    ? `HELD // ASKUSERQUESTION · ${craft.ticket}`
                    : `LIVE TAIL // ${craft.ticket}`}
                </span>
                <span>
                  {craft.watched
                    ? "NARRATED BY MIKEY"
                    : hq
                      ? "CLICK A KEY — OR JUST SAY IT"
                      : "SILENT · LOGGED ONLY"}
                </span>
              </div>
              {hq ? (
                <>
                  <div className="ln">
                    <span className="p">?</span> {hq.prompt}
                  </div>
                  {hq.options.map((o, i) => (
                    <Keycap
                      key={o.id}
                      glyph={String(i + 1)}
                      label={`${o.label} — ${o.detail}`}
                      hint={`“${o.speakHint}”`}
                      armed={o.armed}
                      onPress={() => answer(o.id)}
                    />
                  ))}
                </>
              ) : (
                craft.tail.map((ln, i) => (
                  <div
                    key={i}
                    className={`ln${ln.kind === "ok" ? " ok" : ""}${ln.kind === "typing" ? " typing" : ""}`}
                  >
                    <span className="p">
                      {ln.kind === "cmd" ? "$" : ln.kind === "ok" ? "✓" : "»"}
                    </span>{" "}
                    {ln.text}
                  </div>
                ))
              )}
              {artifact ? (
                <div className="artifact-card">
                  <div className="cap">{artifact.title}</div>
                  <div dangerouslySetInnerHTML={{ __html: artifact.svg }} />
                  <div className="artifact-actions">
                    <button type="button" onClick={() => keepArtifact(artifact.id)}>
                      KEEP THAT
                    </button>
                    <button
                      type="button"
                      className="dim"
                      onClick={() => discardArtifact(artifact.id)}
                    >
                      DISCARD
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
            <div className="side">
              <div className="screenbed tspend">
                <span>THIS THREAD</span>
                <b>{craft.tokens.toLocaleString()} tok</b>
                <span>·</span>
                <b>${craft.spendUsd.toFixed(2)}</b>
                <span>·</span>
                <b>{craft.turns} turns</b>
              </div>
              {craft.state === "needs-you" ? (
                <div className="screenbed tspend">
                  <span>SALIENCE PULL</span>
                  <b className="stn" style={{ color: "var(--red)" }}>
                    −22 CLR
                  </b>
                </div>
              ) : null}
              {craft.diff ? (
                <div className="screenbed diff">
                  <div className="cap">DIFF · {craft.diff.file}</div>
                  {craft.diff.lines.map((l, i) => (
                    <div key={i} className={l.kind}>
                      {l.text}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </details>
    </div>
  );
}
