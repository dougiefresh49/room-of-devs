import { Button, Toaster, toast } from "@room/ui";
import { CutFrame, Led, Tag } from "@room/ui/rig";
import { useEffect, useRef } from "react";
import { AvatarFace } from "../avatars/AvatarFace";
import { roomShortLabel } from "../chrome/MastheadTabs";
import { manifestFromDraft, manifestPath } from "../hangar/commission/ManifestPreview";
import { toggleVerb } from "../mock/scenario";
import { openCommission, strikeCommission, useFleet, useRoom } from "../mock/store";
import { FieldCard } from "../rig-ext/FieldCard";
import { FieldCrtFace } from "../rig-ext/FieldCrtFace";
import { CommsLog, type CommsRow } from "./CommsLog";
import { PttPill } from "./PttPill";

export function StartScreen() {
  const room = useRoom();
  const fleet = useFleet();
  const commission = fleet.commission;
  const tap = room.tapIn;
  const latestBirth = room.crafts.reduce<(typeof room.crafts)[number] | null>(
    (latest, craft) =>
      craft.spawnedRev != null && (latest == null || craft.spawnedRev > (latest.spawnedRev ?? -1))
        ? craft
        : latest,
    null,
  );
  const intakeKind =
    latestBirth && (!tap || (latestBirth.spawnedRev ?? -1) > tap.startedRev)
      ? "spawn"
      : tap
        ? "tap"
        : null;
  const activeTap = intakeKind === "tap" ? tap : null;
  const birth = intakeKind === "spawn" ? latestBirth : null;
  const spawning = birth?.state === "spawning";
  const intakeKey =
    intakeKind === "spawn"
      ? `spawn-${birth?.spawnedRev}`
      : activeTap
        ? `tap-${activeTap.startedRev}`
        : null;
  const intakeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (intakeKey) intakeRef.current?.scrollIntoView({ block: "start" });
  }, [intakeKey]);

  const strikeVoiceDraft = () => {
    const receipt = strikeCommission();
    if (!receipt) return;
    if (receipt.ceremony === "full") {
      toast("MANIFEST CHECKED IN · MIKEY ANNOUNCES THE BERTH AT THE LULL");
    } else {
      toast("SCRATCH BERTH STRUCK · NOTHING DURABLE WRITTEN · DIES ON DELIVERY");
    }
  };

  const exchangeRows: CommsRow[] = activeTap
    ? [
        { who: "YOU", text: activeTap.question, you: true },
        {
          who: "MIKEY",
          text: activeTap.answer ?? "On it — filing that now.",
        },
      ]
    : birth
      ? [
          { who: "YOU", text: birth.spawnPrompt ?? birth.task, you: true },
          {
            who: "MIKEY",
            text: `${birth.callsign} is ${spawning ? "launching" : "on it"}.`,
          },
        ]
      : [];

  return (
    <div className="screen-body start-body" data-part="F-04">
      {intakeKind ? (
        <div ref={intakeRef} className="start-intake">
          <div className="start-intake-cap">NEW WORK · INTAKE</div>
          <CommsLog
            rows={exchangeRows}
            className="field-thread start-exchange"
            typing={activeTap?.answer === null}
          />
          <div className="watchchip start-receipt">
            {activeTap ? (
              <>INTERPRETER: {activeTap.interpreter}</>
            ) : birth ? (
              <>NEW WORK → FILE {birth.ticket} → SPAWN · FLASH $0.002 · LOGGED</>
            ) : null}
          </div>

          {birth ? (
            <>
              <div className="start-launched-cap">JUST LAUNCHED</div>
              <div className="trows start-launched">
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
                  <Tag>{spawning ? "LAUNCHING" : birth.state.toUpperCase()}</Tag>
                </div>
              </div>
            </>
          ) : null}
        </div>
      ) : (
        <CutFrame scale="m" className="start-hero-wrap" innerClassName="start-hero">
          <div className="start-hero-kicker">NEW WORK</div>
          <h2>TELL MIKEY WHAT TO BUILD</h2>
          <p>
            Say it out loud. He writes the ticket and puts a dev on it — you&apos;ll hear back when
            it moves.
          </p>
          <div className="start-hero-actions">
            <PttPill />
            <Button
              type="button"
              variant="ghost"
              className="start-type"
              onClick={() => window.dispatchEvent(new Event("field:focus-composer"))}
            >
              TYPE IT
            </Button>
          </div>
          <div className="start-room-chip">
            GOES TO THIS ROOM · {roomShortLabel(fleet.activeRoomId)}
          </div>
        </CutFrame>
      )}

      {commission ? (
        <FieldCard className="field-commission-draft">
          <div className="field-commission-draft-head">
            <span>NEW ROOM DRAFT · READ-ONLY OUT HERE</span>
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
        <button type="button" className="start-newroom" onClick={() => openCommission("voice")}>
          <b>OPEN A NEW ROOM</b>
          <i aria-hidden>▸</i>
          <span>
            For work that doesn&apos;t belong to {roomShortLabel(fleet.activeRoomId)}. Mikey drafts
            the manifest; you lock the dials back at the rig.
          </span>
        </button>
      )}

      <div className="saved-orders-head">SAVED ORDERS</div>
      <div className="saved-orders-copy">Things Mikey keeps doing without being asked.</div>
      <div className="vrack saved-orders">
        {room.verbs.map((verb) => {
          const gated = verb.gatedIssue != null;
          const on = !gated && verb.on;
          return (
            <button
              type="button"
              key={verb.id}
              className={`vswitch${on ? " on" : ""}${gated ? " is-gated" : ""}`}
              onClick={gated ? undefined : () => toggleVerb(verb.id)}
              aria-disabled={gated ? "true" : undefined}
              aria-pressed={on}
            >
              <span className="lever" />
              <span>
                <span className="vname">&quot;{verb.utterance}&quot;</span>
                <span className="vparams">{verb.fieldLabel}</span>
              </span>
              {gated ? (
                <Tag tone="red">GATED #{verb.gatedIssue}</Tag>
              ) : (
                <Led tone={on ? "amber" : "dim"} pulse={on} />
              )}
            </button>
          );
        })}
      </div>
      <Toaster position="top-center" closeButton />
    </div>
  );
}
