import { useState, useSyncExternalStore } from "react";
import { client } from "../client.js";
import { IconBack, IconFolder } from "./icons.js";
import { PERSONAS, personaAvatarSrc } from "./personas.js";
import {
  closePicker,
  getViewState,
  setBrowseDir,
  setPickerTab,
  showLaunchToast,
  subscribeViewState,
} from "./view-state.js";
import { getServerData, subscribeServerData } from "./server-data.js";
import { platform } from "../platform/tauri.js";

const SKIP_PERMS = "panel_flag_skip_perms";
const REMOTE = "panel_flag_remote";
const MODEL = "panel_flag_model";
const MODELS = [["", "Default"], ["fable", "Fable"], ["opus", "Opus"], ["sonnet", "Sonnet"], ["haiku", "Haiku"]] as const;
type ModelValue = (typeof MODELS)[number][0];

/** A staged (not-yet-launched) choice: persona + project (+ resume session). */
interface Selection {
  /** Unique per row so the same dir in two lists can't both light up. */
  rowKey: string;
  dir: string;
  project: string;
  persona: string;
  label: string;
  sessionId?: string;
}

function basenameOf(dir: string): string {
  const parts = dir.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : dir;
}

function prettyPath(dir: string): string {
  return dir.replace(/^\/Users\/[^/]+/, "~");
}

function humanizeAge(mtimeMs: number): string {
  const mins = Math.floor((Date.now() - mtimeMs) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function flagChecked(key: string): boolean {
  try { return localStorage.getItem(key) !== "0"; } catch { return true; }
}

function selectedModel(): ModelValue {
  try {
    const value = localStorage.getItem(MODEL) ?? "";
    return MODELS.some(([model]) => model === value) ? value as ModelValue : "";
  } catch { return ""; }
}

function modelLabel(value: ModelValue): string {
  return MODELS.find(([model]) => model === value)?.[1] ?? "Default";
}

function hideBrokenAvatar(event: React.SyntheticEvent<HTMLImageElement>) {
  const img = event.currentTarget;
  img.style.display = "none";
  const fallback = img.nextElementSibling as HTMLElement | null;
  if (fallback) fallback.style.display = "flex";
}

function BackButton() {
  const stop = (event: React.SyntheticEvent) => event.stopPropagation();
  return (
    <button
      type="button"
      className="icon-btn window-btn no-drag"
      data-window-action="picker-back"
      title="Back to room"
      onPointerDown={(event) => { event.stopPropagation(); event.preventDefault(); closePicker(); }}
      onMouseDown={stop}
      onClick={stop}
    >
      <IconBack />
    </button>
  );
}

/**
 * Persona avatars for one project row. Clicking a persona no longer fires a
 * spawn — it STAGES the choice (select-then-confirm); the sticky footer's
 * Start button is the only thing that launches. Prevents mis-fires from a
 * stray tap on an avatar.
 */
function PersonaChips({
  rowKey,
  dir,
  project,
  sessionId,
  selectedPersona,
  onSelect,
}: {
  rowKey: string;
  dir: string;
  project: string;
  sessionId?: string;
  selectedPersona?: string;
  onSelect: (selection: Selection) => void;
}) {
  return (
    <div className="persona-chips no-drag">
      {PERSONAS.map((persona) => {
        const selected = selectedPersona === persona.name;
        return (
          <button
            key={persona.name}
            type="button"
            className={`persona-chip${selected ? " selected" : ""}`}
            data-persona={persona.name}
            data-label={persona.label}
            title={`Select ${persona.label}`}
            aria-pressed={selected}
            onClick={(event) => {
              event.stopPropagation();
              onSelect({ rowKey, dir, project, persona: persona.name, label: persona.label, sessionId });
            }}
          >
            <span className="persona-chip-av">
              <img className="avatar persona-chip-img" src={personaAvatarSrc(persona)} alt="" onError={hideBrokenAvatar} />
              <span className="avatar-fallback persona-chip-fallback">{persona.label[0]}</span>
            </span>
            <span className="persona-chip-label">{persona.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function PickerView() {
  const view = useSyncExternalStore(subscribeViewState, getViewState);
  const data = useSyncExternalStore(subscribeServerData, getServerData);
  const clientState = useSyncExternalStore(client.subscribe, client.getState);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [model, setModel] = useState<ModelValue>(selectedModel());

  const isResume = view.pickerTab === "resume";
  const verb = isResume ? "Resume" : "Start";

  const pick = async () => {
    try { const dir = await platform.pickFolder(); if (dir) setBrowseDir(dir); } catch (error) { console.error("folder picker failed:", error); }
  };

  const switchTab = (tab: "new" | "resume") => {
    // Context (dirs/sessions) differs per tab, so a staged choice can't carry
    // across — clear it when switching.
    setSelected(null);
    setPickerTab(tab);
  };

  const start = () => {
    if (!selected) return;
    const flags = { skipPermissions: flagChecked(SKIP_PERMS), remoteControl: flagChecked(REMOTE), ...(model ? { model } : {}) };
    if (selected.sessionId) {
      client.send({ type: "resume_session", sessionId: selected.sessionId, dir: selected.dir, persona: selected.persona, ...flags });
    } else {
      client.send({ type: "spawn_session", dir: selected.dir, persona: selected.persona, ...flags });
    }
    showLaunchToast(`launching ${selected.label} in ${selected.project}…`);
    setSelected(null);
  };

  const personaFor = (rowKey: string) => (selected?.rowKey === rowKey ? selected.persona : undefined);

  const browse = view.browseDir ? (() => {
    const dir = view.browseDir!;
    const name = basenameOf(dir);
    const path = prettyPath(dir);
    const rowKey = `browse:${dir}`;
    return (
      <div className={`picker-row picker-browse expanded${personaFor(rowKey) ? " selected-row" : ""}`} data-dir={dir} data-project={name} data-browse-row>
        <div className="picker-row-info picker-browse-info" title="Choose a different folder" onClick={(event) => { event.stopPropagation(); void pick(); }}>
          <div className="picker-row-name" title={path}>{name}</div>
          <div className="picker-row-sub" title={path}>{path}</div>
        </div>
        <PersonaChips rowKey={rowKey} dir={dir} project={name} selectedPersona={personaFor(rowKey)} onSelect={setSelected} />
      </div>
    );
  })() : (
    <div className="picker-row picker-browse" data-browse-row role="button" tabIndex={0} onClick={() => void pick()} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void pick(); } }}>
      <div className="picker-row-info">
        <div className="picker-row-name picker-browse-label"><span className="picker-browse-icon" aria-hidden="true"><IconFolder /></span><span>Start in another folder…</span></div>
      </div>
    </div>
  );

  const rows = !isResume ? (
    <>
      {browse}
      {data.knownDirs.length ? data.knownDirs.map((dir) => {
        const name = basenameOf(dir);
        const path = prettyPath(dir);
        const rowKey = `new:${dir}`;
        return (
          <div key={dir} className={`picker-row${personaFor(rowKey) ? " selected-row" : ""}`} data-dir={dir} data-project={name}>
            <div className="picker-row-info"><div className="picker-row-name" title={path}>{name}</div><div className="picker-row-sub" title={path}>{path}</div></div>
            <PersonaChips rowKey={rowKey} dir={dir} project={name} selectedPersona={personaFor(rowKey)} onSelect={setSelected} />
          </div>
        );
      }) : <p className="picker-empty">No known projects</p>}
    </>
  ) : data.resumable.length ? (
    <>
      {data.resumable.map((session) => {
        const project = session.project || basenameOf(session.dir);
        const rowKey = `resume:${session.sessionId}`;
        return (
          <div key={session.sessionId} className={`picker-row${personaFor(rowKey) ? " selected-row" : ""}`} data-dir={session.dir} data-session={session.sessionId} data-project={project}>
            <div className="picker-row-info"><div className="picker-row-name" title={prettyPath(session.dir)}>{project}</div><div className="picker-row-sub"><span className="picker-age">{humanizeAge(session.mtimeMs)}</span><span className="picker-sid">{session.sessionId.slice(0, 8)}</span></div></div>
            <PersonaChips rowKey={rowKey} dir={session.dir} project={project} sessionId={session.sessionId} selectedPersona={personaFor(rowKey)} onSelect={setSelected} />
          </div>
        );
      })}
    </>
  ) : <p className="picker-empty">No resumable sessions</p>;

  const connected = clientState.connected;
  const chosenPersona = selected ? PERSONAS.find((persona) => persona.name === selected.persona) ?? null : null;

  return (
    <>
      <header className="strip">
        <div className="strip-left"><BackButton /><span className="title">New Session</span></div>
        <div className="header-actions no-drag"><span className={`conn-dot ${connected ? "up" : "down"}`} title={connected ? "Connected" : "Disconnected"}></span></div>
      </header>
      <main className="picker">
        <div className="picker-tabs no-drag" role="tablist">
          <button type="button" className={`picker-tab${!isResume ? " active" : ""}`} data-picker-tab="new" role="tab" onClick={() => switchTab("new")}>New</button>
          <button type="button" className={`picker-tab${isResume ? " active" : ""}`} data-picker-tab="resume" role="tab" onClick={() => switchTab("resume")}>Resume</button>
        </div>
        <div className="picker-flags no-drag">
          <label className="picker-flag"><input type="checkbox" data-spawn-flag={SKIP_PERMS} defaultChecked={flagChecked(SKIP_PERMS)} onChange={(event) => { try { localStorage.setItem(SKIP_PERMS, event.currentTarget.checked ? "1" : "0"); } catch {} }} /> Skip permission prompts</label>
          <label className="picker-flag"><input type="checkbox" data-spawn-flag={REMOTE} defaultChecked={flagChecked(REMOTE)} onChange={(event) => { try { localStorage.setItem(REMOTE, event.currentTarget.checked ? "1" : "0"); } catch {} }} /> Remote control (Claude app)</label>
          <label className="picker-flag">Model <select data-spawn-model value={model} onChange={(event) => { const value = event.currentTarget.value as ModelValue; setModel(value); try { localStorage.setItem(MODEL, value); } catch {} }}>{MODELS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        </div>
        <div className="picker-list">{rows}</div>
        {selected && chosenPersona ? (
          <div className="picker-confirm no-drag" role="region" aria-label="Confirm new session">
            <span className="picker-confirm-av">
              <img className="avatar picker-confirm-img" src={personaAvatarSrc(chosenPersona)} alt="" onError={hideBrokenAvatar} />
              <span className="avatar-fallback picker-confirm-fallback">{selected.label[0]}</span>
            </span>
            <div className="picker-confirm-info">
              <div className="picker-confirm-title">{selected.label} · {modelLabel(model)}</div>
              <div className="picker-confirm-sub" title={selected.project}>{verb} in {selected.project}</div>
            </div>
            <button type="button" className="picker-confirm-clear" onClick={() => setSelected(null)}>Clear</button>
            <button type="button" className="picker-confirm-start" onClick={start}>{verb}</button>
          </div>
        ) : null}
      </main>
    </>
  );
}
