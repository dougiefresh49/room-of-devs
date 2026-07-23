/**
 * Bootstrap — order matters (same as panel/src/main.tsx):
 *   1. client exists (module import; no I/O yet)
 *   2. any store subscriptions BEFORE start() (events are NOT replayed)
 *   3. React root render
 *   4. client.start() LAST
 *   5. beforeunload: unmount then client.dispose()
 */
import "./styles.css";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { client } from "./client.js";
import { audioController } from "./audio/controller.js";

const appEl = document.getElementById("app");
if (!appEl) throw new Error("#app root missing from index.html");

const root = createRoot(appEl);
root.render(<App />);

client.start();

window.addEventListener("beforeunload", () => {
  root.unmount();
  client.dispose();
  // Kill the controller's watchdog/tick intervals + audio (finding 8).
  audioController.dispose();
});
