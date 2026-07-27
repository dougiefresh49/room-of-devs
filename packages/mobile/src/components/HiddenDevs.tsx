/**
 * Collapsible "hidden devs" section. Lists agents the user hid (by raw name,
 * persisted to mobile_hidden_dev_names_v1) with an unhide button. When a
 * hidden name matches a live agent we show its nicer label; otherwise just
 * the stored name.
 */
import { useId, useState } from "react";
import type { AgentView } from "@room/protocol";
import { IconChevron } from "../icons.js";

interface HiddenDevsProps {
  hiddenNames: readonly string[];
  agents: AgentView[];
  onShow: (rawName: string) => void;
}

export function HiddenDevs({ hiddenNames, agents, onShow }: HiddenDevsProps) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  if (hiddenNames.length === 0) return null;

  const rows = [...hiddenNames]
    .sort((a, b) => a.localeCompare(b))
    .map((rawName) => {
      const live = agents.find((agent) => agent.name.trim() === rawName);
      const label = live ? live.label || live.name : rawName;
      const sub = label !== rawName ? rawName : null;
      return { rawName, label, sub };
    });

  return (
    <section className="mt-4">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-lg px-1 py-2 text-xs font-medium text-fg-muted transition-colors hover:text-fg"
      >
        <span className={`transition-transform [&_svg]:size-4 ${open ? "" : "-rotate-90"}`}>
          <IconChevron />
        </span>
        {hiddenNames.length} hidden
      </button>
      {open ? (
        <ul id={listId} className="flex flex-col gap-1.5 pt-1">
          {rows.map(({ rawName, label, sub }) => (
            <li
              key={rawName}
              className="flex items-center gap-2 rounded-lg border border-line bg-surface/60 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{label}</div>
                {sub ? <div className="truncate text-[11px] text-fg-faint">{sub}</div> : null}
              </div>
              <button
                type="button"
                className="shrink-0 rounded-md border border-line-strong px-2.5 py-1 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                onClick={() => onShow(rawName)}
              >
                Show
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
