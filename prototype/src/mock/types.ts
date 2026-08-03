/** Mock room model for THE RIG prototype. Invented fields are wishlist for wire. */

/** Persona id → avatar folder under panel/public/avatars/tmnt. */
export type PersonaId =
  | "mikey"
  | "donnie"
  | "leo"
  | "raph"
  | "splinter"
  | "shredder"
  | "karai";

export type RoomId = string;
export type Ceremony = "full" | "one-off";
export type GearDefault = "bare" | "light" | "full";
export type BrainTable = "lean" | "std" | "deep";
export type FloorState = "has" | "queued" | "lull";

/** Craft lifecycle — board thread-node states. */
export type CraftState =
  | "working"
  | "needs-you"
  | "settled"
  | "spawning"
  | "empty";

/** Plan dock state on the spine rail. */
export type PlanDock = "live" | "queued" | "settled" | "birth";

/** Zoom ladder hard cuts — PLOT ↔ RAIL ↔ NODE. */
export type ViewMode = "plot" | "console" | "node";

/** Load-bearing room moods driven by control-deck triggers. */
export type RoomMood = "normal" | "arrival" | "mic-open" | "the-lull";

export interface HeldOption {
  id: string;
  label: string;
  detail: string;
  /** Spoken phrase hint shown on the keycap. */
  speakHint: string;
  /** Mikey's recommendation — armed glow. */
  armed: boolean;
}

export interface HeldQuestion {
  craftId: string;
  prompt: string;
  options: HeldOption[];
}

export interface TailLine {
  kind: "cmd" | "ok" | "info" | "typing";
  text: string;
}

export interface DiffStub {
  file: string;
  lines: { kind: "ctx" | "add" | "del"; text: string }[];
}

export interface Craft {
  /** Fleet seam attribution: the room this mortal craft belongs to. */
  roomId: RoomId;
  id: string;
  ticket: string;
  persona: PersonaId;
  callsign: string;
  task: string;
  state: CraftState;
  /** 0 = needs you NOW, 100 = settle-side rim. Wishlist wire field. */
  salience: number;
  /** Signed CLR this craft is pulling off the room aggregate. Wishlist wire field. */
  salienceDelta: number;
  planId: string | null;
  lastStamp: string;
  holdSeconds: number;
  watched: boolean;
  open: boolean;
  tmux: boolean;
  tokens: number;
  spendUsd: number;
  turns: number;
  tail: TailLine[];
  diff: DiffStub | null;
  /** One-off crafts have no conduit and die on delivery. */
  oneOff: boolean;
  /** Polar angle in degrees for plot placement. */
  plotAngle: number;
}

export interface Plan {
  id: string;
  name: string;
  dock: PlanDock;
  /** Step bars: done | live | todo. */
  steps: ("done" | "live" | "todo")[];
  stepLabel: string;
  gearTag: string;
  status: string;
  schematic: "active" | "queued" | "plain";
}

export interface Verb {
  id: string;
  utterance: string;
  params: string;
  on: boolean;
  /** Watcher verbs racked with GATED #N tag. */
  gatedIssue: number | null;
}

export interface Artifact {
  id: string;
  title: string;
  craftId: string;
  /** kept | pending | discarded */
  status: "pending" | "kept" | "discarded";
  /** Canned SVG markup shown when opened. */
  svg: string;
}

/**
 * One provider guard window. Each provider only has the windows its billing
 * actually exposes:
 *   · CLAUDE      5H session bucket (resets) + FABLE 7D window
 *   · CODEX       session bucket (resets)    + 7D window
 *   · CURSOR      30-day rolling window, no session reset
 *   · ELEVENLABS  30-day billing cycle, $ used / $ cap, no session reset
 *   · GEMINI      no windows at all — a month-to-date spend tracker whose
 *                 end-stop is an arbitrary GOAL, not a provider cap
 * Wishlist wire fields.
 */
export interface GuardWindow {
  /** Short window label, e.g. "5H SESSION", "FABLE 7D", "30D", "MONTH". */
  window: string;
  /** Utilization 0–1 against this window's cap. */
  fraction: number;
  /** Human readout under the bar, e.g. "42%" or "$4.10 / $10". */
  readout: string;
}

export interface ProviderGuard {
  id: "claude" | "codex" | "cursor" | "elevenlabs" | "gemini";
  label: string;
  windows: GuardWindow[];
  /**
   * THIS SESSION's share of the same cap, 0–1 — the thin blue outer arc on
   * the dials. Resets to 0 every session while the window meter keeps
   * climbing. `null` for providers that have NO session reset at all
   * (Cursor, ElevenLabs, Gemini) — those never draw a blue arc.
   */
  sessionFraction: number | null;
}

export interface SpendState {
  /** Month draw fraction 0–1 (legacy CORE hex shell input; console uses worstGuard). */
  monthFraction: number;
  /** ElevenLabs 30-day billing cycle: $ used against the $ cap. */
  elevenlabsUsd: number;
  elevenlabsCap: number;
  /** Gemini month-to-date spend. No window resets — just a running tracker. */
  geminiUsd: number;
  /** Self-imposed spend GOAL used as the dial's end-stop (not a real cap). */
  geminiGoalUsd: number;
  voiceCharsToday: number;
  /** CORE pulse while burning. */
  burning: boolean;
  /**
   * How much of the 7-day guard window is still ahead of us, 1 → 0. Drives the
   * CORE's inner energy ball: full and bright at 1, small and dim near reset.
   */
  windowResetFraction: number;
  /** Human readout for the same, e.g. "4D 09H TO RESET". */
  windowResetLabel: string;
  /** Per-provider guard board — the tiles on GAUGES and the CORE's worst-guard read. */
  guards: ProviderGuard[];
}

export interface SalienceState {
  /** Aggregate clear % (needle). */
  clearPct: number;
  /** Speak-gate threshold — draggable in prototype. */
  threshold: number;
  contributors: { label: string; delta: number }[];
}

export interface TranscriptRow {
  who: string;
  text: string;
  you?: boolean;
}

export interface TapIn {
  question: string;
  interpreter: string;
  answer: string | null;
}

export interface CrewMember {
  id: PersonaId;
  callsign: string;
  role: string;
  /** Lit = piloting a craft right now. */
  piloting: boolean;
}

export interface RoomState {
  view: ViewMode;
  mood: RoomMood;
  /** Open node craft id when view === "node". */
  focusCraftId: string | null;
  plans: Plan[];
  crafts: Craft[];
  heldQuestion: HeldQuestion | null;
  spend: SpendState;
  salience: SalienceState;
  verbs: Verb[];
  artifacts: Artifact[];
  /** Second-voice checkout. */
  donnieCheckout: { purpose: string; elapsed: string } | null;
  micHot: boolean;
  grantArmed: boolean;
  grantCountdown: number;
  turnChip: { model: string; costUsd: number };
  /** Console dial positions. Dial homes are derived, never edited independently. Wishlist wire field. */
  dials: { ceremony: GearDefault; voice: PersonaId; brain: BrainTable };
  /** Which voice the faceplate is wearing (dial 2's home). Wishlist wire field. */
  voicePersona: PersonaId;
  transcript: TranscriptRow[];
  tapIn: TapIn | null;
  crew: CrewMember[];
  clock: string;
  rev: number;
  /** Live clip ticker text for watched craft. */
  liveClip: string | null;
  /** Composer draft. */
  composerText: string;
  speakingPersona: PersonaId | null;
  dockTicker: string;
  dockLedRed: boolean;
  /** Which device holds the speaker gate — routed chip + AUD LED. Wishlist wire field. */
  audio: { route: "phone" | "mac"; gateCountdown: string };
  /** Turn-final digests parked for the lull — LISTEN's dim queue line. Wishlist wire field. */
  queuedForLull: string[];
}

/** The file a commission writes: rooms/<name>/manifest.json. */
export interface RoomManifest {
  room: RoomId;
  name: string;
  repo: string;
  ceremony: Ceremony;
  /** null ⇒ scratch room; nothing durable is written. */
  spine: { tracker: "github"; repo: string } | null;
  cast: { lead: PersonaId; checkout: PersonaId[] };
  gearDefault: GearDefault;   // dial 1 — home: PLAN CARD
  brainTable: BrainTable;     // dial 3 — home: TURN CHIP
  connectors: string[];       // "gh-issues" | "tmux" | "vercel" | "sentry"
}

/** One berth on the hangar floor — manifest + the rollups a plate reads. */
export interface RoomBerth {
  id: RoomId;
  manifest: RoomManifest;
  /** null = scratch berth: dashed, un-numbered, dissolves on settle. */
  berth: number | null;
  /** Scratch spawned from inside a room — "FROM R-DEVS". */
  parentRoomId: RoomId | null;
  salience: { clearPct: number; worstCraftId: string | null };
  counts: { working: number; needsYou: number; settled: number; watchers: number };
  /** Spine glyph blocks. Scratch berths report zeroes and render none. */
  docked: { live: number; queued: number; settled: number };
  ticker: string;
}

/** One row of the ONE shared salience queue, room-attributed, worst-first. */
export interface TrafficRow {
  roomId: RoomId;
  craftId: string | null;
  label: string;
  salience: number;
  /** Below the single fleet-wide speak gate — Mikey may raise it unprompted. */
  belowGate: boolean;
  floorState: FloorState;
}

/** Exactly one holder or null — the global audio floor made explicit. */
export interface AudioFloor {
  roomId: RoomId | null;
  persona: PersonaId | null;
  elapsed: string;
  route: "phone" | "mac";
  queue: { roomId: RoomId; reason: string }[];
}

export interface CommissionDraft {
  berth: number | null;
  name: string;
  repo: string;
  ceremony: Ceremony;
  gearDefault: GearDefault;
  lead: PersonaId;
  checkout: PersonaId[];
  brainTable: BrainTable;
  connectors: Record<string, boolean>;
  /** "voice" ⇒ prefilled by Mikey; drives the receipt line. */
  source: "rig" | "voice";
}

export interface FleetState {
  zoom: "hangar" | "room";
  activeRoomId: RoomId;
  rooms: RoomBerth[];
  traffic: TrafficRow[];
  audioFloor: AudioFloor;
  /** ONE gate, fleet-wide. Mirrors salience.threshold; not per-room. */
  threshold: number;
  commission: CommissionDraft | null;
}
