/**
 * Session picker sheet (New / Resume). Fetches GET /picker on open, lets the
 * user pick a persona + launch flags, and spawns/resumes on a row tap.
 *
 * Launch flags persist to the mobile_flag_* localStorage keys (via prefs) so
 * they survive across the SPA cutover; the actual spawn/resume payload is
 * assembled by App from prefs.launchFlags() at launch time.
 */
import { useEffect, useRef, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@room/ui";
import {
  basename,
  dirOf,
  dirOfResumable,
  fetchPicker,
  labelOfDir,
  labelOfResumable,
  prettyPath,
  sessionIdOf,
  type PickerData,
} from "../api.js";
import { avatarSrc } from "../avatar.js";
import { getFlag, getModel, setFlag, setModel, type LaunchModel } from "../prefs.js";
import { IconFolder } from "../icons.js";

const MODELS: readonly [LaunchModel, string][] = [
  ["", "Default"],
  ["fable", "Fable"],
  ["opus", "Opus"],
  ["sonnet", "Sonnet"],
  ["haiku", "Haiku"],
];

type Tab = "new" | "resume";

interface PickerSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSpawn: (payload: { dir: string; persona: string | null }) => void;
  onResume: (payload: { sessionId: string; dir: string; persona: string | null }) => void;
}

export function PickerSheet({ open, onOpenChange, onSpawn, onResume }: PickerSheetProps) {
  const [tab, setTab] = useState<Tab>("new");
  const [data, setData] = useState<PickerData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [persona, setPersona] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setError(null);
    fetchPicker(controller.signal).then(
      (result) => {
        setData(result);
        setPersona((current) => current ?? result.personas[0] ?? null);
      },
      (err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Session picker unavailable");
      },
    );
    return () => controller.abort();
  }, [open]);

  const spawn = (dir: string) => {
    if (!dir) return;
    onSpawn({ dir, persona });
    onOpenChange(false);
  };
  const resume = (sessionId: string, dir: string) => {
    if (!sessionId) return;
    onResume({ sessionId, dir, persona });
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[85dvh] gap-3 overflow-y-auto rounded-t-2xl border-line"
      >
        <SheetHeader className="text-left">
          <SheetTitle>New session</SheetTitle>
          <SheetDescription>Spawn a fresh persona or resume a past session.</SheetDescription>
        </SheetHeader>

        <div className="flex rounded-lg border border-line-strong p-0.5" role="tablist">
          {(["new", "resume"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={`flex-1 rounded-md py-1.5 text-sm font-medium capitalize transition-colors ${
                tab === value ? "bg-surface-strong text-fg" : "text-fg-muted hover:text-fg"
              }`}
            >
              {value}
            </button>
          ))}
        </div>

        {data && data.personas.length > 0 ? (
          <PersonaChips personas={data.personas} selected={persona} onSelect={setPersona} />
        ) : null}

        <LaunchFlags />

        {error ? (
          <p className="py-6 text-center text-sm text-danger">{error}</p>
        ) : !data ? (
          <p className="py-6 text-center text-sm text-fg-muted">Loading…</p>
        ) : tab === "new" ? (
          <NewList data={data} onSpawn={spawn} />
        ) : (
          <ResumeList data={data} onResume={resume} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function PersonaChips({
  personas,
  selected,
  onSelect,
}: {
  personas: string[];
  selected: string | null;
  onSelect: (persona: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {personas.map((persona) => {
        const active = persona === selected;
        return (
          <button
            key={persona}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(persona)}
            className={`flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-sm transition-colors ${
              active
                ? "border-accent bg-accent/10 text-fg"
                : "border-line text-fg-muted hover:bg-surface-hover"
            }`}
          >
            <PersonaAvatar persona={persona} />
            <span className="capitalize">{persona}</span>
          </button>
        );
      })}
    </div>
  );
}

function PersonaAvatar({ persona }: { persona: string }) {
  const ref = useRef<HTMLImageElement | null>(null);
  return (
    <img
      ref={ref}
      className="size-6 rounded-full bg-surface-strong object-cover"
      src={avatarSrc(persona.toLowerCase(), "idle")}
      alt=""
      onError={() => {
        const img = ref.current;
        if (img && !img.dataset.fellBack) {
          img.dataset.fellBack = "1";
          img.src = avatarSrc("default", "idle");
        }
      }}
    />
  );
}

function LaunchFlags() {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface/50 p-3 text-sm">
      <FlagCheckbox kind="skipPerms" label="Skip permission prompts" />
      <FlagCheckbox kind="remote" label="Remote control (Claude app)" />
      <label className="flex items-center justify-between gap-3">
        <span className="text-fg-muted">Model</span>
        <select
          defaultValue={getModel()}
          onChange={(e) => setModel(e.currentTarget.value as LaunchModel)}
          className="rounded-md border border-line-strong bg-surface px-2 py-1 text-sm text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {MODELS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function FlagCheckbox({ kind, label }: { kind: "skipPerms" | "remote"; label: string }) {
  return (
    <label className="flex items-center gap-2 text-fg-muted">
      <input
        type="checkbox"
        defaultChecked={getFlag(kind)}
        onChange={(e) => setFlag(kind, e.currentTarget.checked)}
        className="size-4 accent-[var(--room-accent)]"
      />
      {label}
    </label>
  );
}

function NewList({ data, onSpawn }: { data: PickerData; onSpawn: (dir: string) => void }) {
  const dirs = data.dirs.map((item) => ({
    dir: dirOf(item),
    label: labelOfDir(item),
  }));
  const projects = data.projectsDirs.map((item) => ({
    dir: item.dir,
    label: item.name || basename(item.dir),
  }));
  const merged = [...dirs, ...projects].filter((row) => row.dir);
  if (merged.length === 0) {
    return <p className="py-6 text-center text-sm text-fg-muted">No known projects</p>;
  }
  return (
    <ul className="flex flex-col gap-1.5">
      {merged.map((row) => (
        <PickerRow
          key={row.dir}
          label={row.label}
          sub={prettyPath(row.dir)}
          onClick={() => onSpawn(row.dir)}
        />
      ))}
    </ul>
  );
}

function ResumeList({
  data,
  onResume,
}: {
  data: PickerData;
  onResume: (sessionId: string, dir: string) => void;
}) {
  const rows = data.resumable
    .map((item) => ({
      sessionId: sessionIdOf(item),
      dir: dirOfResumable(item),
      label: labelOfResumable(item),
    }))
    .filter((row) => row.sessionId);
  if (rows.length === 0) {
    return <p className="py-6 text-center text-sm text-fg-muted">No resumable sessions</p>;
  }
  return (
    <ul className="flex flex-col gap-1.5">
      {rows.map((row) => (
        <PickerRow
          key={row.sessionId}
          label={row.label}
          sub={`${prettyPath(row.dir)} · ${row.sessionId.slice(0, 8)}`}
          onClick={() => onResume(row.sessionId, row.dir)}
        />
      ))}
    </ul>
  );
}

function PickerRow({
  label,
  sub,
  onClick,
}: {
  label: string;
  sub: string;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center gap-3 rounded-lg border border-line bg-surface/60 px-3 py-2.5 text-left transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-surface-strong text-fg-faint [&_svg]:size-4">
          <IconFolder />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-fg">{label}</span>
          <span className="block truncate text-[11px] text-fg-faint">{sub}</span>
        </span>
      </button>
    </li>
  );
}
