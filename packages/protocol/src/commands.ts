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
 * The daemon strips envelope fields before validating (splitCommandEnvelope
 * in panel-ws.ts / commands.ts). Schemas use strictObject so unknown keys
 * are rejected — matching the former hand-rolled key-counting validator.
 * Old message shapes remain accepted verbatim.
 */
import * as v from "valibot";

export const CommandSourceSchema = v.picklist(["desktop", "mobile", "voice", "interpreter"]);
export type CommandSource = v.InferOutput<typeof CommandSourceSchema>;

const envelope = {
  /** Non-empty — an empty string is not a correlation id and is rejected. */
  requestId: v.optional(v.pipe(v.string(), v.minLength(1))),
  source: v.optional(CommandSourceSchema),
};

/** Non-empty after trim — mirrors the daemon's `!s.trim()` guards. */
const NonEmptyString = v.pipe(
  v.string(),
  v.minLength(1),
  v.check((s) => s.trim().length > 0, "empty string"),
);

/**
 * Bare replay filename — no path separators / traversal.
 * Matches the former hand-rolled play_replay / phone_done checks.
 */
const ReplayFileName = v.pipe(
  v.string(),
  v.minLength(1),
  v.check(
    (f) => !f.includes("/") && !f.includes("\\") && !f.includes("\0") && f !== "." && f !== "..",
    "bare replay filename only",
  ),
);

/** Aliases accepted by `claude --model`; absent/empty = CLI default. */
export const SpawnModelSchema = v.picklist(["fable", "opus", "sonnet", "haiku"]);
export type SpawnModel = v.InferOutput<typeof SpawnModelSchema>;

const spawnFlags = {
  remoteControl: v.optional(v.boolean()),
  skipPermissions: v.optional(v.boolean()),
  model: v.optional(SpawnModelSchema),
};

/**
 * Arcade-button mapping patch. `undefined` leaves a field alone; `null`
 * (or `""`) clears it — the panel has always sent null to unassign, and
 * as of Phase 4 the server honors it (pre-4 it rejected null as
 * bad_message; see decisions-overnight.md). `name` is NOT clearable —
 * a mapped button always has a display name.
 *
 * Deliberately STRICT (unlike the forward-compatible snapshot schemas):
 * commands flow client → server and the server's parseButtonPatch rejects
 * unknown keys, empty patches, and character+action both set — the schema
 * mirrors that so every client learns the contract at the boundary.
 */
export const ButtonPatchSchema = v.pipe(
  v.strictObject({
    name: v.optional(v.string()),
    character: v.optional(v.nullable(v.string())),
    action: v.optional(v.nullable(v.string())),
    hold_action: v.optional(v.nullable(v.string())),
    color: v.optional(v.nullable(v.string())),
    notes: v.optional(v.nullable(v.string())),
  }),
  v.check((p) => Object.keys(p).length > 0, "empty button patch"),
  v.check(
    (p) =>
      !(
        typeof p.character === "string" &&
        p.character.length > 0 &&
        typeof p.action === "string" &&
        p.action.length > 0
      ),
    "character and action are mutually exclusive",
  ),
);
export type ButtonPatch = v.InferOutput<typeof ButtonPatchSchema>;

const sessionCommand = <T extends string>(type: T) =>
  v.strictObject({ type: v.literal(type), sessionId: NonEmptyString, ...envelope });

const bareCommand = <T extends string>(type: T) =>
  v.strictObject({ type: v.literal(type), ...envelope });

export const GrantCommandSchema = v.strictObject({
  type: v.literal("grant"),
  sessionId: NonEmptyString,
  output: v.optional(v.picklist(["mac", "phone"])),
  ...envelope,
});

export const PttCommandSchema = v.strictObject({
  type: v.literal("ptt"),
  phase: v.picklist(["start", "stop"]),
  sessionId: NonEmptyString,
  ...envelope,
});

export const PlayReplayCommandSchema = v.strictObject({
  type: v.literal("play_replay"),
  /** Bare replay filename — no path separators / traversal. */
  file: ReplayFileName,
  offsetSec: v.optional(v.pipe(v.number(), v.finite(), v.minValue(0, "offsetSec must be >= 0"))),
  ...envelope,
});

/** Phone finished playing a phone-routed clip: stamp endedAt on the frame so
 *  the "on phone" chip clears now instead of on the 5-min staleness belt. */
export const PhoneDoneCommandSchema = v.strictObject({
  type: v.literal("phone_done"),
  /** Bare replay filename — must match the current frame's replayFile. */
  file: ReplayFileName,
  ...envelope,
});

export const SpawnSessionCommandSchema = v.strictObject({
  type: v.literal("spawn_session"),
  dir: NonEmptyString,
  persona: NonEmptyString,
  ...spawnFlags,
  ...envelope,
});

export const ResumeSessionCommandSchema = v.strictObject({
  type: v.literal("resume_session"),
  sessionId: NonEmptyString,
  dir: NonEmptyString,
  persona: NonEmptyString,
  ...spawnFlags,
  ...envelope,
});

export const SetLiveCommandSchema = v.strictObject({
  type: v.literal("set_live"),
  sessionId: NonEmptyString,
  on: v.boolean(),
  /** Initial live-mute when turning on; ignored for off. */
  muted: v.optional(v.boolean()),
  ...envelope,
});

export const SetLiveMuteCommandSchema = v.strictObject({
  type: v.literal("set_live_mute"),
  sessionId: NonEmptyString,
  muted: v.boolean(),
  ...envelope,
});

export const SetVoiceCommandSchema = v.strictObject({
  type: v.literal("set_voice"),
  sessionId: NonEmptyString,
  character: NonEmptyString,
  ...envelope,
});

export const SetNicknameCommandSchema = v.strictObject({
  type: v.literal("set_nickname"),
  sessionId: NonEmptyString,
  label: v.string(),
  ...envelope,
});

export const SetSettingCommandSchema = v.strictObject({
  type: v.literal("set_setting"),
  /** Trimmed — matches former hand-rolled `key.trim()` on accept. */
  key: v.pipe(v.string(), v.trim(), v.nonEmpty()),
  value: v.unknown(),
  ...envelope,
});

export const SetButtonCommandSchema = v.strictObject({
  type: v.literal("set_button"),
  idx: v.pipe(v.number(), v.integer(), v.minValue(0)),
  patch: ButtonPatchSchema,
  ...envelope,
});

export const RemoveButtonCommandSchema = v.strictObject({
  type: v.literal("remove_button"),
  idx: v.pipe(v.number(), v.integer(), v.minValue(0)),
  ...envelope,
});

/** Mobile-only today: inject a typed reply into a team (tmux) session.
 *  Text cap 4000 matches handleReplyAction (trimmed length). */
export const ReplyCommandSchema = v.strictObject({
  type: v.literal("reply"),
  sessionId: NonEmptyString,
  text: v.pipe(
    v.string(),
    v.check((t) => {
      const trimmed = t.trim();
      return trimmed.length > 0 && trimmed.length <= 4000;
    }, "reply text must be 1–4000 chars after trim"),
  ),
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
  PhoneDoneCommandSchema,
  SpawnSessionCommandSchema,
  ResumeSessionCommandSchema,
  SetLiveCommandSchema,
  SetLiveMuteCommandSchema,
  SetVoiceCommandSchema,
  SetNicknameCommandSchema,
  SetSettingCommandSchema,
  SetButtonCommandSchema,
  RemoveButtonCommandSchema,
  ReplyCommandSchema,
]);
export type Command = v.InferOutput<typeof CommandSchema>;

/** Every command `type` the wire contract knows — fixture coverage + known-kind logs. */
export const COMMAND_TYPES = [
  "grant",
  "ptt",
  "focus_terminal",
  "kill_team",
  "status_say",
  "replay_session",
  "replay",
  "replay_slower",
  "restart",
  "stop",
  "pause",
  "hold_room",
  "list_resumable",
  "known_dirs",
  "get_buttons",
  "get_shortcuts",
  "get_settings",
  "list_voices",
  "learn_capture",
  "play_replay",
  "phone_done",
  "spawn_session",
  "resume_session",
  "set_live",
  "set_live_mute",
  "set_voice",
  "set_nickname",
  "set_setting",
  "set_button",
  "remove_button",
  "reply",
] as const;
export type CommandType = (typeof COMMAND_TYPES)[number];

const COMMAND_TYPE_SET = new Set<string>(COMMAND_TYPES);

/** True when `type` is a known command kind (even if the rest of the frame is malformed). */
export function isKnownCommandType(type: unknown): type is CommandType {
  return typeof type === "string" && COMMAND_TYPE_SET.has(type);
}

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
