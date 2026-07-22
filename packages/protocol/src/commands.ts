/**
 * Client → daemon commands (WS panel path and mobile POST /action share this
 * vocabulary; the mobile allowlist stays server-authoritative in panel-ws).
 *
 * Envelope fields, additive in Phase 0:
 * - `requestId`: correlation id. When present on the WS path the daemon
 *   replies with a CommandResult (see events.ts) in addition to any legacy
 *   frames. Absent → legacy fire-and-forget behavior, unchanged.
 * - `source`: authenticated actor context (desktop | mobile | voice |
 *   interpreter). RESERVATION ONLY — no server logic keys off it yet; it
 *   exists so the future conversational interpreter joins without a protocol
 *   break (docs/design-conversational-layer.md).
 *
 * The daemon's strict validator counts keys, so it strips envelope fields
 * before validating (splitCommandEnvelope in panel-ws.ts). Old message
 * shapes remain accepted verbatim.
 */
import * as v from "valibot";

export const CommandSourceSchema = v.picklist([
  "desktop",
  "mobile",
  "voice",
  "interpreter",
]);
export type CommandSource = v.InferOutput<typeof CommandSourceSchema>;

const envelope = {
  /** Non-empty — an empty string is not a correlation id and is rejected. */
  requestId: v.optional(v.pipe(v.string(), v.minLength(1))),
  source: v.optional(CommandSourceSchema),
};

/** Aliases accepted by `claude --model`; absent/empty = CLI default. */
export const SpawnModelSchema = v.picklist(["fable", "opus", "sonnet", "haiku"]);
export type SpawnModel = v.InferOutput<typeof SpawnModelSchema>;

const spawnFlags = {
  remoteControl: v.optional(v.boolean()),
  skipPermissions: v.optional(v.boolean()),
  model: v.optional(SpawnModelSchema),
};

export const ButtonPatchSchema = v.object({
  name: v.optional(v.string()),
  character: v.optional(v.string()),
  action: v.optional(v.string()),
  hold_action: v.optional(v.string()),
  color: v.optional(v.string()),
  notes: v.optional(v.string()),
});
export type ButtonPatch = v.InferOutput<typeof ButtonPatchSchema>;

const sessionCommand = <T extends string>(type: T) =>
  v.object({ type: v.literal(type), sessionId: v.string(), ...envelope });

const bareCommand = <T extends string>(type: T) =>
  v.object({ type: v.literal(type), ...envelope });

export const GrantCommandSchema = v.object({
  type: v.literal("grant"),
  sessionId: v.string(),
  output: v.optional(v.picklist(["mac", "phone"])),
  ...envelope,
});

export const PttCommandSchema = v.object({
  type: v.literal("ptt"),
  phase: v.picklist(["start", "stop"]),
  sessionId: v.string(),
  ...envelope,
});

export const PlayReplayCommandSchema = v.object({
  type: v.literal("play_replay"),
  /** Bare replay filename — no path separators / traversal. */
  file: v.string(),
  offsetSec: v.optional(v.number()),
  ...envelope,
});

export const SpawnSessionCommandSchema = v.object({
  type: v.literal("spawn_session"),
  dir: v.string(),
  persona: v.string(),
  ...spawnFlags,
  ...envelope,
});

export const ResumeSessionCommandSchema = v.object({
  type: v.literal("resume_session"),
  sessionId: v.string(),
  dir: v.string(),
  persona: v.string(),
  ...spawnFlags,
  ...envelope,
});

export const SetLiveCommandSchema = v.object({
  type: v.literal("set_live"),
  sessionId: v.string(),
  on: v.boolean(),
  ...envelope,
});

export const SetVoiceCommandSchema = v.object({
  type: v.literal("set_voice"),
  sessionId: v.string(),
  character: v.string(),
  ...envelope,
});

export const SetNicknameCommandSchema = v.object({
  type: v.literal("set_nickname"),
  sessionId: v.string(),
  label: v.string(),
  ...envelope,
});

export const SetSettingCommandSchema = v.object({
  type: v.literal("set_setting"),
  key: v.string(),
  value: v.unknown(),
  ...envelope,
});

export const SetButtonCommandSchema = v.object({
  type: v.literal("set_button"),
  idx: v.number(),
  patch: ButtonPatchSchema,
  ...envelope,
});

export const RemoveButtonCommandSchema = v.object({
  type: v.literal("remove_button"),
  idx: v.number(),
  ...envelope,
});

/** Mobile-only today: inject a typed reply into a team (tmux) session. */
export const ReplyCommandSchema = v.object({
  type: v.literal("reply"),
  sessionId: v.string(),
  text: v.string(),
  ...envelope,
});

export const CommandSchema = v.variant("type", [
  GrantCommandSchema,
  PttCommandSchema,
  sessionCommand("focus_terminal"),
  sessionCommand("kill_team"),
  sessionCommand("status_say"),
  sessionCommand("replay_session"),
  bareCommand("replay"),
  bareCommand("replay_slower"),
  bareCommand("restart"),
  bareCommand("stop"),
  bareCommand("pause"),
  bareCommand("hold_room"),
  bareCommand("list_resumable"),
  bareCommand("known_dirs"),
  bareCommand("get_buttons"),
  bareCommand("get_shortcuts"),
  bareCommand("get_settings"),
  bareCommand("list_voices"),
  bareCommand("learn_capture"),
  PlayReplayCommandSchema,
  SpawnSessionCommandSchema,
  ResumeSessionCommandSchema,
  SetLiveCommandSchema,
  SetVoiceCommandSchema,
  SetNicknameCommandSchema,
  SetSettingCommandSchema,
  SetButtonCommandSchema,
  RemoveButtonCommandSchema,
  ReplyCommandSchema,
]);
export type Command = v.InferOutput<typeof CommandSchema>;

/**
 * Request/response commands: the daemon answers with a dedicated reply frame
 * (resumable, known_dirs, buttons, shortcuts, settings, list_voices) rather
 * than only side effects. Everything else is fire-and-forget.
 */
export const QUERY_COMMAND_TYPES = [
  "list_resumable",
  "known_dirs",
  "get_buttons",
  "get_shortcuts",
  "get_settings",
  "list_voices",
] as const;

/** Parse an incoming command; null = unknown/invalid (caller rejects). */
export function parseCommand(data: unknown): Command | null {
  const result = v.safeParse(CommandSchema, data);
  return result.success ? result.output : null;
}
