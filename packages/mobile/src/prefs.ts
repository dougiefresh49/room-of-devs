/**
 * Client-side mobile preferences — the localStorage layer the legacy
 * mobile.html owned inline. Kept as a tiny external store so React re-renders
 * when the reactive prefs (output device, hidden devs) change.
 *
 * localStorage keys are PRESERVED byte-for-byte from mobile.html so a user's
 * state survives the SPA cutover:
 *   - mobile_output_device        "mac" | "phone"        (default "mac")
 *   - mobile_hidden_dev_names_v1  JSON string[] (sorted) (seed ["job-search-2026"])
 *   - mobile_flag_skip_perms      "1" | "0"              (default "1" / true)
 *   - mobile_flag_remote          "1" | "0"              (default "1" / true)
 *   - mobile_flag_model           "" | fable|opus|sonnet|haiku (default "")
 *
 * Daemon-side migration of hidden-devs/output is a deliberate post-cutover
 * follow-up (owner decision #7); until then they stay device-local.
 */

export type OutputDevice = "mac" | "phone";
export type LaunchModel = "" | "fable" | "opus" | "sonnet" | "haiku";

const OUTPUT_KEY = "mobile_output_device";
const HIDDEN_DEVS_KEY = "mobile_hidden_dev_names_v1";
const FLAG_SKIP_PERMS = "mobile_flag_skip_perms";
const FLAG_REMOTE = "mobile_flag_remote";
const FLAG_MODEL = "mobile_flag_model";

const INITIAL_HIDDEN_DEV_NAMES = ["job-search-2026"];
const LAUNCH_MODELS: readonly LaunchModel[] = ["", "fable", "opus", "sonnet", "haiku"];

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

// --- reactive slice (output device + hidden devs) --------------------------

interface PrefsSnapshot {
  output: OutputDevice;
  /** Sorted list of hidden agent RAW names (agent.name, not label). */
  hiddenNames: readonly string[];
}

let snapshot: PrefsSnapshot = loadSnapshot();
const listeners = new Set<() => void>();

function loadSnapshot(): PrefsSnapshot {
  return { output: loadOutput(), hiddenNames: loadHiddenNames() };
}

function emit(next: PrefsSnapshot): void {
  snapshot = next;
  for (const cb of listeners) cb();
}

export function subscribePrefs(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Stable-reference snapshot for useSyncExternalStore. */
export function getPrefs(): PrefsSnapshot {
  return snapshot;
}

// --- output device ---------------------------------------------------------

function loadOutput(): OutputDevice {
  return read(OUTPUT_KEY) === "phone" ? "phone" : "mac";
}

export function setOutputDevice(value: OutputDevice): void {
  const output: OutputDevice = value === "phone" ? "phone" : "mac";
  if (output === snapshot.output) return;
  write(OUTPUT_KEY, output);
  emit({ ...snapshot, output });
}

// --- hidden devs ------------------------------------------------------------

function loadHiddenNames(): readonly string[] {
  const raw = read(HIDDEN_DEVS_KEY);
  if (raw === null) {
    // First run: seed + persist (mirrors mobile.html's seed()).
    persistHidden(INITIAL_HIDDEN_DEV_NAMES);
    return sortedUnique(INITIAL_HIDDEN_DEV_NAMES);
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("not an array");
    const cleaned = sortedUnique(
      parsed.filter((n): n is string => typeof n === "string").map((n) => n.trim()),
    );
    // Re-persist if we had to normalize (drops empties/dupes, sorts).
    if (cleaned.length !== parsed.length) persistHidden(cleaned);
    return cleaned;
  } catch {
    persistHidden(INITIAL_HIDDEN_DEV_NAMES);
    return sortedUnique(INITIAL_HIDDEN_DEV_NAMES);
  }
}

function sortedUnique(names: string[]): string[] {
  return [...new Set(names.filter((n) => n.length > 0))].sort();
}

function persistHidden(names: string[]): void {
  write(HIDDEN_DEVS_KEY, JSON.stringify(sortedUnique(names)));
}

export function isHiddenName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length > 0 && snapshot.hiddenNames.includes(trimmed);
}

export function setDevHidden(name: string, hidden: boolean): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  const has = snapshot.hiddenNames.includes(trimmed);
  if (has === hidden) return;
  const next = hidden
    ? [...snapshot.hiddenNames, trimmed]
    : snapshot.hiddenNames.filter((n) => n !== trimmed);
  const hiddenNames = sortedUnique(next);
  persistHidden(hiddenNames);
  emit({ ...snapshot, hiddenNames });
}

// --- launch flags (non-reactive; read on picker open, written on change) ---

/** "0" means off; anything else (incl. unset) means on — matches mobile.html. */
export function getFlag(kind: "skipPerms" | "remote"): boolean {
  return read(kind === "skipPerms" ? FLAG_SKIP_PERMS : FLAG_REMOTE) !== "0";
}

export function setFlag(kind: "skipPerms" | "remote", on: boolean): void {
  write(kind === "skipPerms" ? FLAG_SKIP_PERMS : FLAG_REMOTE, on ? "1" : "0");
}

export function getModel(): LaunchModel {
  const value = read(FLAG_MODEL) ?? "";
  return LAUNCH_MODELS.includes(value as LaunchModel) ? (value as LaunchModel) : "";
}

export function setModel(value: LaunchModel): void {
  write(FLAG_MODEL, value);
}

/** The spawn/resume flag block, exactly as mobile.html's launchFlags(). */
export function launchFlags(): {
  skipPermissions: boolean;
  remoteControl: boolean;
  model?: LaunchModel;
} {
  const model = getModel();
  return {
    skipPermissions: getFlag("skipPerms"),
    remoteControl: getFlag("remote"),
    ...(model ? { model } : {}),
  };
}
