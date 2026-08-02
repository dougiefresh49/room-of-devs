import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@room/ui";
import type { MapNode, Terminal } from "./map-data";

export interface InspectorProps {
  node: MapNode | null;
  terminal: Terminal | null;
  consumers: MapNode[];
}

function InspectorCell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Collapsible defaultOpen className="inspector-cell">
      <CollapsibleTrigger className="inspector-cell-trigger">
        <span>{title}</span>
        <span aria-hidden>⌄</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="inspector-cell-content">{children}</CollapsibleContent>
    </Collapsible>
  );
}

export function Inspector({ node, terminal, consumers }: InspectorProps) {
  const title = node?.title ?? terminal?.field ?? "NO PART SELECTED";
  const identity = node?.partNo ?? (terminal ? "WIRE TERMINAL" : "SERVICE DOOR");
  const docPointer = node?.src ?? "prototype/src/mock/types.ts";

  return (
    <div className="map-inspector screenbed">
      <div className="inspector-heading">
        <span className="inspector-part">{identity}</span>
        <strong>{title}</strong>
        <span className="inspector-mode">
          {terminal
            ? "REVERSE INDEX · WHO CONSUMES THIS FIELD"
            : "FORWARD INDEX · WHAT THIS PART TOUCHES"}
        </span>
      </div>

      <div className="inspector-grid">
        <InspectorCell title="WHY">
          {node
            ? node.why
            : terminal
              ? `This screw exposes ${terminal.field} as an explicit contract instead of hiding it inside a housing.`
              : "Select a surface, architecture part, dial, or wire screw to inspect the static document."}
        </InspectorCell>
        <InspectorCell title="ARCHITECTURE TIE">
          {node
            ? node.tie
            : terminal
              ? consumers.length > 0
                ? `Consumed by ${consumers.map((consumer) => `${consumer.partNo} ${consumer.title}`).join(" · ")}.`
                : "Present in the mock contract, but this map records no visible consumer yet."
              : "The service schematic is an index of the prose authority, never its replacement."}
        </InspectorCell>
        <InspectorCell title="WIRE NEEDS">
          {node ? (
            node.terminals.length > 0 ? (
              <ul>
                {node.terminals.map((field) => (
                  <li key={field}>{field}</li>
                ))}
              </ul>
            ) : (
              "No wire fields."
            )
          ) : terminal ? (
            <>
              <b>{terminal.status === "wish" ? `WISH · ${terminal.phase}` : "LIVE IN MOCK"}</b>
              <span>{consumers.length} mapped consumer(s)</span>
            </>
          ) : (
            "No selection."
          )}
        </InspectorCell>
      </div>

      <div className="inspector-doc">
        <span>DOC POINTER</span>
        <b>{docPointer}</b>
        <i>PROSE AUTHORITY · THIS PANEL IS ITS INDEX</i>
      </div>
    </div>
  );
}
