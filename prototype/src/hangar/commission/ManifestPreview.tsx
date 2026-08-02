import { ScreenBed, Tag } from "@room/ui/rig";
import { commissionRoomId } from "../../mock/store";
import type { CommissionDraft, RoomManifest } from "../../mock/types";

export function manifestFromDraft(draft: CommissionDraft): RoomManifest {
  const room = commissionRoomId(draft.name);
  const repo = draft.repo.trim();
  return {
    room,
    name: draft.name.trim() || room,
    repo,
    ceremony: draft.ceremony,
    spine: draft.ceremony === "full" ? { tracker: "github", repo } : null,
    cast: { lead: draft.lead, checkout: draft.checkout },
    gearDefault: draft.gearDefault,
    brainTable: draft.brainTable,
    connectors: Object.entries(draft.connectors)
      .filter(([, enabled]) => enabled)
      .map(([connector]) => connector),
  };
}

export function manifestPath(draft: CommissionDraft): string {
  return `rooms/${commissionRoomId(draft.name)}/manifest.json`;
}

export function ManifestPreview({ draft }: { draft: CommissionDraft }) {
  const manifest = manifestFromDraft(draft);
  const durable = draft.ceremony === "full";
  return (
    <ScreenBed scanlines className="commission-manifest">
      <header className="commission-manifest-head">
        <div>
          <span>THE MANIFEST · THIS IS THE FILE, NOT A PREVIEW</span>
          <b>▸ {manifestPath(draft)}</b>
        </div>
        <Tag tone={durable ? "hot" : "dim"}>
          {durable ? "UNCOMMITTED · LIVE-BOUND" : "NOT WRITTEN · MEMORY ONLY"}
        </Tag>
      </header>
      <pre>{JSON.stringify(manifest, null, 2)}</pre>
      <div className="commission-bind-key">
        <span>LIVE-BOUND · EVERY CONTROL ON THE BENCH EDITS THIS JSON</span>
        {!durable ? <b>ONE-OFF ⇒ spine: null · NOTHING DURABLE IS WRITTEN</b> : null}
      </div>
      <aside className="commission-design-note">
        <b>ROOMS ARE CONFIG</b>
        <span>HAND-EDIT THE FILE = A SECOND ENTRANCE · git checkout = FREE UNDO</span>
      </aside>
    </ScreenBed>
  );
}
