import { useSyncExternalStore } from "react";
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

function selectedModel(): "" | "fable" | "opus" | "sonnet" | "haiku" {
  try {
    const value = localStorage.getItem(MODEL) ?? "";
    return MODELS.some(([model]) => model === value) ? value as ReturnType<typeof selectedModel> : "";
  } catch { return ""; }
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

function PersonaChips({ dir, project, sessionId }: { dir: string; project: string; sessionId?: string }) {
  const launch = (persona: string, label: string) => {
    const model = selectedModel();
    const flags = { skipPermissions: flagChecked(SKIP_PERMS), remoteControl: flagChecked(REMOTE), ...(model ? { model } : {}) };
    if (sessionId) client.send({ type: "resume_session", sessionId, dir, persona, ...flags });
    else client.send({ type: "spawn_session", dir, persona, ...flags });
    showLaunchToast(`launching ${label} in ${project}…`);
  };
  return <div className="persona-chips no-drag">{PERSONAS.map((persona) => (
    <button key={persona.name} type="button" className="persona-chip" data-persona={persona.name} data-label={persona.label} title={`Launch ${persona.label}`} onClick={(event) => { event.stopPropagation(); launch(persona.name, persona.label); }}>
      <span className="persona-chip-av"><img className="avatar persona-chip-img" src={personaAvatarSrc(persona)} alt="" onError={(event) => { const img = event.currentTarget; img.style.display = "none"; const fallback = img.nextElementSibling as HTMLElement | null; if (fallback) fallback.style.display = "flex"; }} /><span className="avatar-fallback persona-chip-fallback">{persona.label[0]}</span></span>
      <span className="persona-chip-label">{persona.label}</span>
    </button>
  ))}</div>;
}

export function PickerView() {
  const view = useSyncExternalStore(subscribeViewState, getViewState);
  const data = useSyncExternalStore(subscribeServerData, getServerData);
  const clientState = useSyncExternalStore(client.subscribe, client.getState);
  const pick = async () => {
    try { const dir = await platform.pickFolder(); if (dir) setBrowseDir(dir); } catch (error) { console.error("folder picker failed:", error); }
  };
  const browse = view.browseDir ? (() => {
    const dir = view.browseDir!; const name = basenameOf(dir); const path = prettyPath(dir);
    return <div className="picker-row picker-browse expanded" data-dir={dir} data-project={name} data-browse-row>
      <div className="picker-row-info picker-browse-info" title="Choose a different folder" onClick={(event) => { event.stopPropagation(); void pick(); }}><div className="picker-row-name" title={path}>{name}</div><div className="picker-row-sub" title={path}>{path}</div></div>
      <PersonaChips dir={dir} project={name} />
    </div>;
  })() : <div className="picker-row picker-browse" data-browse-row role="button" tabIndex={0} onClick={() => void pick()} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void pick(); } }}>
    <div className="picker-row-info"><div className="picker-row-name picker-browse-label"><span className="picker-browse-icon" aria-hidden="true"><IconFolder /></span><span>Start in another folder…</span></div></div>
  </div>;
  const rows = view.pickerTab === "new" ? <>{browse}{data.knownDirs.length ? data.knownDirs.map((dir) => { const name = basenameOf(dir); const path = prettyPath(dir); return <div key={dir} className="picker-row" data-dir={dir} data-project={name}><div className="picker-row-info"><div className="picker-row-name" title={path}>{name}</div><div className="picker-row-sub" title={path}>{path}</div></div><PersonaChips dir={dir} project={name} /></div>; }) : <p className="picker-empty">No known projects</p>}</> : data.resumable.length ? <>{data.resumable.map((session) => { const project = session.project || basenameOf(session.dir); return <div key={session.sessionId} className="picker-row" data-dir={session.dir} data-session={session.sessionId} data-project={project}><div className="picker-row-info"><div className="picker-row-name" title={prettyPath(session.dir)}>{project}</div><div className="picker-row-sub"><span className="picker-age">{humanizeAge(session.mtimeMs)}</span><span className="picker-sid">{session.sessionId.slice(0, 8)}</span></div></div><PersonaChips dir={session.dir} project={project} sessionId={session.sessionId} /></div>; })}</> : <p className="picker-empty">No resumable sessions</p>;
  const connected = clientState.connected;
  return <><header className="strip"><div className="strip-left"><BackButton /><span className="title">New Session</span></div><div className="header-actions no-drag"><span className={`conn-dot ${connected ? "up" : "down"}`} title={connected ? "Connected" : "Disconnected"}></span></div></header><main className="picker"><div className="picker-tabs no-drag" role="tablist"><button type="button" className={`picker-tab${view.pickerTab === "new" ? " active" : ""}`} data-picker-tab="new" role="tab" onClick={() => setPickerTab("new")}>New</button><button type="button" className={`picker-tab${view.pickerTab === "resume" ? " active" : ""}`} data-picker-tab="resume" role="tab" onClick={() => setPickerTab("resume")}>Resume</button></div><div className="picker-flags no-drag"><label className="picker-flag"><input type="checkbox" data-spawn-flag={SKIP_PERMS} defaultChecked={flagChecked(SKIP_PERMS)} onChange={(event) => { try { localStorage.setItem(SKIP_PERMS, event.currentTarget.checked ? "1" : "0"); } catch {} }} /> Skip permission prompts</label><label className="picker-flag"><input type="checkbox" data-spawn-flag={REMOTE} defaultChecked={flagChecked(REMOTE)} onChange={(event) => { try { localStorage.setItem(REMOTE, event.currentTarget.checked ? "1" : "0"); } catch {} }} /> Remote control (Claude app)</label><label className="picker-flag">Model <select data-spawn-model defaultValue={selectedModel()} onChange={(event) => { try { localStorage.setItem(MODEL, event.currentTarget.value); } catch {} }}>{MODELS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div><div className="picker-list">{rows}</div></main></>;
}
