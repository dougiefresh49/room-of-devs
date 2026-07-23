/**
 * Mobile room shell (Phase 5, chunk C). Owns the store reads and wires the
 * shared RoomClient to the presentational components:
 *   Header (device toggle, hold, new)  ·  RoomGrid of AgentCards  ·
 *   HiddenDevs  ·  PickerSheet.
 *
 * Grant/spawn/resume/hold all go through the one RoomClient (grant optimism
 * is shared in room-client). Output device + hidden devs are device-local
 * prefs (see prefs.ts).
 *
 * Deferred to later chunks (clean seams, nothing stubbed): audio player,
 * replay/catch-up, chat/thread, reply composer.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import type { Command } from "@room/protocol";
import {
  selectConnected,
  selectGrantPending,
  selectRoomHeld,
  selectVisibleAgents,
} from "@room/room-client";
import { client } from "./client.js";
import {
  getPrefs,
  isHiddenName,
  launchFlags,
  setDevHidden,
  setOutputDevice,
  subscribePrefs,
} from "./prefs.js";
import { Header } from "./components/Header.js";
import { RoomGrid } from "./components/RoomGrid.js";
import { HiddenDevs } from "./components/HiddenDevs.js";
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

export function App() {
  const state = useSyncExternalStore(client.subscribe, client.getState);
  const prefs = useSyncExternalStore(subscribePrefs, getPrefs);
  const clock = useClock();
  const [pickerOpen, setPickerOpen] = useState(false);

  const connected = selectConnected(state);
  const held = selectRoomHeld(state);
  const nowPlaying = state.snapshot?.nowPlaying ?? null;
  const allAgents = selectVisibleAgents(state);
  const roomAgents = allAgents.filter((agent) => !isHiddenName(agent.name));

  const spawnFlags = (persona: string | null) => {
    const flags = launchFlags();
    return persona ? { ...flags, persona } : flags;
  };

  return (
    <div className="min-h-dvh bg-bg text-fg">
      <Header
        connected={connected}
        output={prefs.output}
        held={held}
        onSetOutput={setOutputDevice}
        onToggleHold={() => client.send({ type: "hold_room" })}
        onOpenPicker={() => setPickerOpen(true)}
      />

      <main className="mx-auto w-full max-w-xl px-4 py-4">
        <RoomGrid
          agents={roomAgents}
          nowPlaying={nowPlaying}
          clock={clock}
          output={prefs.output}
          isGrantPending={(sessionId) => selectGrantPending(state, sessionId)}
          onGrant={(sessionId) => client.grant(sessionId, prefs.output)}
          onHide={(rawName) => setDevHidden(rawName, true)}
        />

        <HiddenDevs
          hiddenNames={prefs.hiddenNames}
          agents={allAgents}
          onShow={(rawName) => setDevHidden(rawName, false)}
        />
      </main>

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
