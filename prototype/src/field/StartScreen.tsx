import { Toaster, toast } from "@room/ui";
import { useRef } from "react";
import { Led, Tag } from "@room/ui/rig";
import { AvatarFace } from "../avatars/AvatarFace";
import { FieldCard } from "../rig-ext/FieldCard";
import { FieldCrtFace } from "../rig-ext/FieldCrtFace";
import { toggleVerb } from "../mock/scenario";
import { openCommission, strikeCommission, useFleet, useRoom } from "../mock/store";
import { manifestFromDraft, manifestPath } from "../hangar/commission/ManifestPreview";

export function StartScreen() {
  const room = useRoom();
  const fleet = useFleet();
  const commission = fleet.commission;
  const tap = room.tapIn;
  const spawning = room.crafts.find((c) => c.state === "spawning");
  // Keep the launched craft's row visible after it materializes — the birth
  // shouldn't vanish from under the thumb 1.6s after spawn.
  const spawnedRef = useRef<string | null>(null);
  if (spawning) spawnedRef.current = spawning.id;
  const launched =
    !spawning && spawnedRef.current
      ? (room.crafts.find((c) => c.id === spawnedRef.current) ?? null)
      : null;
  const birth = spawning ?? launched;

  const strikeVoiceDraft = () => {
    const receipt = strikeCommission();
    if (!receipt) return;
    if (receipt.ceremony === "full") {
      toast("MANIFEST CHECKED IN · MIKEY ANNOUNCES THE BERTH AT THE LULL");
    } else {
      toast("SCRATCH BERTH STRUCK · NOTHING DURABLE WRITTEN · DIES ON DELIVERY");
    }
  };

  let exchange: { you?: string; mikey?: string; typing?: boolean } = {};
  if (tap) {
    exchange = {
      you: tap.question,
      mikey: tap.answer ?? undefined,
      typing: tap.answer === null,
    };
  } else {
    const lastYou = [...room.transcript].reverse().find((r) => r.who === "YOU");
    const lastMikey = [...room.transcript].reverse().find((r) => r.who === "MIKEY");
    exchange = { you: lastYou?.text, mikey: lastMikey?.text };
  }

  return (
    <div className="screen-body">
      <div className="dotmx ghost start-purpose">START — KICK OFF NEW WORK</div>

      <FieldCard className="vt" style={{ padding: 10 }}>
        {exchange.you ? (
          <div className="row">
            <span className="who">YOU</span>
            <span className="say you">{exchange.you}</span>
          </div>
        ) : (
          <div className="row">
            <span className="who">YOU</span>
            <span className="say" style={{ color: "var(--amber-dim)" }}>
              speak new work — or tap a verb below
            </span>
          </div>
        )}
        {exchange.mikey || exchange.typing ? (
          <div className="row">
            <span className="who">MIK</span>
            <span className="say">
              {exchange.typing ? (
                <>
                  …<span className="cursor" />
                </>
              ) : (
                exchange.mikey
              )}
            </span>
          </div>
        ) : null}
      </FieldCard>

      <div className="watchchip" style={{ marginTop: 10 }}>
        {tap ? (
          <>INTERPRETER: {tap.interpreter}</>
        ) : birth ? (
          <>
            NEW WORK → FILE {birth.ticket} → SPAWN · FLASH $0.002 · LOGGED
          </>
        ) : (
          <span style={{ color: "var(--steel-dim)" }}>
            SAY IT OR TYPE IT — MIKEY FILES THE TICKET AND SPAWNS A DEV
          </span>
        )}
      </div>

      {commission ? (
        <FieldCard className="field-commission-draft">
          <div className="field-commission-draft-head">
            <span>VOICE COMMISSION · READ-ONLY OUT HERE</span>
            <Tag tone="hot">SOURCE · {commission.source.toUpperCase()}</Tag>
          </div>
          <b className="field-commission-path">{manifestPath(commission)}</b>
          <pre>{JSON.stringify(manifestFromDraft(commission), null, 2)}</pre>
          <div className="field-commission-confirm">
            <button type="button" onClick={strikeVoiceDraft}>
              SAY “STRIKE IT”
            </button>
            <a href="/">ADJUST DIALS AT THE RIG</a>
          </div>
        </FieldCard>
      ) : (
        <button
          type="button"
          className="field-commission-voice"
          onClick={() => openCommission("voice")}
        >
          <b>COMMISSION ▸ VOICE</b>
          <span>MIKEY PREFILLS THE MANIFEST · DIALS LOCK AT THE RIG</span>
        </button>
      )}

      {birth ? (
        <div className="trows">
          <div className={`trow${spawning ? " spawning" : ""}`}>
            <div className="tface">
              <FieldCrtFace size={40} scanlines>
                <AvatarFace persona={birth.persona} size={40} />
              </FieldCrtFace>
            </div>
            <div className="tmid">
              <span className="callsign">{birth.callsign}</span>
              <span className="tid">{birth.ticket}</span>
              <div className="ttask">{birth.task}</div>
            </div>
            {spawning ? (
              <Tag>LAUNCHING</Tag>
            ) : (
              <Tag>{birth.state.toUpperCase()}</Tag>
            )}
          </div>
        </div>
      ) : (
        <div className="empty-line">READY FOR NEW WORK</div>
      )}

      <div className="dotmx ghost standing-orders-cap">
        STANDING ORDERS · TAP TO TOGGLE
      </div>

      <div className="vrack">
        {room.verbs.map((v) => (
          <button
            type="button"
            key={v.id}
            className={`vswitch${v.on ? " on" : ""}`}
            onClick={() => toggleVerb(v.id)}
          >
            <span className="lever" />
            <span>
              <div className="vname">&quot;{v.utterance}&quot;</div>
              <div className="vparams">{v.params}</div>
            </span>
            {v.gatedIssue != null ? (
              <Tag tone="red">GATED #{v.gatedIssue}</Tag>
            ) : (
              <Led tone={v.on ? "amber" : "dim"} pulse={v.on} />
            )}
          </button>
        ))}
      </div>
      <Toaster position="top-center" closeButton />
    </div>
  );
}
