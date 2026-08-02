import { PartNo } from "./PartNo";
import type { MapNode } from "./map-data";

export interface StratumColumnProps {
  nodes: MapNode[];
  selectedNodeId: string | null;
  activeNodeIds: Set<string>;
  hasSelection: boolean;
  onSelect: (nodeId: string) => void;
}

export function StratumColumn({
  nodes,
  selectedNodeId,
  activeNodeIds,
  hasSelection,
  onSelect,
}: StratumColumnProps) {
  const groups = [...new Set(nodes.map((node) => node.group))];

  return (
    <div className="map-strata">
      {groups.map((group) => (
        <section className="map-stratum" key={group} aria-label={group}>
          <div className="map-stratum-label">{group}</div>
          <div className="map-node-grid">
            {nodes
              .filter((node) => node.group === group)
              .map((node) => {
                const selected = selectedNodeId === node.id;
                const active = !hasSelection || activeNodeIds.has(node.id);
                return (
                  <button
                    type="button"
                    key={node.id}
                    className={`map-node${selected ? " is-selected" : ""}${active ? " is-active" : " is-dim"}${node.kind === "dial" ? " is-dial" : ""}`}
                    aria-pressed={selected}
                    onClick={() => onSelect(node.id)}
                  >
                    {node.kind === "dial" ? (
                      <span className="map-knob" aria-hidden>
                        <i />
                      </span>
                    ) : (
                      <span className="map-harness-jack" aria-hidden />
                    )}
                    <span className="map-node-copy">
                      <b>{node.title}</b>
                      {node.see ? <small>{node.see}</small> : null}
                    </span>
                    <PartNo
                      partNo={node.partNo}
                      title={node.title}
                      deepLink={false}
                      bindHousing={false}
                    />
                  </button>
                );
              })}
          </div>
        </section>
      ))}
    </div>
  );
}
