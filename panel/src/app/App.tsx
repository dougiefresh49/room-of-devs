/**
 * Root component: subscribes ONCE to each external store (client, view
 * state, server data, ui-state — the same shape the Phase 3 island host
 * had) and switches between the dock / room / picker / settings trees.
 * In 4b this also becomes the window-role switch (main vs dock realm).
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import type { WindowRole } from "../platform/types.js";
import { client } from "../client.js";
import { getGrantMarkVersion, subscribeGrantMarks } from "./grant-guard.js";
import { DockView } from "./DockView.js";
import { PickerView } from "./PickerView.js";
import { RoomView } from "./RoomView.js";
import { SettingsView } from "./SettingsView.js";
import { getServerData, subscribeServerData } from "./server-data.js";
import { getUiState, subscribeUiState } from "./ui-state.js";
import { getViewState, subscribeViewState, type ToastState } from "./view-state.js";

export function App({ role }: { role: WindowRole }) {
  const room = useSyncExternalStore(client.subscribe, client.getState);
  const view = useSyncExternalStore(subscribeViewState, getViewState);
  const serverData = useSyncExternalStore(subscribeServerData, getServerData);
  const ui = useSyncExternalStore(subscribeUiState, getUiState);
  // Cross-realm grant markers (storage events from the other window) —
  // value unused; subscribing re-renders spinner/spotlight readers.
  useSyncExternalStore(subscribeGrantMarks, getGrantMarkVersion);

  // One shared clock for the phone-chip staleness belt — one timer total,
  // not one per card (Phase 3 precedent).
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setClock(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  const snapshot = room.snapshot ?? null;

  // The dock REALM always renders the dock tree — mode switching is a
  // window-visibility swap owned by Rust, not view state. (The body/app
  // dock classes are set once at bootstrap.)
  if (role === "dock") {
    return (
      <DockView
        snapshot={snapshot}
        connected={room.connected}
        staleSessions={serverData.staleSessions}
        view={view}
        ui={ui}
      />
    );
  }

  if (view.view === "picker") {
    return (
      <div className="shell">
        <PickerView />
        <Toast toast={view.toast} />
      </div>
    );
  }

  if (view.view === "settings") {
    return (
      <div className="shell">
        <SettingsView />
        <Toast toast={view.toast} />
      </div>
    );
  }

  return (
    <>
      <RoomView
        snapshot={snapshot}
        connected={room.connected}
        staleSessions={serverData.staleSessions}
        view={view}
        ui={ui}
        clock={clock}
      />
      <Toast toast={view.toast} />
    </>
  );
}

function Toast({ toast }: { toast: ToastState | null }) {
  if (!toast) return null;
  return (
    <div className={`toast ${toast.kind}`} role="status">
      {toast.text}
    </div>
  );
}
