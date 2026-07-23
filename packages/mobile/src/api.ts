/**
 * Same-origin HTTP the SPA needs beyond the RoomClient store. Components
 * never call fetch directly — they go through here.
 *
 * RoomClient.query() covers the WS/SSE query commands (list_resumable,
 * known_dirs, …) but NOT the daemon's combined `GET /picker` endpoint, so the
 * picker keeps a plain fetch. mobile-http serves /picker same-origin with no
 * token param (auth is the page cookie), matching legacy mobile.html.
 *
 * The replay catalog (`GET /replay-list`) and the fire-and-forget device
 * commands (`POST /action`) the audio controller needs also live here — same
 * cookie auth, mirroring mobile.html's fetchReplayList / postAction.
 */
import type { AlignmentTuples } from "@room/protocol";

/** A launchable directory: bare string or {dir|path, label|name}. */
export type PickerDir = string | { dir?: string; path?: string; label?: string; name?: string };

export interface PickerProjectDir {
  dir: string;
  name: string;
}

/** A resumable session: {sessionId|id, dir|path, label|name}. */
export interface PickerResumable {
  sessionId?: string;
  id?: string;
  dir?: string;
  path?: string;
  label?: string;
  name?: string;
}

export interface PickerData {
  personas: string[];
  dirs: PickerDir[];
  projectsDirs: PickerProjectDir[];
  resumable: PickerResumable[];
}

const EMPTY: PickerData = { personas: [], dirs: [], projectsDirs: [], resumable: [] };

/** GET /picker → sessions/personas for the New/Resume sheet. */
export async function fetchPicker(signal?: AbortSignal): Promise<PickerData> {
  const res = await fetch("/picker", { signal });
  if (!res.ok) throw new Error(`GET /picker failed: ${res.status}`);
  const raw: unknown = await res.json();
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    personas: Array.isArray(obj.personas)
      ? obj.personas.filter((p): p is string => typeof p === "string")
      : EMPTY.personas,
    dirs: Array.isArray(obj.dirs) ? (obj.dirs as PickerDir[]) : EMPTY.dirs,
    projectsDirs: Array.isArray(obj.projectsDirs)
      ? (obj.projectsDirs as PickerProjectDir[])
      : EMPTY.projectsDirs,
    resumable: Array.isArray(obj.resumable)
      ? (obj.resumable as PickerResumable[])
      : EMPTY.resumable,
  };
}

// --- shape normalizers (dir/session items come in a couple of forms) -------

export function dirOf(item: PickerDir): string {
  return typeof item === "string" ? item : (item.dir ?? item.path ?? "");
}

export function labelOfDir(item: PickerDir): string {
  const dir = dirOf(item);
  if (typeof item !== "string" && (item.label ?? item.name)) return (item.label ?? item.name)!;
  return basename(dir);
}

export function sessionIdOf(item: PickerResumable): string {
  return item.sessionId ?? item.id ?? "";
}

export function dirOfResumable(item: PickerResumable): string {
  return item.dir ?? item.path ?? "";
}

export function labelOfResumable(item: PickerResumable): string {
  return item.label ?? item.name ?? basename(dirOfResumable(item));
}

export function basename(dir: string): string {
  const parts = dir.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : dir;
}

export function prettyPath(dir: string): string {
  return dir.replace(/^\/Users\/[^/]+/, "~");
}

// --- replay catalog + device commands (audio controller) -------------------

/**
 * One entry in `GET /replay-list` (mobile-http listReplays). A replay .mp3 on
 * disk plus its JSON sidecar; `file` is the only guaranteed field. `alignment`
 * carries the ElevenLabs word timings the karaoke line renders.
 */
export interface ReplayEntry {
  file: string;
  sessionId?: string;
  sessionName?: string;
  character?: string;
  textPreview?: string;
  spokenText?: string;
  rawText?: string;
  alignment?: AlignmentTuples;
  playbackRate?: number;
  kind?: string;
  timestamp?: string;
}

function coerceAlignment(value: unknown): AlignmentTuples | undefined {
  if (!Array.isArray(value)) return undefined;
  const rows: AlignmentTuples = [];
  for (const row of value) {
    if (Array.isArray(row) && typeof row[0] === "string" && typeof row[1] === "number") {
      rows.push([row[0], row[1]]);
    }
  }
  return rows.length ? rows : undefined;
}

/** GET /replay-list → newest-first replay catalog (daemon sorts by filename). */
export async function fetchReplayList(signal?: AbortSignal): Promise<ReplayEntry[]> {
  const res = await fetch("/replay-list", { signal });
  if (!res.ok) throw new Error(`GET /replay-list failed: ${res.status}`);
  const raw: unknown = await res.json();
  if (!Array.isArray(raw)) return [];
  const out: ReplayEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const e = item as Record<string, unknown>;
    if (typeof e.file !== "string") continue;
    out.push({
      file: e.file,
      sessionId: typeof e.sessionId === "string" ? e.sessionId : undefined,
      sessionName: typeof e.sessionName === "string" ? e.sessionName : undefined,
      character: typeof e.character === "string" ? e.character : undefined,
      textPreview: typeof e.textPreview === "string" ? e.textPreview : undefined,
      spokenText: typeof e.spokenText === "string" ? e.spokenText : undefined,
      rawText: typeof e.rawText === "string" ? e.rawText : undefined,
      alignment: coerceAlignment(e.alignment),
      playbackRate: typeof e.playbackRate === "number" ? e.playbackRate : undefined,
      kind: typeof e.kind === "string" ? e.kind : undefined,
      timestamp: typeof e.timestamp === "string" ? e.timestamp : undefined,
    });
  }
  return out;
}

/**
 * Fire-and-forget `POST /action` (mobile.html postAction). Used by the audio
 * controller for the Mac↔phone handoff commands (stop / play_replay). Returns
 * the parsed body on success, null on any failure — callers treat null as
 * "didn't reach the daemon".
 */
export async function postAction(body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch("/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    try {
      return (await res.json()) as Record<string, unknown>;
    } catch {
      return {};
    }
  } catch {
    return null;
  }
}
