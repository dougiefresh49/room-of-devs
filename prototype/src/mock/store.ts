import { useSyncExternalStore } from "react";
import { makeFixtures, makeFleetFixtures } from "./fixtures";
import type {
  CommissionDraft,
  FleetState,
  RoomBerth,
  RoomId,
  RoomManifest,
  RoomState,
  SpendState,
} from "./types";

export interface AppState {
  fleet: FleetState;
  rooms: Record<RoomId, RoomState>;
}

let state: AppState = makeFleetFixtures();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function getRoom(): RoomState {
  const room = state.rooms[state.fleet.activeRoomId];
  if (!room) throw new Error(`Active room not found: ${state.fleet.activeRoomId}`);
  return room;
}

export function getFleet(): FleetState {
  return state.fleet;
}

export function getAppState(): AppState {
  return state;
}

export function setRoom(next: RoomState | ((prev: RoomState) => RoomState)) {
  const roomId = state.fleet.activeRoomId;
  const current = getRoom();
  const room = typeof next === "function" ? next(current) : next;
  state = { ...state, rooms: { ...state.rooms, [roomId]: room } };
  emit();
}

export function patchRoom(partial: Partial<RoomState>) {
  setRoom((s) => ({ ...s, ...partial, rev: s.rev + 1 }));
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useRoom(): RoomState {
  return useSyncExternalStore(subscribe, getRoom, getRoom);
}

export function setFleet(next: FleetState | ((prev: FleetState) => FleetState)) {
  const fleet = typeof next === "function" ? next(state.fleet) : next;
  state = { ...state, fleet };
  emit();
}

export function patchFleet(partial: Partial<FleetState>) {
  setFleet((fleet) => ({ ...fleet, ...partial }));
}

export function setAppState(next: AppState | ((prev: AppState) => AppState)) {
  state = typeof next === "function" ? next(state) : next;
  emit();
}

export function useFleet(): FleetState {
  return useSyncExternalStore(subscribe, getFleet, getFleet);
}

export function useAppState(): AppState {
  return useSyncExternalStore(subscribe, getAppState, getAppState);
}

/** Stable manifest-directory spelling for the live commissioning pane. */
export function commissionRoomId(name: string): RoomId {
  return (
    name
      .trim()
      .toLocaleLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "untitled-room"
  );
}

function nextBerthNumber(fleet: FleetState): number {
  return Math.max(0, ...fleet.rooms.map((room) => room.berth ?? 0)) + 1;
}

/** Open the shared commission draft from either the RIG bench or Mikey's voice path. */
export function openCommission(source: CommissionDraft["source"] = "rig") {
  setFleet((fleet) => ({
    ...fleet,
    zoom: "hangar",
    commission: {
      berth: nextBerthNumber(fleet),
      name: source === "voice" ? "story-engine" : "new-room",
      repo: source === "voice" ? "dougiefresh49/story-engine" : "dougiefresh49/new-room",
      ceremony: "full",
      gearDefault: "light",
      lead: source === "voice" ? "leo" : "mikey",
      checkout: source === "voice" ? ["donnie"] : [],
      brainTable: "lean",
      connectors: {
        "gh-issues": true,
        tmux: true,
        vercel: false,
        sentry: false,
      },
      source,
    },
  }));
}

/** One control change on the bench updates the single live-bound draft. */
export function updateCommission(patch: Partial<CommissionDraft>) {
  setFleet((fleet) =>
    fleet.commission
      ? { ...fleet, commission: { ...fleet.commission, ...patch } }
      : fleet,
  );
}

export interface StrikeReceipt {
  roomId: RoomId;
  name: string;
  ceremony: CommissionDraft["ceremony"];
  berth: number | null;
}

/** Mock commission: materialize one berth from the draft, then close the bench. */
export function strikeCommission(): StrikeReceipt | null {
  let receipt: StrikeReceipt | null = null;
  setAppState((app) => {
    const draft = app.fleet.commission;
    if (!draft) return app;

    const baseId = commissionRoomId(draft.name);
    let roomId = baseId;
    let suffix = 2;
    while (app.rooms[roomId]) {
      roomId = `${baseId}-${suffix}`;
      suffix += 1;
    }

    const ceremony = draft.ceremony;
    const berth =
      ceremony === "full"
        ? app.fleet.rooms.some((room) => room.berth === draft.berth)
          ? nextBerthNumber(app.fleet)
          : (draft.berth ?? nextBerthNumber(app.fleet))
        : null;
    const connectors = Object.entries(draft.connectors)
      .filter(([, enabled]) => enabled)
      .map(([connector]) => connector);
    const manifest: RoomManifest = {
      room: roomId,
      name: draft.name.trim() || roomId,
      repo: draft.repo.trim(),
      ceremony,
      spine: ceremony === "full" ? { tracker: "github", repo: draft.repo.trim() } : null,
      cast: { lead: draft.lead, checkout: draft.checkout },
      gearDefault: draft.gearDefault,
      brainTable: draft.brainTable,
      connectors,
    };
    const berthSummary: RoomBerth = {
      id: roomId,
      manifest,
      berth,
      parentRoomId: ceremony === "one-off" ? app.fleet.activeRoomId : null,
      salience: { clearPct: 100, worstCraftId: null },
      counts: {
        working: ceremony === "one-off" ? 1 : 0,
        needsYou: 0,
        settled: 0,
        watchers: 0,
      },
      docked: { live: 0, queued: 0, settled: 0 },
      ticker:
        ceremony === "full"
          ? "MANIFEST CHECKED IN · AWAITING FIRST PLAN"
          : "MIKEY NARRATES · SCRATCH BERTH · DIES ON DELIVERY",
    };
    const template = makeFixtures(roomId);
    const room: RoomState = {
      ...template,
      view: "console",
      mood: "normal",
      focusCraftId: null,
      plans: [],
      crafts: [],
      heldQuestion: null,
      artifacts: [],
      donnieCheckout: null,
      salience: {
        clearPct: 100,
        threshold: app.fleet.threshold,
        contributors: [{ label: "NEW BERTH · FLOOR CLEAR", delta: 0 }],
      },
      transcript: [
        {
          who: "MIKEY",
          text:
            draft.source === "voice"
              ? `Berth ${berth ?? "scratch"} struck from the voice draft.`
              : `Berth ${berth ?? "scratch"} struck from the commissioning bench.`,
          at: Date.now(),
        },
      ],
      queuedForLull: [],
      dockTicker: berthSummary.ticker,
      dockLedRed: false,
      speakingPersona: null,
      nowPlaying: null,
      lastClip: null,
      rev: template.rev + 1,
    };

    receipt = { roomId, name: manifest.name, ceremony, berth };
    return {
      fleet: {
        ...app.fleet,
        zoom: "hangar",
        rooms: [...app.fleet.rooms, berthSummary],
        commission: null,
      },
      rooms: { ...app.rooms, [roomId]: room },
    };
  });
  return receipt;
}

/**
 * The single tightest guard across every provider window — what the CORE
 * shows at a glance. Returns null only if there are no guards at all.
 */
export function worstGuard(
  spend: SpendState,
): { label: string; window: string; fraction: number } | null {
  let worst: { label: string; window: string; fraction: number } | null = null;
  for (const g of spend.guards) {
    for (const w of g.windows) {
      if (!worst || w.fraction > worst.fraction) {
        worst = { label: g.label, window: w.window, fraction: w.fraction };
      }
    }
  }
  return worst;
}

/**
 * TOTAL draw across everything we meter — the plain mean of every guard
 * window's utilization. Defensible because each window is already normalized
 * to its own cap, so "half the hexes lit" reads as "the room is running at
 * about half of what it's allowed", regardless of which provider is hot.
 */
export function aggregateDraw(spend: SpendState): number {
  const windows = spend.guards.flatMap((g) => g.windows);
  if (windows.length === 0) return spend.monthFraction;
  const sum = windows.reduce((a, w) => a + w.fraction, 0);
  return Math.min(1, Math.max(0, sum / windows.length));
}

export function resetRoom() {
  state = makeFleetFixtures();
  emit();
}
