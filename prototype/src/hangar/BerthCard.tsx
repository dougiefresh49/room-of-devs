import { Chassis, CrtFace, Keycap, Led, SalienceBar, Tag, Waveform } from "@room/ui/rig";
import { AvatarFace } from "../avatars/AvatarFace";
import type { AudioFloor, RoomBerth } from "../mock/types";
import { roomShortLabel } from "./BerthTabs";

export interface BerthCardProps {
  berth: RoomBerth | null;
  audioFloor: AudioFloor;
  threshold: number;
  onCouple?: () => void;
}

function percentToSegments(percent: number) {
  return Math.round((percent / 100) * 16);
}

export function BerthCard({ berth, audioFloor, threshold, onCouple }: BerthCardProps) {
  if (!berth) {
    return (
      <Chassis className="hangar-berth hangar-berth--empty" glow="0 10px 22px rgba(0,0,0,.42)">
        <div className="hangar-empty-inner">
          <Keycap glyph="+" label="COMMISSION A ROOM" />
          <span>BERTH B-04 · OPEN — MANIFEST NOT YET STRUCK</span>
        </div>
      </Chassis>
    );
  }

  const scratch = berth.berth == null;
  const hasFloor = audioFloor.roomId === berth.id;
  const needsYou = berth.counts.needsYou > 0;
  const card = (
    <Chassis
      className={`hangar-berth${scratch ? " hangar-berth--scratch" : ""}${needsYou ? " hangar-berth--needs-you" : ""}`}
      glow={needsYou ? "0 0 16px rgba(255,83,64,.34)" : "0 10px 22px rgba(0,0,0,.42)"}
    >
      {hasFloor ? <span className="hangar-berth-tap" aria-hidden /> : null}
      <div className="hangar-berth-inner">
        <div className="hangar-berth-head">
          <span className={scratch ? "hangar-scratch-mark" : "hangar-berth-number"}>
            {scratch ? "◇" : `B-${String(berth.berth).padStart(2, "0")}`}
          </span>
          <span className="hangar-berth-name">{berth.manifest.name}</span>
          {!scratch ? (
            <span className="hangar-floor-lamp">
              <Led tone={hasFloor ? "amber" : "dim"} pulse={hasFloor} /> FLOOR
              {hasFloor ? <Waveform active bars={5} /> : null}
            </span>
          ) : null}
        </div>

        {scratch ? (
          <div className="hangar-scratch-body">
            {berth.parentRoomId ? (
              <Tag tone="dim">FROM {roomShortLabel(berth.parentRoomId)}</Tag>
            ) : null}
            <span>ONE-OFF · NO SPINE · NO CONDUIT · DIES ON DELIVERY</span>
            <div className="hangar-salience-row">
              <SalienceBar
                lit={percentToSegments(berth.salience.clearPct)}
                threshold={percentToSegments(threshold)}
                segments={16}
              />
              <b>{berth.salience.clearPct}%</b>
            </div>
            <span>MIKEY NARRATES · {berth.ticker}</span>
          </div>
        ) : (
          <div className="hangar-berth-body">
            <CrtFace size={58} scanlines>
              <AvatarFace persona={berth.manifest.cast.lead} size={58} />
            </CrtFace>
            <div className="hangar-spine-glyph">
              {berth.docked.live > 0 ? (
                <span className="is-live">{berth.docked.live} LIVE</span>
              ) : null}
              {berth.docked.queued > 0 ? (
                <span className="is-queued">{berth.docked.queued} QUEUED</span>
              ) : null}
              {berth.docked.settled > 0 ? (
                <span className="is-settled">{berth.docked.settled} SETTLED</span>
              ) : null}
            </div>
            <div className="hangar-berth-meta">
              <span>
                <b>{berth.counts.working + berth.counts.needsYou} CRAFT</b>
                {berth.counts.needsYou > 0 ? <em> · {berth.counts.needsYou} RED</em> : null}
                {berth.counts.watchers > 0 ? ` · ${berth.counts.watchers} WATCHER` : null}
              </span>
              <div className="hangar-salience-row">
                <SalienceBar
                  lit={percentToSegments(berth.salience.clearPct)}
                  threshold={percentToSegments(threshold)}
                  segments={16}
                />
                <b>{berth.salience.clearPct}%</b>
              </div>
              <Tag>GEAR · {berth.manifest.gearDefault}</Tag>
            </div>
          </div>
        )}

        {!scratch ? <div className="hangar-berth-ticker">{berth.ticker}</div> : null}
      </div>
      {!scratch ? <div className="hangar-berth-hazard" aria-hidden /> : null}
    </Chassis>
  );

  if (scratch || !onCouple) return card;
  return (
    <button
      type="button"
      className="hangar-berth-button"
      onClick={onCouple}
      aria-label={`Couple room ${berth.manifest.name}`}
    >
      {card}
    </button>
  );
}
