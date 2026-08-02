import type { Terminal } from "./map-data";

export interface TerminalStripProps {
  terminals: Terminal[];
  selectedTerminalId: string | null;
  activeTerminalIds: Set<string>;
  hasSelection: boolean;
  onSelect: (terminalId: string) => void;
}

export function TerminalStrip({
  terminals,
  selectedTerminalId,
  activeTerminalIds,
  hasSelection,
  onSelect,
}: TerminalStripProps) {
  return (
    <ol className="terminal-strip" aria-label="Mock field terminal strip">
      {terminals.map((terminal, index) => {
        const selected = terminal.id === selectedTerminalId;
        const active = !hasSelection || activeTerminalIds.has(terminal.id);
        return (
          <li className="terminal-pin-item" key={terminal.id}>
            <button
              type="button"
              className={`terminal-pin${terminal.status === "wish" ? " is-wish" : ""}${selected ? " is-selected" : ""}${active ? " is-active" : " is-dim"}`}
              onClick={() => onSelect(terminal.id)}
              aria-pressed={selected}
            >
              <span className="terminal-number">{String(index + 1).padStart(2, "0")}</span>
              <span className="terminal-screw" aria-hidden />
              <span className="terminal-field">{terminal.field}</span>
              <span className="terminal-status">
                {terminal.status === "wish" ? `WISH · ${terminal.phase}` : "LIVE"}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
