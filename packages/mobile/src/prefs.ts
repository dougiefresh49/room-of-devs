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
 *   - mobile_speed_mult           number in SPEED_STEPS  (default 1)
 *   - mobile_listened_files       JSON string[] of replay filenames heard
 *   - mobile_cleared_files        JSON string[] of replay filenames cleared
 *
 * Daemon-side migration of hidden-devs/output is a deliberate post-cutover
 * follow-up (owner decision #7); until then they stay device-local. Speed,
 * listened, and cleared are chunk-D additions consumed by the audio
 * controller + replay history; same keys so history survives cutover.
 */

export type OutputDevice = "mac" | "phone";
export type LaunchModel = "" | "fable" | "opus" | "sonnet" | "haiku";

const OUTPUT_KEY = "mobile_output_device";
const HIDDEN_DEVS_KEY = "mobile_hidden_dev_names_v1";
const FLAG_SKIP_PERMS = "mobile_flag_skip_perms";
const FLAG_REMOTE = "mobile_flag_remote";
const FLAG_MODEL = "mobile_flag_model";
const SPEED_KEY = "mobile_speed_mult";
const LISTENED_KEY = "mobile_listened_files";
const CLEARED_KEY = "mobile_cleared_files";
/** Per-session live-narration mute intent (default unmuted when absent). */
const LIVE_MUTE_PREF_KEY = "mobile_live_mute_pref_v1";

const INITIAL_HIDDEN_DEV_NAMES = ["job-search-2026"];
const LAUNCH_MODELS: readonly LaunchModel[] = ["", "fable", "opus", "sonnet", "haiku"];

/** Phone static-playback speed cycle (mobile.html SPEED_STEPS, byte-for-byte). */
export const SPEED_STEPS: readonly number[] = [1, 1.25, 1.5, 1.75, 2];

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
  /** Phone static-playback speed multiplier (one of SPEED_STEPS). */
  speed: number;
  /** Replay filenames the user has heard (checkmark / unheard-count source). */
  listened: ReadonlySet<string>;
  /** Replay filenames hidden from the history list ("Clear messages"). */
  cleared: ReadonlySet<string>;
}

let snapshot: PrefsSnapshot = loadSnapshot();
const listeners = new Set<() => void>();

function loadSnapshot(): PrefsSnapshot {
  return {
    output: loadOutput(),
    hiddenNames: loadHiddenNames(),
    speed: loadSpeed(),
    listened: loadStrSet(LISTENED_KEY),
    cleared: loadStrSet(CLEARED_KEY),
  };
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

// --- speed (reactive; phone static playback only) --------------------------

function loadSpeed(): number {
  const value = parseFloat(read(SPEED_KEY) ?? "1");
  return SPEED_STEPS.includes(value) ? value : 1;
}

export function setSpeed(value: number): void {
  const speed = SPEED_STEPS.includes(value) ? value : 1;
  if (speed === snapshot.speed) return;
  write(SPEED_KEY, String(speed));
  emit({ ...snapshot, speed });
}

/** Advance to the next speed step (wraps); returns the new value. */
export function cycleSpeed(): number {
  const i = SPEED_STEPS.indexOf(snapshot.speed);
  const next = SPEED_STEPS[(i + 1) % SPEED_STEPS.length];
  setSpeed(next);
  return next;
}

export function getSpeed(): number {
  return snapshot.speed;
}

// --- listened / cleared string sets ----------------------------------------

function loadStrSet(key: string): ReadonlySet<string> {
  try {
    const raw = read(key);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function saveStrSet(key: string, set: ReadonlySet<string>): void {
  write(key, JSON.stringify([...set]));
}

export function isListened(file: string): boolean {
  return snapshot.listened.has(file);
}

export function markListened(file: string): void {
  if (!file || snapshot.listened.has(file)) return;
  const listened = new Set(snapshot.listened);
  listened.add(file);
  saveStrSet(LISTENED_KEY, listened);
  emit({ ...snapshot, listened });
}

export function isCleared(file: string): boolean {
  return snapshot.cleared.has(file);
}

/** "Clear messages": mark every given file heard AND cleared (mobile.html). */
export function clearFiles(files: readonly string[]): void {
  let listenedChanged = false;
  let clearedChanged = false;
  const listened = new Set(snapshot.listened);
  const cleared = new Set(snapshot.cleared);
  for (const f of files) {
    if (!f) continue;
    if (!listened.has(f)) {
      listened.add(f);
      listenedChanged = true;
    }
    if (!cleared.has(f)) {
      cleared.add(f);
      clearedChanged = true;
    }
  }
  if (!listenedChanged && !clearedChanged) return;
  if (listenedChanged) saveStrSet(LISTENED_KEY, listened);
  if (clearedChanged) saveStrSet(CLEARED_KEY, cleared);
  emit({ ...snapshot, listened, cleared });
}

/**
 * Drop listened/cleared entries whose files are no longer in the catalog —
 * mobile.html's pruneAgainst, run whenever the replay list refreshes so the
 * sets don't grow unbounded across the app's lifetime.
 */
export function pruneToFiles(files: readonly string[]): void {
  const present = new Set(files);
  const listened = new Set([...snapshot.listened].filter((f) => present.has(f)));
  const cleared = new Set([...snapshot.cleared].filter((f) => present.has(f)));
  const listenedChanged = listened.size !== snapshot.listened.size;
  const clearedChanged = cleared.size !== snapshot.cleared.size;
  if (!listenedChanged && !clearedChanged) return;
  if (listenedChanged) saveStrSet(LISTENED_KEY, listened);
  if (clearedChanged) saveStrSet(CLEARED_KEY, cleared);
  emit({ ...snapshot, listened, cleared });
}

/** The spawn/resume flag block, exactly as mobile.html's launchFlags(). */
// --- live-mute sticky pref (per session) -----------------------------------

function loadLiveMutePrefs(): Record<string, boolean> {
  try {
    const raw = read(LIVE_MUTE_PREF_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof k === "string" && typeof v === "boolean") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/** Last user mute intent for go-live initial state (default false). */
export function getLiveMutePref(sessionId: string): boolean {
  return loadLiveMutePrefs()[sessionId] === true;
}

/** Record mute intent at dispatch time (not snapshot ack). */
export function setLiveMutePref(sessionId: string, muted: boolean): void {
  const prefs = loadLiveMutePrefs();
  if (muted) prefs[sessionId] = true;
  else delete prefs[sessionId];
  write(LIVE_MUTE_PREF_KEY, JSON.stringify(prefs));
}

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
