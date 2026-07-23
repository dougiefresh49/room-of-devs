/**
 * Mobile room shell (Phase 5, chunks C + D). Owns the store reads and wires the
 * shared RoomClient to the presentational components:
 *   Header (device toggle, hold, catch-up)  ·  RoomGrid of AgentCards  ·
 *   HiddenDevs  ·  ReplayHistory  ·  docked MiniPlayer  ·  Toast  ·  PickerSheet.
 *
 * Audio is the AudioController's job (src/audio/controller.ts). App only:
 *   - feeds it every snapshot frame (grant pickup / handoff / finalize settle
 *     there, alongside where grant optimism settles in the client store);
 *   - owns the replay catalog for the history list + resolves which cached clip
 *     an agent's "Replay last" / catch-up plays, then hands entries to the
 *     controller. Components never touch <audio>.
 *
 * Grant/spawn/resume/hold go through the one RoomClient. Output device, hidden
 * devs, speed, and listened/cleared history are device-local prefs (prefs.ts).
 *
 * Deferred to chunk E (clean seams): chat/thread, call view, reply composer.
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { AgentView, Command } from "@room/protocol";
import {
  selectConnected,
  selectGrantPending,
  selectRoomHeld,
  selectVisibleAgents,
} from "@room/room-client";
import { client } from "./client.js";
import { fetchReplayList, type ReplayEntry } from "./api.js";
import { audioController } from "./audio/controller.js";
import { useCatchUp } from "./audio/react.js";
import {
  clearFiles,
  getPrefs,
  isHiddenName,
  launchFlags,
  pruneToFiles,
  setDevHidden,
  setOutputDevice,
  subscribePrefs,
} from "./prefs.js";
import { Header } from "./components/Header.js";
import { RoomGrid } from "./components/RoomGrid.js";
import { HiddenDevs } from "./components/HiddenDevs.js";
import { ReplayHistory } from "./components/ReplayHistory.js";
import { MiniPlayer } from "./components/MiniPlayer.js";
import { Toast } from "./components/Toast.js";
import { PickerSheet } from "./components/PickerSheet.js";

/** Shared coarse clock (15s) for the phone-chip staleness belt. */
function useClock(intervalMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * The replay catalog for the history list. Fetches on mount, refetches whenever
 * the controller flags the catalog dirty (new frame, live finalize, track end),
 * and prunes stale listened/cleared entries on each load.
 */
function useReplayList(): { all: ReplayEntry[]; refresh: () => void } {
  const [all, setAll] = useState<ReplayEntry[]>([]);
  const refresh = useCallback(() => {
    void fetchReplayList()
      .then((list) => {
        pruneToFiles(list.map((e) => e.file));
        setAll(list);
      })
      .catch(() => {
        /* keep prior list */
      });
  }, []);
  useEffect(() => refresh(), [refresh]);
  useEffect(() => audioController.onListDirty(refresh), [refresh]);
  return { all, refresh };
}

/** An entry's raw session name: sidecar sessionName, else the agent's name. */
function entryRawName(entry: ReplayEntry, agents: AgentView[]): string {
  const sn = (entry.sessionName ?? "").trim();
  if (sn) return sn;
  const agent = agents.find((a) => a.sessionId === entry.sessionId);
  return (agent?.name ?? "").trim();
}

/** Newest cached clip for an agent: by sessionId, else by session name. */
function newestForAgent(all: ReplayEntry[], agent: AgentView): ReplayEntry | undefined {
  return (
    all.find((e) => e.sessionId === agent.sessionId) ??
    all.find((e) => (e.sessionName ?? "").trim() === agent.name.trim())
  );
}

export function App() {
  const state = useSyncExternalStore(client.subscribe, client.getState);
  const prefs = useSyncExternalStore(subscribePrefs, getPrefs);
  const clock = useClock();
  const catchUp = useCatchUp();
  const [pickerOpen, setPickerOpen] = useState(false);
  const { all: replayAll } = useReplayList();

  const connected = selectConnected(state);
  const held = selectRoomHeld(state);
  const snapshot = state.snapshot;
  const nowPlaying = snapshot?.nowPlaying ?? null;
  const allAgents = selectVisibleAgents(state);
  const roomAgents = allAgents.filter((agent) => !isHiddenName(agent.name));

  // Feed every snapshot frame to the audio controller — grant-to-phone pickup,
  // Mac↔phone handoff, and live finalize all settle from these frames. The
  // effect fires only when the snapshot reference changes (grant-only updates
  // reuse it), which is exactly once per applied frame.
  useEffect(() => {
    audioController.onSnapshot(snapshot);
  }, [snapshot]);

  // Visible replay history: drop cleared + hidden-dev entries (newest-first).
  const visibleReplays = useMemo(
    () =>
      replayAll.filter(
        (e) => !prefs.cleared.has(e.file) && !isHiddenName(entryRawName(e, allAgents)),
      ),
    [replayAll, prefs.cleared, allAgents],
  );
  const unheardEntries = useMemo(
    () => visibleReplays.filter((e) => !prefs.listened.has(e.file) && e.kind !== "ack"),
    [visibleReplays, prefs.listened],
  );

  const spawnFlags = (persona: string | null) => {
    const flags = launchFlags();
    return persona ? { ...flags, persona } : flags;
  };

  const handleGrant = (sessionId: string) => {
    audioController.prime(); // unlock <audio> in this tap for a later phone route
    client.grant(sessionId, prefs.output);
  };

  const handleReplayLast = (agent: AgentView) => {
    audioController.prime();
    const entry = newestForAgent(replayAll, agent);
    if (!entry) {
      audioController.announce(`No replays yet for ${agent.label || agent.name}`);
      return;
    }
    void audioController.play(entry);
  };

  const handlePlayEntry = (entry: ReplayEntry) => {
    audioController.prime();
    void audioController.play(entry);
  };

  const handlePlayNewestUnheard = () => {
    audioController.prime();
    const entry = unheardEntries[0];
    if (entry) void audioController.play(entry);
  };

  const handleCatchUp = () => {
    audioController.prime();
    // Oldest unheard first (mobile.html reverses the newest-first list).
    void audioController.startCatchUp([...unheardEntries].reverse());
  };

  return (
    <div className="min-h-dvh bg-bg text-fg">
      <Header
        connected={connected}
        output={prefs.output}
        held={held}
        catchUp={catchUp}
        unheardCount={unheardEntries.length}
        onSetOutput={setOutputDevice}
        onToggleHold={() => client.send({ type: "hold_room" })}
        onCatchUp={handleCatchUp}
        onStopCatchUp={() => audioController.stopCatchUp()}
        onOpenPicker={() => setPickerOpen(true)}
      />

      <main className="mx-auto w-full max-w-xl px-4 py-4 pb-28">
        <RoomGrid
          agents={roomAgents}
          nowPlaying={nowPlaying}
          clock={clock}
          output={prefs.output}
          isGrantPending={(sessionId) => selectGrantPending(state, sessionId)}
          onGrant={handleGrant}
          onReplayLast={handleReplayLast}
          onHide={(rawName) => setDevHidden(rawName, true)}
        />

        <HiddenDevs
          hiddenNames={prefs.hiddenNames}
          agents={allAgents}
          onShow={(rawName) => setDevHidden(rawName, false)}
        />

        <ReplayHistory
          entries={visibleReplays}
          agents={allAgents}
          listened={prefs.listened}
          unheardCount={unheardEntries.length}
          onPlay={handlePlayEntry}
          onClear={() => clearFiles(visibleReplays.map((e) => e.file))}
          onPlayNewestUnheard={handlePlayNewestUnheard}
        />
      </main>

      <MiniPlayer agents={allAgents} />
      <Toast />

      <PickerSheet
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSpawn={({ dir, persona }) =>
          void client.request({ type: "spawn_session", dir, ...spawnFlags(persona) } as Command)
        }
        onResume={({ sessionId, dir, persona }) =>
          void client.request({
            type: "resume_session",
            sessionId,
            dir,
            ...spawnFlags(persona),
          } as Command)
        }
      />
    </div>
  );
}
