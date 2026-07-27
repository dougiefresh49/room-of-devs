/**
 * Panel view state — external store (useSyncExternalStore-compatible).
 *
 * Not React state because window-action handlers, server-event handlers
 * (server-data.ts), and toast timers all touch it, and 4b's mode plumbing
 * lives outside any component. One store per webview realm; in 4b the two
 * realms deliberately do NOT share view state (daemon snapshots are the
 * only cross-realm channel — summary dismissal going per-realm is a
 * documented delta).
 */
import type { Command } from "@room/protocol";
import type { RoomClient } from "@room/room-client";

export type ViewName = "room" | "picker" | "settings";
export type PickerTab = "new" | "resume";
export type SettingsTab = "general" | "buttons" | "help";

export interface ToastState {
  kind: "launch" | "error";
  text: string;
}

export interface ViewState {
  view: ViewName;
  pickerTab: PickerTab;
  settingsTab: SettingsTab;
  browseDir: string | null;
  renamingSessionId: string | null;
  dockCaptions: boolean;
  roomSummaryPane: boolean;
  dockSummaryExpanded: boolean;
  /** Bubble the user ✕-ed away; keyed per message so the next re-appears. */
  dockSummaryDismissedKey: string | null;
  dockHoverSessionId: string | null;
  toast: ToastState | null;
  /** Polite live-region text (see announce()). Empty when nothing to say. */
  announcement: string;
}

const CAPTIONS_STORAGE_KEY = "roomDockCaptions";
const SUMMARY_PANE_KEY = "roomSummaryPane";
export const DOCK_HOVER_LEAVE_MS = 250;
const LAUNCH_TOAST_MS = 2000;
const ERROR_TOAST_MS = 2600;
const ANNOUNCE_CLEAR_MS = 4000;

let state: ViewState = {
  view: "room",
  pickerTab: "new",
  settingsTab: "general",
  browseDir: null,
  renamingSessionId: null,
  dockCaptions: localStorage.getItem(CAPTIONS_STORAGE_KEY) === "1",
  roomSummaryPane: localStorage.getItem(SUMMARY_PANE_KEY) === "1",
  dockSummaryExpanded: false,
  dockSummaryDismissedKey: null,
  dockHoverSessionId: null,
  toast: null,
  announcement: "",
};

const listeners = new Set<() => void>();
let client: RoomClient | null = null;
/** Called when the settings surface closes (cancels a pending learn capture). */
let onSettingsClosed: (() => void) | null = null;

let pickerReturnTimer: ReturnType<typeof setTimeout> | null = null;
let toastClearTimer: ReturnType<typeof setTimeout> | null = null;
let announceClearTimer: ReturnType<typeof setTimeout> | null = null;
let lastErrorToast = 0;
let announceToggle = false;
let dockHoverHideTimer: ReturnType<typeof setTimeout> | null = null;

function setState(patch: Partial<ViewState>) {
  state = { ...state, ...patch };
  for (const cb of listeners) cb();
}

export function subscribeViewState(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export const getViewState = (): ViewState => state;

export function initViewState(c: RoomClient, settingsClosedHook: () => void): void {
  client = c;
  onSettingsClosed = settingsClosedHook;
}

/**
 * Query sends (known_dirs / get_settings / …). These are answered by domain
 * reply frames the server-data store consumes, so they stay one-way — but a
 * send that never left the panel must not leave a view spinning silently
 * (audit U-1): say so.
 */
function send(cmd: Command) {
  if (client?.send(cmd) === false) {
    showErrorToast("Room is offline — can't load that yet");
  }
}

function clearToastTimers() {
  if (pickerReturnTimer) {
    clearTimeout(pickerReturnTimer);
    pickerReturnTimer = null;
  }
  if (toastClearTimer) {
    clearTimeout(toastClearTimer);
    toastClearTimer = null;
  }
}

// ── Toasts ────────────────────────────────────────────────────────────

/** Launch toast: shows 2s, then clears AND returns from the picker. */
export function showLaunchToast(text: string): void {
  clearToastTimers();
  setState({ toast: { kind: "launch", text } });
  pickerReturnTimer = setTimeout(() => {
    pickerReturnTimer = null;
    setState({ toast: null, view: "room", browseDir: null });
  }, LAUNCH_TOAST_MS);
}

export function showErrorToast(text: string): void {
  clearToastTimers();
  lastErrorToast = Date.now();
  setState({ toast: { kind: "error", text } });
  toastClearTimer = setTimeout(() => {
    toastClearTimer = null;
    setState({ toast: null });
  }, ERROR_TOAST_MS);
}

/**
 * When the last error toast was shown — how commands.ts knows the daemon's
 * own `error`/`notice` frame already explained a failure and a second,
 * vaguer message would be noise.
 */
export const lastErrorToastAt = (): number => lastErrorToast;

// ── Screen-reader announcements ───────────────────────────────────────

/**
 * Polite live-region text for state changes that are otherwise only visual
 * (audit U-6: the end-session arm window arms and expires with nothing
 * announced). Kept separate from toasts: toasts are transient UI with their
 * own timers and one of them steals the picker's return timer.
 */
export function announce(text: string): void {
  if (announceClearTimer) clearTimeout(announceClearTimer);
  // A live region only speaks when its text CHANGES, and React batches the
  // clear-then-set trick into one paint — so repeats (arm, expire, arm
  // again) carry an alternating invisible suffix instead.
  announceToggle = !announceToggle;
  setState({ announcement: announceToggle ? text : `${text} ` });
  announceClearTimer = setTimeout(() => {
    announceClearTimer = null;
    setState({ announcement: "" });
  }, ANNOUNCE_CLEAR_MS);
}

// ── Views ─────────────────────────────────────────────────────────────

export function openPicker(): void {
  clearToastTimers();
  setState({
    view: "picker",
    pickerTab: "new",
    browseDir: null,
    toast: null,
  });
  send({ type: "known_dirs" });
  send({ type: "list_resumable" });
}

export function closePicker(): void {
  clearToastTimers();
  setState({ view: "room", browseDir: null, toast: null });
}

export function setPickerTab(tab: PickerTab): void {
  if (state.pickerTab !== tab) setState({ pickerTab: tab });
}

export function setBrowseDir(dir: string | null): void {
  setState({ browseDir: dir });
}

export function requestSettingsTabData(tab: SettingsTab): void {
  if (tab === "general") {
    send({ type: "get_settings" });
    send({ type: "list_voices" });
  } else if (tab === "buttons") {
    send({ type: "get_buttons" });
  } else {
    send({ type: "get_shortcuts" });
  }
}

export function openSettings(): void {
  clearToastTimers();
  setState({ view: "settings", settingsTab: "general", toast: null });
  requestSettingsTabData("general");
}

export function closeSettings(): void {
  clearToastTimers();
  onSettingsClosed?.();
  setState({ view: "room", toast: null });
}

export function setSettingsTab(tab: SettingsTab): void {
  if (state.settingsTab === tab) return;
  setState({ settingsTab: tab });
  requestSettingsTabData(tab);
}

// ── Dock / summary ────────────────────────────────────────────────────

export function toggleCaptions(): void {
  const next = !state.dockCaptions;
  localStorage.setItem(CAPTIONS_STORAGE_KEY, next ? "1" : "0");
  setState({
    dockCaptions: next,
    dockSummaryExpanded: next ? state.dockSummaryExpanded : false,
  });
}

export function toggleSummaryPane(): void {
  const next = !state.roomSummaryPane;
  localStorage.setItem(SUMMARY_PANE_KEY, next ? "1" : "0");
  setState({ roomSummaryPane: next });
}

export function toggleDockSummaryExpanded(): void {
  setState({ dockSummaryExpanded: !state.dockSummaryExpanded });
}

export function dismissSummary(key: string): void {
  setState({ dockSummaryDismissedKey: key, dockSummaryExpanded: false });
}

// ── Rename ────────────────────────────────────────────────────────────

export function startRename(sessionId: string): void {
  setState({ renamingSessionId: sessionId });
}

export function endRename(): void {
  if (state.renamingSessionId !== null) setState({ renamingSessionId: null });
}

// ── Dock hover intent (250ms leave grace, verbatim legacy semantics) ──

export function dockHoverEnter(sessionId: string): void {
  if (dockHoverHideTimer) {
    clearTimeout(dockHoverHideTimer);
    dockHoverHideTimer = null;
  }
  if (state.dockHoverSessionId !== sessionId) {
    setState({ dockHoverSessionId: sessionId });
  }
}

export function dockHoverLeave(sessionId: string): void {
  if (dockHoverHideTimer) clearTimeout(dockHoverHideTimer);
  dockHoverHideTimer = setTimeout(() => {
    dockHoverHideTimer = null;
    if (state.dockHoverSessionId === sessionId) {
      setState({ dockHoverSessionId: null });
    }
  }, DOCK_HOVER_LEAVE_MS);
}

// ── Snapshot pruning (called from the bootstrap subscription) ─────────

export function pruneViewState(liveSessionIds: ReadonlySet<string>): void {
  const patch: Partial<ViewState> = {};
  let dirty = false;
  if (state.renamingSessionId && !liveSessionIds.has(state.renamingSessionId)) {
    patch.renamingSessionId = null;
    dirty = true;
  }
  if (dirty) setState(patch);
}
