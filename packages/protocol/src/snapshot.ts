/**
 * Room state as broadcast to every UI: the PanelSnapshot and its parts.
 *
 * This package is the single wire contract — the daemon builds these shapes
 * (state-watch.ts / audio.ts re-export from here) and both UIs consume them.
 * Schemas are non-strict on purpose: unknown keys pass through, so additive
 * server changes never break an older client.
 */
import * as v from "valibot";

export const SessionStateSchema = v.picklist([
  "working",
  "hand_raised",
  "speaking",
  "idle",
]);
export type SessionState = v.InferOutput<typeof SessionStateSchema>;

/** Word-level karaoke timings from ElevenLabs: [word, startMs][]. */
export const AlignmentTuplesSchema = v.array(v.tuple([v.string(), v.number()]));
export type AlignmentTuples = v.InferOutput<typeof AlignmentTuplesSchema>;

export const NowPlayingSchema = v.object({
  sessionId: v.string(),
  text: v.string(),
  startedAt: v.string(),
  approxCharsPerSec: v.number(),
  alignment: v.optional(AlignmentTuplesSchema),
  /** Post-EL atempo factor only (1.0 when none). Content timeline = wall * rate. */
  playbackRate: v.optional(v.number()),
  /** The pre-Gemini original message (what the agent actually wrote). */
  rawText: v.optional(v.string()),
  /** Present once playback finished; the file lingers as "last spoken". */
  endedAt: v.optional(v.string()),
  /** "ack" = off-stage prompt acknowledgment; "live" = live-mode clip. */
  kind: v.optional(v.picklist(["ack", "update", "live"])),
  /** Grant-to-phone: phone plays this exact replay file; Mac stays quiet. */
  output: v.optional(v.picklist(["mac", "phone"])),
  replayFile: v.optional(v.string()),
  grantId: v.optional(v.string()),
  /** false while the replay file is still growing (phone live-streams it). */
  synthesisComplete: v.optional(v.boolean()),
});
export type NowPlaying = v.InferOutput<typeof NowPlayingSchema>;

/** Live mode (intermediate narration) — null on AgentView when off. */
export const AgentLiveSchema = v.object({
  on: v.boolean(),
  toolCount: v.number(),
  turnStartedAt: v.nullable(v.string()),
  lastActivity: v.nullable(v.object({ label: v.string(), at: v.string() })),
});
export type AgentLive = v.InferOutput<typeof AgentLiveSchema>;

export const AgentViewSchema = v.object({
  sessionId: v.string(),
  name: v.string(),
  label: v.string(),
  state: SessionStateSchema,
  raisedAt: v.nullable(v.string()),
  character: v.nullable(v.string()),
  raisedCount: v.number(),
  supersededCount: v.number(),
  muted: v.boolean(),
  isTeam: v.boolean(),
  /** First ~120 chars of the grant target (newest-by-basename queue item). */
  queuedPreview: v.nullable(v.string()),
  /** team_map.json presence only — no tmux probes on snapshot builds. */
  injectable: v.boolean(),
  live: v.nullable(AgentLiveSchema),
});
export type AgentView = v.InferOutput<typeof AgentViewSchema>;

/** Fresh (<30s) reply-ack event for the phone; client keys on `at`. */
export const PhoneAckSchema = v.object({
  sessionId: v.string(),
  /** "<voiceId>/<basename>.mp3" under sounds/phrases, or null (chip only). */
  ackFile: v.nullable(v.string()),
  character: v.nullable(v.string()),
  at: v.string(),
});
export type PhoneAck = v.InferOutput<typeof PhoneAckSchema>;

export const PanelSnapshotSchema = v.object({
  /**
   * Daemon-local monotonic revision, stamped per snapshot build (Phase 0,
   * additive — optional so pre-revision payloads still validate). A client
   * must ignore any snapshot whose rev is lower than one it already applied.
   */
  rev: v.optional(v.number()),
  agents: v.array(AgentViewSchema),
  nowPlaying: v.nullable(NowPlayingSchema),
  roomHeld: v.boolean(),
  triageFocus: v.nullable(v.string()),
  /** pause.sh's SIGSTOP flag — panel freezes the mouth and shows resume. */
  paused: v.boolean(),
  phoneAck: v.nullable(PhoneAckSchema),
});
export type PanelSnapshot = v.InferOutput<typeof PanelSnapshotSchema>;
