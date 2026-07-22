/**
 * Daemon → client event envelopes, discriminated on `type`.
 *
 * Additive by contract: clients MUST ignore unknown event kinds (use
 * parseServerEvent — it returns null for them) and unknown keys on known
 * kinds. The daemon may add both freely without a version bump.
 *
 * Transport notes:
 * - Panel WS receives all of these.
 * - Mobile SSE receives the bare PanelSnapshot (no `type` field, historical)
 *   plus `notice` events; other kinds are WS-only today.
 */
import * as v from "valibot";
import { PanelSnapshotSchema } from "./snapshot.js";

/**
 * Correlated reply to a command that carried a `requestId` (Phase 0, WS
 * path). `ok: true` means the command was accepted and dispatched — for
 * fire-and-forget commands it is NOT a completion signal; side effects (a
 * spawn finishing, audio starting) still arrive via snapshots and notices.
 */
export const CommandResultSchema = v.object({
  type: v.literal("command_result"),
  requestId: v.string(),
  ok: v.boolean(),
  /** Machine-readable failure code; see ERROR_CODES for the known set. */
  code: v.optional(v.string()),
  message: v.optional(v.string()),
  sessionId: v.optional(v.string()),
});
export type CommandResult = v.InferOutput<typeof CommandResultSchema>;

/** Known error codes today. Additive — treat unrecognized codes as generic failure. */
export const ERROR_CODES = [
  "bad_message",
  "stale_session",
  "not_team",
  "bad_dir",
  "bad_persona",
  "bad_session",
  "persona_busy",
  "stale_tmux",
  "no_device",
] as const;

export const SnapshotEventSchema = v.object({
  type: v.literal("snapshot"),
  ...PanelSnapshotSchema.entries,
});
export type SnapshotEvent = v.InferOutput<typeof SnapshotEventSchema>;

export const NoticeEventSchema = v.object({
  type: v.literal("notice"),
  message: v.string(),
});
export type NoticeEvent = v.InferOutput<typeof NoticeEventSchema>;

/** Legacy uncorrelated error frame — still emitted alongside CommandResult. */
export const ErrorEventSchema = v.object({
  type: v.literal("error"),
  code: v.string(),
  sessionId: v.optional(v.string()),
  message: v.optional(v.string()),
  requestId: v.optional(v.string()),
});
export type ErrorEvent = v.InferOutput<typeof ErrorEventSchema>;

export const ResumableSessionSchema = v.object({
  sessionId: v.string(),
  dir: v.string(),
  project: v.string(),
  mtimeMs: v.number(),
  sizeBytes: v.number(),
});
export type ResumableSession = v.InferOutput<typeof ResumableSessionSchema>;

export const ResumableEventSchema = v.object({
  type: v.literal("resumable"),
  sessions: v.array(ResumableSessionSchema),
  requestId: v.optional(v.string()),
});
export type ResumableEvent = v.InferOutput<typeof ResumableEventSchema>;

export const KnownDirsEventSchema = v.object({
  type: v.literal("known_dirs"),
  dirs: v.array(v.string()),
  requestId: v.optional(v.string()),
});
export type KnownDirsEvent = v.InferOutput<typeof KnownDirsEventSchema>;

export const ArcadeButtonSchema = v.object({
  name: v.string(),
  character: v.optional(v.string()),
  action: v.optional(v.string()),
  hold_action: v.optional(v.string()),
  color: v.optional(v.string()),
  notes: v.optional(v.string()),
});
export type ArcadeButtonWire = v.InferOutput<typeof ArcadeButtonSchema>;

export const ButtonsEventSchema = v.object({
  type: v.literal("buttons"),
  device_hint: v.string(),
  buttons: v.record(v.string(), ArcadeButtonSchema),
  actions: v.array(v.string()),
  characters: v.array(v.string()),
  requestId: v.optional(v.string()),
});
export type ButtonsEvent = v.InferOutput<typeof ButtonsEventSchema>;

export const SettingsEventSchema = v.object({
  type: v.literal("settings"),
  values: v.record(v.string(), v.unknown()),
  requestId: v.optional(v.string()),
});
export type SettingsEvent = v.InferOutput<typeof SettingsEventSchema>;

export const VoiceOptionSchema = v.object({
  voiceId: v.string(),
  /** Alias kept for the panel's normalizer (reads id/voice_id). */
  voice_id: v.optional(v.string()),
  name: v.string(),
  character: v.nullable(v.string()),
});
export type VoiceOption = v.InferOutput<typeof VoiceOptionSchema>;

export const ListVoicesEventSchema = v.object({
  type: v.literal("list_voices"),
  voices: v.array(VoiceOptionSchema),
  requestId: v.optional(v.string()),
});
export type ListVoicesEvent = v.InferOutput<typeof ListVoicesEventSchema>;

export const CapturedEventSchema = v.object({
  type: v.literal("captured"),
  idx: v.number(),
});
export type CapturedEvent = v.InferOutput<typeof CapturedEventSchema>;

export const ShortcutSectionSchema = v.object({
  title: v.string(),
  rows: v.array(v.tuple([v.string(), v.string()])),
});
export type ShortcutSection = v.InferOutput<typeof ShortcutSectionSchema>;

export const ShortcutsEventSchema = v.object({
  type: v.literal("shortcuts"),
  sections: v.array(ShortcutSectionSchema),
  requestId: v.optional(v.string()),
});
export type ShortcutsEvent = v.InferOutput<typeof ShortcutsEventSchema>;

/** HID joystick "snap window to corner" nudge. */
export const SnapEventSchema = v.object({
  type: v.literal("snap"),
  corner: v.string(),
});
export type SnapEvent = v.InferOutput<typeof SnapEventSchema>;

export const ServerEventSchema = v.variant("type", [
  SnapshotEventSchema,
  NoticeEventSchema,
  ErrorEventSchema,
  CommandResultSchema,
  ResumableEventSchema,
  KnownDirsEventSchema,
  ButtonsEventSchema,
  SettingsEventSchema,
  ListVoicesEventSchema,
  CapturedEventSchema,
  ShortcutsEventSchema,
  SnapEventSchema,
]);
export type ServerEvent = v.InferOutput<typeof ServerEventSchema>;

/**
 * Parse a daemon → client frame. Returns null for unknown event kinds and
 * malformed frames — per contract, callers skip null silently (unknown kinds
 * are ignorable so the protocol can grow additively).
 */
export function parseServerEvent(data: unknown): ServerEvent | null {
  const result = v.safeParse(ServerEventSchema, data);
  return result.success ? result.output : null;
}
