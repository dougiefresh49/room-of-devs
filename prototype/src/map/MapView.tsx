import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@room/ui";
import { Chassis, HexLayer, Keycap } from "@room/ui/rig";
import { useEffect, useMemo, useState } from "react";
import { Inspector } from "./Inspector";
import { StratumColumn } from "./StratumColumn";
import { TerminalStrip } from "./TerminalStrip";
import { GAPS, MAP_NODES, TERMINALS, nodeByPartNo } from "./map-data";

type Selection = { kind: "node"; id: string } | { kind: "terminal"; id: string } | null;

function selectionFromLocation(): Selection {
  if (typeof window === "undefined") return { kind: "node", id: "s-06" };
  const node = nodeByPartNo(new URLSearchParams(window.location.search).get("part"));
  return { kind: "node", id: node?.id ?? "s-06" };
}

export interface MapViewProps {
  overlay?: boolean;
}

export function MapView({ overlay = false }: MapViewProps) {
  const [selection, setSelection] = useState<Selection>(selectionFromLocation);

  useEffect(() => {
    const clearSelection = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSelection(null);
    };
    window.addEventListener("keydown", clearSelection);
    return () => window.removeEventListener("keydown", clearSelection);
  }, []);

  const selectedNode =
    selection?.kind === "node"
      ? (MAP_NODES.find((node) => node.id === selection.id) ?? null)
      : null;
  const selectedTerminal =
    selection?.kind === "terminal"
      ? (TERMINALS.find((terminal) => terminal.id === selection.id) ?? null)
      : null;

  const activeNodeIds = useMemo(() => {
    const active = new Set<string>();
    if (selectedNode) {
      active.add(selectedNode.id);
      selectedNode.ties.forEach((id) => {
        active.add(id);
      });
      MAP_NODES.forEach((node) => {
        if (node.ties.includes(selectedNode.id)) active.add(node.id);
      });
    }
    selectedTerminal?.consumers.forEach((id) => {
      active.add(id);
    });
    return active;
  }, [selectedNode, selectedTerminal]);

  const activeTerminalIds = useMemo(() => {
    const active = new Set<string>();
    if (selectedNode) {
      selectedNode.terminals.forEach((id) => {
        active.add(id);
      });
    }
    if (selectedTerminal) active.add(selectedTerminal.id);
    return active;
  }, [selectedNode, selectedTerminal]);

  const terminalConsumers = selectedTerminal
    ? MAP_NODES.filter((node) => selectedTerminal.consumers.includes(node.id))
    : [];
  const hasSelection = selection != null;
  const surfaceNodes = MAP_NODES.filter((node) => node.stratum === "surface");
  const machineNodes = MAP_NODES.filter((node) => node.stratum === "machine");

  return (
    <main
      className={`map-view${overlay ? " map-view--overlay" : ""}${hasSelection ? " has-selection" : ""}`}
    >
      <div className="map-hazard" aria-hidden />
      <header className="map-header">
        <div>
          <span className="map-kicker">SERVICE DOOR · STATIC DOCUMENT</span>
          <h1>SERVICE SCHEMATIC — UI ↔ ARCHITECTURE ↔ WIRE</h1>
        </div>
        <div className="map-header-stamps">
          <span>REV 08-01</span>
          <span>ESC · CLEAR HARNESS</span>
          <b>⚠ NO LIVE DATA ON THIS PLATE</b>
        </div>
      </header>

      <section className="map-diagram" aria-label="Service schematic diagram">
        <Chassis screws className="map-column map-column--surfaces">
          <div className="map-column-heading">
            <span>I</span>
            <div>
              <b>ON-SCREEN SURFACES</b>
              <small>WHAT YOU TOUCH</small>
            </div>
          </div>
          <StratumColumn
            nodes={surfaceNodes}
            selectedNodeId={selectedNode?.id ?? null}
            activeNodeIds={activeNodeIds}
            hasSelection={hasSelection}
            onSelect={(id) => setSelection({ kind: "node", id })}
          />
        </Chassis>

        <Chassis screws className="map-column map-column--architecture">
          <HexLayer intensity="faint" className="map-static-hex" />
          <div className="map-column-heading">
            <span>II</span>
            <div>
              <b>THE SETTLED ARCHITECTURE</b>
              <small>VOICE OVER SPINE OVER MORTAL · DOCS 04–09</small>
            </div>
          </div>
          <StratumColumn
            nodes={machineNodes}
            selectedNodeId={selectedNode?.id ?? null}
            activeNodeIds={activeNodeIds}
            hasSelection={hasSelection}
            onSelect={(id) => setSelection({ kind: "node", id })}
          />
          <section className="map-gaps" aria-label="Known design gaps">
            {GAPS.map((gap) => (
              <article className={`map-gap${gap.filledBy ? " is-filled" : ""}`} key={gap.id}>
                <span className="map-rivet" aria-hidden />
                <div>
                  <b>{gap.title}</b>
                  {gap.filledBy ? <strong>FILLED · {gap.filledBy}</strong> : <strong>OPEN</strong>}
                  <p>{gap.detail}</p>
                </div>
              </article>
            ))}
          </section>
        </Chassis>

        <Chassis screws className="map-column map-column--terminals">
          <div className="map-column-heading">
            <span>III</span>
            <div>
              <b>WIRE TERMINALS</b>
              <small>prototype/src/mock/types.ts</small>
            </div>
          </div>
          <div className="terminal-legend">
            <span>
              <i /> SOLID · MOCK TODAY
            </span>
            <span className="wish">
              <i /> DASHED · ROUND-D WISHLIST
            </span>
          </div>
          <TerminalStrip
            terminals={TERMINALS}
            selectedTerminalId={selectedTerminal?.id ?? null}
            activeTerminalIds={activeTerminalIds}
            hasSelection={hasSelection}
            onSelect={(id) => setSelection({ kind: "terminal", id })}
          />
        </Chassis>
      </section>

      <Inspector node={selectedNode} terminal={selectedTerminal} consumers={terminalConsumers} />
    </main>
  );
}

export function MapDialog() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const closeOnHistory = () => setOpen(false);
    window.addEventListener("popstate", closeOnHistory);
    return () => window.removeEventListener("popstate", closeOnHistory);
  }, []);

  const changeOpen = (nextOpen: boolean) => {
    if (nextOpen && !open) {
      window.history.pushState({ schematicOverlay: true }, "", "/map");
    } else if (!nextOpen && open && window.history.state?.schematicOverlay) {
      window.history.back();
    }
    setOpen(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Keycap glyph="⌁" label="SCHEMATIC" className="schematic-keycap" />
      </DialogTrigger>
      <DialogContent className="map-dialog-content" data-schematic-dialog>
        <DialogTitle className="visually-hidden">Service schematic</DialogTitle>
        <MapView overlay />
      </DialogContent>
    </Dialog>
  );
}
