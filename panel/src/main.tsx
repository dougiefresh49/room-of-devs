/**
 * Bootstrap — order matters (Sol Q5):
 *   1. client exists (module import; no I/O yet)
 *   2. server-data onEvent subscription (events are NOT replayed — must
 *      precede start())
 *   3. view-state wiring + snapshot-prune subscription
 *   4. stage engine (subscribes + seeds from getState synchronously)
 *   5. React root render
 *   6. client.start() LAST
 */
import "./tailwind-entry.css";
import "@room/ui/rig.css";
import "./style.css";
import "./console.css";
import { createRoot } from "react-dom/client";
import type { PanelSnapshot } from "@room/protocol";
import { client } from "./client.js";
import { platform } from "./platform/tauri.js";
import { App } from "./app/App.js";
import { PERSONAS } from "./app/personas.js";
import { syncSettledGrants } from "./app/grant-guard.js";
import { cancelLearnCapture, initServerData, onSnapshotApplied } from "./app/server-data.js";
import { pruneUiState } from "./app/ui-state.js";
import { initViewState, pruneViewState } from "./app/view-state.js";
import { disposeStageEngine, initStageEngine } from "./stage/engine.js";
import { preloadAvatarFrames } from "./stage/preload.js";

initServerData(client, platform);
initViewState(client, cancelLearnCapture);

// Snapshot-driven pruning: stale markers clear, rename/kill-arm/swap state
// for departed sessions drops (legacy applySnapshot semantics).
let lastPruned: PanelSnapshot | null = null;
client.subscribe(() => {
  // Settle cross-realm grant markers the moment this realm's optimism
  // clears (audio started / rollback / belt expiry) — every state change,
  // not just snapshots.
  syncSettledGrants(client);
  const snap = client.getState().snapshot;
  if (!snap || snap === lastPruned) return;
  lastPruned = snap;
  onSnapshotApplied();
  const live = new Set(snap.agents.map((a) => a.sessionId));
  pruneUiState(live);
  pruneViewState(live);
});

initStageEngine(client);
preloadAvatarFrames(PERSONAS.map((p) => p.avatar));

const appEl = document.getElementById("app");
if (!appEl) throw new Error("#app root missing from index.html");

// Realm identity is fixed for the window's lifetime: the dock realm gets
// the dock chrome classes once; the main realm marks native chrome so the
// legacy .shell corner styling steps aside for the real titlebar.
const role = platform.windowRole();
if (role === "dock") {
  document.body.classList.add("dock-window");
  appEl.classList.add("dock-mode");
} else {
  document.body.classList.add("native-chrome");
}

const root = createRoot(appEl);
root.render(<App role={role} />);

client.start();

// Teardown order: unmount FIRST so effect cleanups (an active PTT hold's
// `ptt stop`) can still reach the live client, then engine, then client.
window.addEventListener("beforeunload", () => {
  root.unmount();
  disposeStageEngine();
  client.dispose();
});
