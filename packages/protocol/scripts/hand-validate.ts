/**
 * Extract of the daemon's former hand-rolled validatePanelMessage
 * (tts-server/src/services/commands.ts). Kept so check-fixtures can run BOTH
 * this and protocol parseCommand and fail on disagreement (audit Q-1 / M-28).
 *
 * After single-sourcing, the daemon calls parseCommand; this file remains the
 * drift oracle for the fixture gate (must stay bit-compatible with what the
 * daemon enforced when the schemas were tightened).
 */
import type { ButtonPatch, Command, SpawnModel } from "../src/commands.js";

type PanelMessage = Command;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function isOptionalString(v: unknown): v is string | undefined {
  return v === undefined || typeof v === "string";
}

function isOptionalNullableString(v: unknown): v is string | null | undefined {
  return v === undefined || v === null || typeof v === "string";
}

function parseButtonPatch(raw: unknown): ButtonPatch | "bad_message" {
  if (!isPlainObject(raw)) return "bad_message";
  const keys = Object.keys(raw);
  const allowed = new Set(["name", "character", "action", "hold_action", "color", "notes"]);
  if (keys.length === 0 || keys.some((k) => !allowed.has(k))) return "bad_message";
  const patch = raw as Record<string, unknown>;
  if (
    !isOptionalString(patch.name) ||
    !isOptionalNullableString(patch.character) ||
    !isOptionalNullableString(patch.action) ||
    !isOptionalNullableString(patch.hold_action) ||
    !isOptionalNullableString(patch.color) ||
    !isOptionalNullableString(patch.notes)
  ) {
    return "bad_message";
  }
  if (
    typeof patch.character === "string" &&
    patch.character.length > 0 &&
    typeof patch.action === "string" &&
    patch.action.length > 0
  ) {
    return "bad_message";
  }
  return {
    name: patch.name,
    character: patch.character,
    action: patch.action,
    hold_action: patch.hold_action,
    color: patch.color,
    notes: patch.notes,
  };
}

const SPAWN_MODELS = new Set(["fable", "opus", "sonnet", "haiku"]);

function validSpawnFlags(msg: Record<string, unknown>): boolean {
  return (
    (msg.remoteControl === undefined || typeof msg.remoteControl === "boolean") &&
    (msg.skipPermissions === undefined || typeof msg.skipPermissions === "boolean") &&
    (msg.model === undefined || (typeof msg.model === "string" && SPAWN_MODELS.has(msg.model)))
  );
}

function spawnFlags(msg: Record<string, unknown>): {
  remoteControl?: boolean;
  skipPermissions?: boolean;
  model?: SpawnModel;
} {
  return {
    ...(typeof msg.remoteControl === "boolean" ? { remoteControl: msg.remoteControl } : {}),
    ...(typeof msg.skipPermissions === "boolean" ? { skipPermissions: msg.skipPermissions } : {}),
    ...(typeof msg.model === "string" ? { model: msg.model as SpawnModel } : {}),
  };
}

/**
 * Former daemon key-counting validator, plus a `reply` arm matching
 * handleReplyAction's shape checks (sessionId/text — not session-liveness).
 * `reply` was previously only validated on the mobile sync path; the schema
 * now encodes it, so the drift oracle must too.
 */
export function handValidatePanelMessage(raw: unknown): PanelMessage | "bad_message" {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "bad_message";
  const msg = raw as Record<string, unknown>;
  const keys = Object.keys(msg);

  switch (msg.type) {
    case "grant":
      if (typeof msg.sessionId !== "string" || !msg.sessionId.trim()) {
        return "bad_message";
      }
      if (keys.length === 2) {
        return { type: "grant", sessionId: msg.sessionId };
      }
      if (keys.length === 3 && (msg.output === "mac" || msg.output === "phone")) {
        return { type: "grant", sessionId: msg.sessionId, output: msg.output };
      }
      return "bad_message";
    case "ptt":
      if (
        keys.length !== 3 ||
        typeof msg.sessionId !== "string" ||
        !msg.sessionId.trim() ||
        (msg.phase !== "start" && msg.phase !== "stop")
      ) {
        return "bad_message";
      }
      return { type: "ptt", phase: msg.phase, sessionId: msg.sessionId };
    case "focus_terminal":
    case "kill_team":
    case "status_say":
    case "replay_session":
      if (keys.length !== 2 || typeof msg.sessionId !== "string" || !msg.sessionId.trim()) {
        return "bad_message";
      }
      return { type: msg.type, sessionId: msg.sessionId };
    case "replay":
    case "replay_slower":
    case "restart":
    case "stop":
    case "pause":
    case "list_resumable":
    case "known_dirs":
      if (keys.length !== 1) return "bad_message";
      return { type: msg.type };
    case "play_replay": {
      if (typeof msg.file !== "string" || !msg.file) return "bad_message";
      if (
        msg.file.includes("/") ||
        msg.file.includes("\\") ||
        msg.file.includes("\0") ||
        msg.file === "." ||
        msg.file === ".."
      ) {
        return "bad_message";
      }
      if (keys.length === 2) {
        return { type: "play_replay", file: msg.file };
      }
      if (
        keys.length === 3 &&
        typeof msg.offsetSec === "number" &&
        Number.isFinite(msg.offsetSec) &&
        msg.offsetSec >= 0
      ) {
        return { type: "play_replay", file: msg.file, offsetSec: msg.offsetSec };
      }
      return "bad_message";
    }
    case "phone_done":
      if (
        keys.length !== 2 ||
        typeof msg.file !== "string" ||
        !msg.file ||
        msg.file.includes("/") ||
        msg.file.includes("\\") ||
        msg.file.includes("\0")
      ) {
        return "bad_message";
      }
      // Schema also rejects "." / ".." (daemon phone_done did not); align so
      // the drift gate stays green after the schema tightening.
      if (msg.file === "." || msg.file === "..") return "bad_message";
      return { type: "phone_done", file: msg.file };
    case "spawn_session": {
      const allowed = new Set([
        "type",
        "dir",
        "persona",
        "remoteControl",
        "skipPermissions",
        "model",
      ]);
      if (
        keys.length < 3 ||
        keys.length > 6 ||
        keys.some((k) => !allowed.has(k)) ||
        typeof msg.dir !== "string" ||
        !msg.dir.trim() ||
        typeof msg.persona !== "string" ||
        !msg.persona.trim() ||
        !validSpawnFlags(msg)
      ) {
        return "bad_message";
      }
      return {
        type: "spawn_session",
        dir: msg.dir,
        persona: msg.persona,
        ...spawnFlags(msg),
      };
    }
    case "resume_session": {
      const allowed = new Set([
        "type",
        "sessionId",
        "dir",
        "persona",
        "remoteControl",
        "skipPermissions",
        "model",
      ]);
      if (
        keys.length < 4 ||
        keys.length > 7 ||
        keys.some((k) => !allowed.has(k)) ||
        typeof msg.sessionId !== "string" ||
        !msg.sessionId.trim() ||
        typeof msg.dir !== "string" ||
        !msg.dir.trim() ||
        typeof msg.persona !== "string" ||
        !msg.persona.trim() ||
        !validSpawnFlags(msg)
      ) {
        return "bad_message";
      }
      return {
        type: "resume_session",
        sessionId: msg.sessionId,
        dir: msg.dir,
        persona: msg.persona,
        ...spawnFlags(msg),
      };
    }
    case "set_live":
      if (
        typeof msg.sessionId !== "string" ||
        !msg.sessionId.trim() ||
        typeof msg.on !== "boolean"
      ) {
        return "bad_message";
      }
      if (keys.length === 3) {
        return { type: "set_live", sessionId: msg.sessionId, on: msg.on };
      }
      if (keys.length === 4 && typeof msg.muted === "boolean") {
        return { type: "set_live", sessionId: msg.sessionId, on: msg.on, muted: msg.muted };
      }
      return "bad_message";
    case "set_live_mute":
      if (
        keys.length !== 3 ||
        typeof msg.sessionId !== "string" ||
        !msg.sessionId.trim() ||
        typeof msg.muted !== "boolean"
      ) {
        return "bad_message";
      }
      return { type: "set_live_mute", sessionId: msg.sessionId, muted: msg.muted };
    case "speak_text": {
      if (
        typeof msg.sessionId !== "string" ||
        !msg.sessionId.trim() ||
        typeof msg.text !== "string" ||
        msg.text.length < 1 ||
        msg.text.length > 4000
      ) {
        return "bad_message";
      }
      if (keys.length === 3) {
        return { type: "speak_text", sessionId: msg.sessionId, text: msg.text };
      }
      if (keys.length === 4 && (msg.output === "mac" || msg.output === "phone")) {
        return { type: "speak_text", sessionId: msg.sessionId, text: msg.text, output: msg.output };
      }
      return "bad_message";
    }
    case "set_voice":
      if (
        keys.length !== 3 ||
        typeof msg.sessionId !== "string" ||
        !msg.sessionId.trim() ||
        typeof msg.character !== "string" ||
        !msg.character.trim()
      ) {
        return "bad_message";
      }
      return { type: "set_voice", sessionId: msg.sessionId, character: msg.character };
    case "set_nickname":
      if (
        keys.length !== 3 ||
        typeof msg.sessionId !== "string" ||
        !msg.sessionId.trim() ||
        typeof msg.label !== "string"
      ) {
        return "bad_message";
      }
      return { type: "set_nickname", sessionId: msg.sessionId, label: msg.label };
    case "hold_room":
      if (keys.length !== 1) return "bad_message";
      return { type: "hold_room" };
    case "get_buttons":
    case "get_shortcuts":
    case "learn_capture":
    case "get_settings":
    case "list_voices":
      if (keys.length !== 1) return "bad_message";
      return { type: msg.type };
    case "set_setting": {
      if (keys.length !== 3 || typeof msg.key !== "string" || !msg.key.trim()) {
        return "bad_message";
      }
      return { type: "set_setting", key: msg.key.trim(), value: msg.value };
    }
    case "set_button": {
      if (keys.length !== 3) return "bad_message";
      if (typeof msg.idx !== "number" || !Number.isInteger(msg.idx) || msg.idx < 0) {
        return "bad_message";
      }
      const patch = parseButtonPatch(msg.patch);
      if (patch === "bad_message") return "bad_message";
      return { type: "set_button", idx: msg.idx, patch };
    }
    case "remove_button":
      if (keys.length !== 2) return "bad_message";
      if (typeof msg.idx !== "number" || !Number.isInteger(msg.idx) || msg.idx < 0) {
        return "bad_message";
      }
      return { type: "remove_button", idx: msg.idx };
    case "reply": {
      // Shape checks from handleReplyAction (not session-liveness / inject).
      if (typeof msg.sessionId !== "string" || !msg.sessionId.trim()) return "bad_message";
      if (typeof msg.text !== "string") return "bad_message";
      const text = msg.text.trim();
      if (!text || text.length > 4000) return "bad_message";
      // Key count: type + sessionId + text only (envelope already stripped).
      if (keys.length !== 3) return "bad_message";
      return { type: "reply", sessionId: msg.sessionId, text: msg.text };
    }
    default:
      return "bad_message";
  }
}
