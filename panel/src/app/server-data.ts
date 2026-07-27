/**
 * Server-pushed non-snapshot data + the actions that mutate it — external
 * store fed by ONE client.onEvent subscription registered at bootstrap
 * (before client.start(); ordinary events are not replayed, so a late
 * subscription would drop them).
 *
 * The legacy handleServerEvent semantics move here VERBATIM (Sol #13):
 * - staleSessions cleared on every applied snapshot (onSnapshotApplied);
 * - unsupported/unknown_command disables ONLY the settings surface that is
 *   currently open (general vs buttons vs help writable/loaded flags);
 * - successful replies re-enable their surface;
 * - no_device cancels a pending learn capture BEFORE its toast.
 */
import type { ButtonPatch, Command, ResumableSession, ServerEvent } from "@room/protocol";
import type { RoomClient } from "@room/room-client";
import type { PlatformAdapter } from "../platform/types.js";
import { dispatchCommand } from "./commands.js";
import { getViewState, showErrorToast } from "./view-state.js";

export interface ButtonConfig {
  name: string;
  character?: string | null;
  action?: string | null;
  hold_action?: string | null;
  color?: ButtonColor | null;
  notes?: string | null;
}

export type ButtonColor = "white" | "blue" | "red" | "teal" | "yellow" | "green" | "black";
export const BUTTON_COLORS: ButtonColor[] = [
  "white",
  "blue",
  "red",
  "teal",
  "yellow",
  "green",
  "black",
];

export interface ShortcutSection {
  title: string;
  rows: [string, string][];
}

export interface VoiceOption {
  id: string;
  name: string;
  character?: string | null;
}

export interface RoomSettings {
  default_voice_id?: string | null;
  playback_mode?: string | null;
  mood?: string | null;
  speed?: number | null;
  notifications?: boolean | null;
  listening?: boolean | null;
  dynamic_acks?: string | null;
}

export type LearnMode = "rebind" | "add";

export interface ServerData {
  knownDirs: string[];
  resumable: ResumableSession[];
  buttonDeviceHint: string;
  buttonMappings: Record<string, ButtonConfig>;
  buttonActions: string[];
  buttonCharacters: string[];
  buttonsLoaded: boolean;
  buttonsWritable: boolean;
  settings: RoomSettings;
  settingsLoaded: boolean;
  settingsWritable: boolean;
  voices: VoiceOption[];
  voicesLoaded: boolean;
  shortcutsSections: ShortcutSection[];
  shortcutsLoaded: boolean;
  shortcutsAvailable: boolean;
  staleSessions: ReadonlySet<string>;
  /** Armed learn capture, if any (15s window; timer lives module-side). */
  learnCapture: { mode: LearnMode; oldIdx?: string } | null;
}

const LEARN_CAPTURE_MS = 15000;

const PICKER_ERROR_TEXT: Record<string, string> = {
  bad_dir: "Invalid project directory",
  bad_persona: "Unknown persona",
  bad_session: "Session no longer resumable",
};

let state: ServerData = {
  knownDirs: [],
  resumable: [],
  buttonDeviceHint: "",
  buttonMappings: {},
  buttonActions: [],
  buttonCharacters: [],
  buttonsLoaded: false,
  buttonsWritable: true,
  settings: {},
  settingsLoaded: false,
  settingsWritable: true,
  voices: [],
  voicesLoaded: false,
  shortcutsSections: [],
  shortcutsLoaded: false,
  shortcutsAvailable: true,
  staleSessions: new Set(),
  learnCapture: null,
};

const listeners = new Set<() => void>();
let learnTimer: ReturnType<typeof setTimeout> | null = null;

function setState(patch: Partial<ServerData>) {
  state = { ...state, ...patch };
  for (const cb of listeners) cb();
}

export function subscribeServerData(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export const getServerData = (): ServerData => state;

/**
 * Every command this store issues is a WRITE (settings, buttons, hold-room,
 * learn-capture), so all of them are correlated: a refusal or a dead socket
 * is reported instead of leaving optimistic local state that the daemon
 * never accepted (audit Q-10). Reads are requested from view-state.
 */
function write(cmd: Command, failText: string) {
  dispatchCommand(cmd, failText);
}

// ── Settings actions ──────────────────────────────────────────────────

export function commitSetting(
  key: keyof RoomSettings | "default_voice",
  value: string | number | boolean,
): void {
  if (!state.settingsWritable) return;
  const localKey = key === "default_voice" ? "default_voice_id" : key;
  setState({ settings: { ...state.settings, [localKey]: value } });
  write({ type: "set_setting", key, value }, "Couldn't save that setting");
}

export function sendHoldRoom(): void {
  write({ type: "hold_room" }, "Couldn't hold the room");
}

// ── Button actions ────────────────────────────────────────────────────

// Null clears a field on the wire — legal since the Phase 4 protocol/daemon
// fix (the panel always sent null; the server used to reject it silently).
function sendButtonPatch(idx: string, patch: ButtonPatch) {
  write({ type: "set_button", idx: Number(idx), patch }, "Couldn't save that button");
}

export function commitButtonPatch(idx: string, patch: Partial<ButtonConfig>): void {
  if (!state.buttonsWritable) return;
  const existing = state.buttonMappings[idx] ?? { name: `Button ${idx}` };
  setState({
    buttonMappings: { ...state.buttonMappings, [idx]: { ...existing, ...patch } },
  });
  sendButtonPatch(idx, patch as ButtonPatch);
}

export function removeButton(idx: string): void {
  if (!state.buttonsWritable) return;
  const next = { ...state.buttonMappings };
  delete next[idx];
  setState({ buttonMappings: next });
  write({ type: "remove_button", idx: Number(idx) }, "Couldn't remove that button");
}

export function cancelLearnCapture(): void {
  if (learnTimer) {
    clearTimeout(learnTimer);
    learnTimer = null;
  }
  if (state.learnCapture) setState({ learnCapture: null });
}

export function armLearnCapture(mode: LearnMode, oldIdx?: string): void {
  if (!state.buttonsWritable) return;
  cancelLearnCapture();
  setState({ learnCapture: { mode, oldIdx } });
  learnTimer = setTimeout(() => {
    learnTimer = null;
    setState({ learnCapture: null });
    showErrorToast("Button capture timed out");
  }, LEARN_CAPTURE_MS);
  write({ type: "learn_capture" }, "Couldn't start button capture");
}

function handleCapturedButton(idx: string) {
  const capture = state.learnCapture;
  if (!capture) return;
  cancelLearnCapture();

  if (capture.mode === "add") {
    const action = state.buttonActions[0] ?? null;
    setState({
      buttonMappings: {
        ...state.buttonMappings,
        [idx]: { name: `Button ${idx}`, action, color: "white", notes: "" },
      },
    });
    sendButtonPatch(idx, {
      name: `Button ${idx}`,
      action,
      character: null,
      color: "white",
      notes: "",
    });
    return;
  }

  const oldIdx = capture.oldIdx;
  if (!oldIdx) return;
  const existing = state.buttonMappings[oldIdx] ?? { name: `Button ${oldIdx}` };
  const next = { ...state.buttonMappings, [idx]: { ...existing } };
  // Rebind order matters: the new mapping is written BEFORE the old one is
  // removed, so a crash between the two never loses the binding.
  sendButtonPatch(idx, existing as ButtonPatch);
  if (idx !== oldIdx) {
    delete next[oldIdx];
    write({ type: "remove_button", idx: Number(oldIdx) }, "Couldn't remove the old button");
  }
  setState({ buttonMappings: next });
}

// ── Normalizers (moved verbatim from main.ts) ─────────────────────────

function normalizeSettings(value: unknown): RoomSettings {
  if (!value || typeof value !== "object") return {};
  const input = value as Record<string, unknown>;
  const next: RoomSettings = {};
  if (typeof input.default_voice_id === "string" || input.default_voice_id == null) {
    next.default_voice_id = input.default_voice_id as string | null | undefined;
  }
  if (typeof input.playback_mode === "string" || input.playback_mode == null) {
    next.playback_mode = input.playback_mode as string | null | undefined;
  }
  if (typeof input.mood === "string" || input.mood == null) {
    next.mood = input.mood as string | null | undefined;
  }
  if (typeof input.speed === "number" || input.speed == null) {
    next.speed = input.speed as number | null | undefined;
  }
  if (typeof input.notifications === "boolean" || input.notifications == null) {
    next.notifications = input.notifications as boolean | null | undefined;
  }
  if (typeof input.listening === "boolean" || input.listening == null) {
    next.listening = input.listening as boolean | null | undefined;
  }
  if (typeof input.dynamic_acks === "string" || input.dynamic_acks == null) {
    next.dynamic_acks = input.dynamic_acks as string | null | undefined;
  }
  return next;
}

function normalizeVoices(value: unknown): VoiceOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((voice) => {
    if (!voice || typeof voice !== "object") return [];
    const input = voice as Record<string, unknown>;
    const id =
      typeof input.id === "string"
        ? input.id
        : typeof input.voice_id === "string"
          ? input.voice_id
          : "";
    if (!id) return [];
    const name =
      typeof input.name === "string"
        ? input.name
        : typeof input.label === "string"
          ? input.label
          : id;
    const character =
      typeof input.character === "string" || input.character == null
        ? (input.character as string | null | undefined)
        : undefined;
    return [{ id, name, character }];
  });
}

// ── Event reducer ─────────────────────────────────────────────────────

function handleServerEvent(ev: ServerEvent, adapter: PlatformAdapter) {
  switch (ev.type) {
    case "snap": {
      const c = ev.corner;
      if (c === "bl" || c === "br" || c === "bc" || c === "tr") {
        void adapter.snapToCorner(c);
      }
      return;
    }

    case "known_dirs":
      setState({ knownDirs: ev.dirs });
      return;

    case "resumable":
      setState({ resumable: ev.sessions });
      return;

    case "buttons":
      // Wire buttons carry color as a plain string; currentButtonColor()
      // re-validates against BUTTON_COLORS on every read.
      setState({
        buttonDeviceHint: ev.device_hint,
        buttonMappings: ev.buttons as Record<string, ButtonConfig>,
        buttonActions: ev.actions,
        buttonCharacters: ev.characters,
        buttonsLoaded: true,
        buttonsWritable: true,
      });
      return;

    case "settings":
      setState({
        settings: normalizeSettings(ev.values),
        settingsLoaded: true,
        settingsWritable: true,
      });
      return;

    case "list_voices":
      setState({ voices: normalizeVoices(ev.voices), voicesLoaded: true });
      return;

    case "captured":
      handleCapturedButton(String(ev.idx));
      return;

    case "shortcuts":
      setState({
        shortcutsSections: ev.sections,
        shortcutsLoaded: true,
        shortcutsAvailable: true,
      });
      return;

    // Typed notices (spawn failures, dedup rejections, stale tmux) — the
    // server broadcasts these when a fire-and-forget action fails after the
    // optimistic "launching…" toast.
    case "notice":
      showErrorToast(ev.message);
      return;

    case "error": {
      const code = ev.code;
      if (code === "stale_session" && ev.sessionId) {
        const next = new Set(state.staleSessions);
        next.add(ev.sessionId);
        setState({ staleSessions: next });
      } else if (code in PICKER_ERROR_TEXT) {
        showErrorToast(PICKER_ERROR_TEXT[code]);
      } else if (code === "no_device") {
        cancelLearnCapture();
        showErrorToast("No button device detected");
      } else if (["unknown_command", "unsupported", "not_implemented"].includes(code)) {
        const view = getViewState();
        if (view.view !== "settings") return;
        if (view.settingsTab === "general") {
          setState({ settingsWritable: false, settingsLoaded: true, voicesLoaded: true });
        } else if (view.settingsTab === "buttons") {
          cancelLearnCapture();
          setState({ buttonsWritable: false, buttonsLoaded: true });
        } else {
          setState({ shortcutsAvailable: false, shortcutsLoaded: true });
        }
      }
      return;
    }

    // Correlated acks are consumed inside room-client (grant optimism,
    // request promises); this store has no use for them.
    case "command_result":
      return;
  }
}

/** Every applied snapshot clears stale markers (legacy applySnapshot). */
export function onSnapshotApplied(): void {
  if (state.staleSessions.size > 0) {
    setState({ staleSessions: new Set() });
  }
}

/** Wire the store to the client + adapter. Call BEFORE client.start(). */
export function initServerData(c: RoomClient, adapter: PlatformAdapter): void {
  c.onEvent((ev) => handleServerEvent(ev, adapter));
}
