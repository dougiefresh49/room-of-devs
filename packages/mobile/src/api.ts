/**
 * Same-origin HTTP the SPA needs beyond the RoomClient store. Components
 * never call fetch directly — they go through here.
 *
 * RoomClient.query() covers the WS/SSE query commands (list_resumable,
 * known_dirs, …) but NOT the daemon's combined `GET /picker` endpoint, so the
 * picker keeps a plain fetch. mobile-http serves /picker same-origin with no
 * token param (auth is the page cookie), matching legacy mobile.html.
 */

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
